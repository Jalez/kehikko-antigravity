import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { HOST_CALLER, SERVICE_CALLER_HEADER, SERVICE_PASS_HEADER, conversationsFindResult, serviceDescriptor } from 'kehikot-module-protocol'
import { vouchHost } from 'kehikot-module-protocol/serve'

import { ROUTES, adoptDoor, bringConversation, findConversations, mentions, startTask, type AdoptNeeds } from '../adopt.ts'
import { ADOPT } from '../doors.ts'
import { Runs, headless, type Pty } from '../live.ts'
import { MANIFEST } from '../manifest.ts'
import { placeKey } from '../place.ts'
import { PROGRAM, type Program } from '../program.ts'
import { assign, homeOf, ignore, isDetached, readPlaces, sighted } from '../record.ts'
import { taskSession } from '../src/view/task.tsx'
import { writeConversation } from './transcripts.ts'

/**
 * Adopting a tracker item (protocol 2.88.0, adopt.ts): which conversations of a project worked on a ref
 * (`find`), filing one under a place only if it is where the host thinks (`bring`), a new conversation
 * fed a brief (`start`), and every route refused unless the host vouches for the request. Fixtures only:
 * records in scratch projects, conversation folders in the scratch home (test/setup.ts).
 */

const made: string[] = []
const project = () => {
  const one = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-antigravity-adopt-')))
  made.push(one)
  return one
}
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})

const A = 'a1111111-1111-4111-8111-111111111111'
const B = 'b2222222-2222-4222-8222-222222222222'
const C = 'c3333333-3333-4333-8333-333333333333'
const D = 'd4444444-4444-4444-8444-444444444444'
const REAL = 'e5555555-5555-4555-8555-555555555555'
const WRITING = { epic: 'thesis', parts: ['methods'], kehikko: 'k1a2b3c4' }
const REVIEW = { epic: 'thesis', parts: [], kehikko: 'r9z8y7x6' }
const named = (place: { epic: string | null; parts: string[]; kehikko: string | null }) => ({ epic: place.epic, parts: place.parts, kehikko: place.kehikko ? { key: place.kehikko } : null })

const read = (dir: string) => {
  const got = readPlaces(dir)
  if (!got.ok) throw new Error(got.error)
  return got.value
}

/** What adopt.ts needs, with nothing running and nothing started unless a test says. */
function needs(more: Partial<AdoptNeeds> = {}): AdoptNeeds & { toldOf: unknown[] } {
  const toldOf: unknown[] = []
  return {
    program: PROGRAM,
    running: async () => new Set(),
    holding: () => false,
    runsIn: () => false,
    told: (project, assigned) => void toldOf.push({ project, assigned }),
    task: async () => ({ ok: false, why: 'nothing is started here' }),
    toldOf,
    ...more,
  }
}

describe('the manifest', () => {
  test('provides conversations.finder and agent.tasks, in shapes the protocol takes', () => {
    expect(serviceDescriptor('conversations.finder', MANIFEST.services?.['conversations.finder'])).toEqual({ name: 'Antigravity', program: 'Antigravity CLI', find: ROUTES.find, bring: ROUTES.bring })
    expect(serviceDescriptor('agent.tasks', MANIFEST.services?.['agent.tasks'])).toEqual({ name: 'Antigravity', program: 'Antigravity CLI', start: ROUTES.start, view: '/app?session={session}' })
  })

  test('the view’s address names the conversation the page shows alone', () => {
    expect(taskSession(`?session=${A}`)).toBe(A)
    expect(taskSession('?session=nope')).toBeNull()
    expect(taskSession('')).toBeNull()
  })
})

describe('find', () => {
  test('lists the project’s recorded conversations: a title naming the ref is mentioned, the rest worked in its folder', async () => {
    const dir = project()
    assign(dir, named(WRITING), A, { label: 'Fix the login bug for !4721', lastActive: 1000 })
    sighted(dir, B, 'hook', 2000, 'Refactor the parser')
    sighted(dir, C, 'hook', 3000, 'Something about !47210')
    sighted(dir, D, 'hook', 4000, 'Not a Kehikot one, !4721')
    ignore(dir, D)
    for (const id of [A, B, C, D]) writeConversation(id, [], 5000)
    const found = await findConversations({ project: dir, refs: ['!4721'] }, needs({ running: async () => new Set([B]) }))
    expect(conversationsFindResult.safeParse({ conversations: found }).success).toBe(true)
    expect(found.map((one) => [one.session, one.match, one.reason])).toEqual([
      [A, 'mentioned', 'mentioned !4721'],
      [B, 'folder', 'worked in this repository'],
      [C, 'folder', 'worked in this repository'],
    ])
    expect(found[0]).toMatchObject({ title: 'Fix the login bug for !4721', folder: dir, place: WRITING, running: false })
    expect(found[1]).toMatchObject({ place: null, running: true })
  })

  test('never says created, pushed or branch: the record keeps no command and no branch, and the transcript is never read', async () => {
    const dir = project()
    sighted(dir, A, 'hook', 1000, 'feat/login')
    writeConversation(A, ['{"gh pr create":"!9"}'], 1000)
    const found = await findConversations({ project: dir, refs: ['!9'], branch: 'feat/login' }, needs())
    expect(found.map((one) => one.match)).toEqual(['folder'])
  })

  test('a conversation this computer has no folder for, and a project that is not a folder, give nothing', async () => {
    const dir = project()
    sighted(dir, 'f6666666-6666-4666-8666-666666666666', 'hook', 1000, 'gone')
    expect(await findConversations({ project: dir, refs: ['#1'] }, needs())).toEqual([])
    expect(await findConversations({ project: join(dir, 'nowhere'), refs: ['#1'] }, needs())).toEqual([])
  })

  test('a ref is matched as a whole spelling, never inside a longer one', () => {
    expect(mentions('Review !4721 now', '!4721')).toBe(true)
    expect(mentions('owner/repo#12: tidy', 'owner/repo#12')).toBe(true)
    expect(mentions('#123', '#12')).toBe(false)
    expect(mentions('PROJ-12 and more', 'proj-12')).toBe(true)
    expect(mentions('XPROJ-12', 'PROJ-12')).toBe(false)
  })
})

describe('bring', () => {
  test('files a conversation that belongs nowhere under the place, as /kehikot-here would', () => {
    const dir = project()
    sighted(dir, A, 'hook', 1000, 'loose')
    writeConversation(A)
    const n = needs()
    const said = bringConversation({ project: dir, session: A, to: WRITING, from: null }, n)
    expect(said).toEqual({ outcome: 'brought', place: WRITING, resumed: false, why: '' })
    const after = read(dir)
    expect(homeOf(after, A)).toBe(placeKey(named(WRITING)))
    /* The place had none: it is the place's own now, and it has its token. */
    expect(after.places[placeKey(named(WRITING))]!.own).toBe(A)
    expect(after.sessions[A]!.token).toBeTruthy()
    expect(n.toldOf).toEqual([{ project: dir, assigned: { key: placeKey(named(WRITING)), session: A } }])
  })

  test('refuses one filed under another place, says where, and never moves it', () => {
    const dir = project()
    assign(dir, named(REVIEW), A, { label: 'review work' })
    writeConversation(A)
    const before = JSON.stringify(read(dir))
    const said = bringConversation({ project: dir, session: A, to: WRITING, from: null }, needs())
    expect(said.outcome).toBe('elsewhere')
    expect(said.place).toEqual(REVIEW)
    expect(JSON.stringify(read(dir))).toBe(before)
  })

  test('undo: to no place from the place it was brought to takes it back; from a place it has left, nothing changes', () => {
    const dir = project()
    sighted(dir, A, 'hook', 1000, 'loose')
    writeConversation(A)
    expect(bringConversation({ project: dir, session: A, to: WRITING, from: null }, needs()).outcome).toBe('brought')
    const back = bringConversation({ project: dir, session: A, to: null, from: WRITING }, needs())
    expect(back).toEqual({ outcome: 'brought', place: null, resumed: false, why: '' })
    const after = read(dir)
    expect(homeOf(after, A)).toBeNull()
    expect(Object.values(after.places).some((entry) => entry.sessions.includes(A))).toBe(false)
    expect(isDetached(after, A)).toBe(true)
    /* Somebody moved it since: an undo from WRITING no longer applies. */
    assign(dir, named(REVIEW), A)
    expect(bringConversation({ project: dir, session: A, to: null, from: WRITING }, needs())).toMatchObject({ outcome: 'elsewhere', place: REVIEW })
    expect(homeOf(read(dir), A)).toBe(placeKey(named(REVIEW)))
  })

  test('a running conversation this module holds gains the place at once, and is not restarted', () => {
    const dir = project()
    sighted(dir, A, 'hook', 1000, 'running')
    writeConversation(A)
    const held: unknown[] = []
    const said = bringConversation({ project: dir, session: A, to: WRITING, from: null }, needs({ holding: (p, s, place) => (held.push([p, s, place]), true) }))
    expect(said).toMatchObject({ outcome: 'brought', resumed: true })
    expect(held).toEqual([[dir, A, named(WRITING)]])
  })

  test('a conversation the project never had is no such session', () => {
    const dir = project()
    writeConversation(B)
    expect(bringConversation({ project: dir, session: B, to: WRITING, from: null }, needs()).outcome).toBe('no-such-session')
    expect(bringConversation({ project: dir, session: 'not-an-id', to: WRITING, from: null }, needs()).outcome).toBe('no-such-session')
    expect(read(dir).sessions).toEqual({})
  })
})

class FakePty implements Pty {
  pid = 0
  killed = false
  private exited: (exit: { exitCode: number }) => void = () => {}
  constructor(readonly args: string[], readonly cwd: string) {}
  onData() {}
  onExit(heard: (exit: { exitCode: number }) => void) {
    this.exited = heard
  }
  write() {}
  resize() {}
  kill() {
    if (this.killed) return
    this.killed = true
    this.exited({ exitCode: 129 })
  }
}

/** Runs with a stand-in CLI: it says its conversation's id (`REAL`) once it has been started, unless `silent`. */
function world(silent = false) {
  const ptys: FakePty[] = []
  const program: Program = {
    ...PROGRAM,
    find: () => ({ file: '/fake/bin/agy', looked: ['/fake/bin'], usual: [] }),
    supports: async () => ({ ok: true, missing: null, tells: false, lists: true, names: false, configures: false, plugins: false, settings: false }),
    active: async () => ({ known: true, active: [] }),
    settled: async () => (ptys.length && !silent ? REAL : null),
    sessions: async () => [],
  }
  const runs = new Runs({ program, screen: headless, every: null, watchEvery: null, spawn: (_file, args, options) => {
    const pty = new FakePty(args, options.cwd)
    ptys.push(pty)
    return pty
  } })
  return { runs, ptys }
}

describe('start', () => {
  test('starts a NEW conversation in the project with the brief as its first prompt, files it under the place, and answers its id', async () => {
    const dir = project()
    const w = world()
    let reported: (params: unknown) => void = () => {}
    const report = new Promise((done) => (reported = done))
    const fetch = (async (_url: string, init?: RequestInit) => {
      reported(JSON.parse(String(init?.body)).params)
      return Response.json({ ok: true, data: { outcome: 'told', why: '' } })
    }) as unknown as typeof globalThis.fetch
    const said = await startTask(
      { project: dir, brief: 'Review !4721 and say what is left.', place: WRITING, title: 'Review !4721' },
      needs({
        program: { ...PROGRAM, find: () => ({ file: '/fake/bin/agy', looked: [], usual: [] }), newId: () => 'h-handle' },
        task: (p, place, brief, title) => w.runs.task(p, place, brief, title),
        report: { env: { KEHIKOT_HOST: 'http://127.0.0.1:4170' }, fetch, log: () => {} },
      }),
    )
    /* Accepted at once (protocol 2.99.0); the conversation and its id come after, reported to the host. */
    expect(said).toEqual({ outcome: 'started', session: 'h-handle', why: '', pending: true })
    expect(await report).toEqual({ session: 'h-handle', conversation: REAL, outcome: 'started', why: '' })
    expect(w.ptys.length).toBe(1)
    expect(w.ptys[0]!.args).toEqual(['-i', 'Review !4721 and say what is left.'])
    expect(w.ptys[0]!.cwd).toBe(dir)
    const after = read(dir)
    expect(homeOf(after, REAL)).toBe(placeKey(named(WRITING)))
    expect(after.sessions[REAL]!.label).toBe('Review !4721')
    /* The view finds it: where the page that shows it alone opens it. */
    expect(w.runs.taskTarget(REAL)).toMatchObject({ projectPath: dir, place: { epic: 'thesis', parts: ['methods'], kehikko: { key: 'k1a2b3c4' } } })
    w.runs.endAll()
  })

  test('no place is the project’s own; a brief that starts with a dash is never read as a flag', async () => {
    const dir = project()
    const w = world()
    const said = await w.runs.task(dir, { epic: null, parts: [], kehikko: null }, '--yolo please')
    expect(said).toEqual({ ok: true, session: REAL })
    expect(w.ptys[0]!.args).toEqual(['-i', ' --yolo please'])
    expect(homeOf(read(dir), REAL)).toBe('epic=-;parts=-;kehikko=-')
    w.runs.endAll()
  })

  test('a CLI that has not said its conversation yet runs on, under way under its run’s id (protocol 2.99.0)', async () => {
    const dir = project()
    const w = world(true)
    const said = await w.runs.task(dir, named(WRITING), 'do it', '', 300, '77777777-7777-4777-8777-777777777777')
    expect(said).toEqual({ ok: true, session: '77777777-7777-4777-8777-777777777777' })
    expect(w.ptys[0]!.killed).toBeFalsy()
    w.runs.endAll()
  })

  test('declined at once when Antigravity is not installed', async () => {
    const said = await startTask({ project: project(), brief: 'x', place: null, title: 't' }, needs({ program: { ...PROGRAM, find: () => ({ file: null, looked: [], usual: [] }) } }))
    expect(said).toMatchObject({ outcome: 'declined', session: null, pending: false })
  })
})

describe('only the host is answered', () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://127.0.0.1:8120${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const info = (request: Request) => ({ asker: 'program' as const, url: new URL(request.url), ticket: null })

  test('every route refuses a request the host does not vouch for, with 403, and reads nothing', async () => {
    let asked = 0
    const door = adoptDoor(() => {
      asked += 1
      return needs()
    })
    for (const path of [ROUTES.find, ROUTES.bring, ROUTES.start]) {
      const request = post(path, { project: '/x', refs: ['#1'] })
      const answer = await door(request, info(request))
      expect(answer?.status).toBe(403)
    }
    /* The server's own door too: no host answers in the tests (test/setup.ts), so nothing is vouched for. */
    for (const path of [ROUTES.find, ROUTES.bring, ROUTES.start]) {
      const request = post(path, {}, { [SERVICE_CALLER_HEADER]: HOST_CALLER, [SERVICE_PASS_HEADER]: 'x'.repeat(43) })
      expect((await ADOPT(request, info(request)))?.status).toBe(403)
    }
    expect(asked).toBe(0)
  })

  test('a pass the host minted is answered; anything else is left to the doors', async () => {
    const dir = project()
    sighted(dir, A, 'hook', 1000, 'about #12')
    writeConversation(A)
    const minted = new Set(['p'.repeat(43)])
    const vouch: typeof vouchHost = (headers) =>
      vouchHost(headers, { env: { KEHIKOT_ORIGINS: 'http://127.0.0.1:4170' }, fetch: (async (url: string) => Response.json({ ok: true, minted: minted.delete(new URL(url).searchParams.get('pass') ?? '') })) as unknown as typeof fetch })
    const door = adoptDoor(() => needs(), vouch)
    const request = post(ROUTES.find, { project: dir, refs: ['#12'] }, { [SERVICE_CALLER_HEADER]: HOST_CALLER, [SERVICE_PASS_HEADER]: 'p'.repeat(43) })
    const answer = await door(request, info(request))
    expect(answer?.status).toBe(200)
    expect(((await answer!.json()) as { conversations: { session: string; match: string }[] }).conversations).toEqual([expect.objectContaining({ session: A, match: 'mentioned' })])
    /* Spent: the same pass again is refused. */
    const again = post(ROUTES.find, { project: dir, refs: ['#12'] }, { [SERVICE_CALLER_HEADER]: HOST_CALLER, [SERVICE_PASS_HEADER]: 'p'.repeat(43) })
    expect((await door(again, info(again)))?.status).toBe(403)
    const other = new Request('http://127.0.0.1:8120/api/state', { method: 'POST' })
    expect(await door(other, info(other))).toBeUndefined()
  })
})
