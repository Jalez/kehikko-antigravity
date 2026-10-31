import { afterAll, describe, expect, test } from 'bun:test'
import { WELL_KNOWN, skillPath } from 'kehikot-module-protocol'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer, get, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { configDirOf, type SessionDoor } from '../doorConfig.ts'
import { SKILLS_HEADING, forAntigravity, kitSkills, removeKit, sessionKit, skillText, skillsText, sweepKits, writeHooks, writeSettings } from '../skills.ts'

const scratch: string[] = []
const dir = () => {
  const one = mkdtempSync(join(tmpdir(), 'kehikko-antigravity-skills-'))
  scratch.push(one)
  return one
}
const servers: Server[] = []
afterAll(() => {
  for (const one of servers) one.close()
  for (const one of scratch) rmSync(one, { recursive: true, force: true })
})

const text = (name: string, body = 'Do the thing.') => `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`

/** A stand-in module: a manifest declaring skills, and each one's text. */
function module(skills: Record<string, { text: string; version?: string; needs?: unknown[] }>, more: Record<string, unknown> = {}) {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname
    if (path === WELL_KNOWN) {
      response.setHeader('content-type', 'application/json')
      return void response.end(JSON.stringify({ id: more.id ?? 'kehikot.x', ...more, declares: { ...((more.declares as object) ?? {}), skills: Object.entries(skills).map(([name, one]) => ({ name, summary: `${name}.`, version: one.version ?? '1', ...(one.needs ? { needs: one.needs } : {}) })) } }))
    }
    for (const [name, one] of Object.entries(skills)) if (path === skillPath(name)) return void response.end(one.text)
    response.statusCode = 404
    response.end('no')
  })
  server.listen(0, '127.0.0.1')
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/* The test document replaces `fetch` with one that applies a browser's origin rules; a module is asked from a server. */
const plain = ((url: string) =>
  new Promise((done, fail) => {
    get(url, (response) => {
      let body = ''
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => done({ status: response.statusCode, text: async () => body }))
    }).on('error', fail)
  })) as unknown as typeof fetch

const door = (module: string, origin: string): SessionDoor => ({ module, name: module.split('.').pop()!, url: `${origin}/mcp?kehikot-place=x`, transport: 'http' })
/** The skills in a session's own folder, by name. */
const installed = (kit: string) => {
  const at = join(kit, '.agents', 'skills')
  return existsSync(at) ? readdirSync(at).filter((name) => !name.startsWith('.')).sort() : []
}
const options = (extra: { log?: string[]; personal?: string[]; everywhere?: NonNullable<Parameters<typeof sessionKit>[1]>['everywhere'] } = {}) => ({
  base: dir(),
  personal: extra.personal ?? [dir()],
  log: (line: string) => extra.log?.push(line),
  fetch: plain,
  ...(extra.everywhere !== undefined ? { everywhere: extra.everywhere } : {}),
})

describe('a session’s own folder: its skills, doors, hooks and status line', () => {
  test('every module on the kehikko and this module’s own, as `.agents/skills/<name>/SKILL.md` in a 0700 folder of the session’s', async () => {
    const one = module({ browse: { text: text('browse') }, 'read-page': { text: text('read-page') } })
    const two = module({ journey: { text: text('journey') } })
    const kit = await sessionKit([door('kehikot.browser', one), door('kehikot.journeys', two), door('kehikot.browser', one)], options())
    expect(installed(kit.dir)).toEqual(['browse', 'journey', 'kehikot-here', 'read-page'])
    expect(readFileSync(join(kit.dir, '.agents', 'skills', 'browse', 'SKILL.md'), 'utf8')).toBe('---\nname: browse\ndescription: "browse skill"\n---\nDo the thing.\n')
    /* This module's own is the person's to run, and names the conversation by the CLI's variable. */
    const here = readFileSync(join(kit.dir, '.agents', 'skills', 'kehikot-here', 'SKILL.md'), 'utf8')
    expect(here).toContain('$ANTIGRAVITY_CONVERSATION_ID')
    expect(here).toContain('Only the person runs this skill, by typing `/kehikot-here`')
    expect(statSync(kit.dir).mode & 0o777).toBe(0o700)
    expect(kitSkills(kit.dir).map((one) => `${one.name} ${one.state}`).sort()).toEqual(['browse callable', 'journey callable', 'kehikot-here callable', 'read-page callable'])
    removeKit(kit.dir)
    expect(existsSync(kit.dir)).toBe(false)
  })

  test('its doors are its `.agents/mcp_config.json`, in the CLI’s schema; an SSE door is left out (the CLI takes Streamable HTTP only)', async () => {
    const doors: SessionDoor[] = [
      { module: 'kehikko', name: 'kehikko', url: 'http://127.0.0.1:4170/mcp?kehikot-place=tok', transport: 'http' },
      { module: 'kehikot.paper', name: 'paper.v2', url: 'http://127.0.0.1:7870/mcp?kehikot-place=tok', transport: 'http' },
      { module: 'kehikot.old', name: 'old', url: 'http://127.0.0.1:7000/sse', transport: 'sse' },
    ]
    const kit = await sessionKit(doors, options())
    const file = join(kit.dir, '.agents', 'mcp_config.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ mcpServers: { kehikko: { url: 'http://127.0.0.1:4170/mcp?kehikot-place=tok' }, paper_v2: { url: 'http://127.0.0.1:7870/mcp?kehikot-place=tok' } } })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(kit.doors).toEqual(['kehikko', 'paper_v2'])
  })

  test('its hooks and its one-run status line are written beside them; the status line prints nothing and keeps the CLI’s own', async () => {
    const kit = await sessionKit([], options())
    writeHooks(kit.dir, [{ event: 'Stop', commands: [{ command: '/bin/sh tell.sh Stop', timeout: 5 }] }])
    expect(JSON.parse(readFileSync(join(kit.dir, '.agents', 'hooks.json'), 'utf8'))).toEqual({ kehikot: { Stop: [{ type: 'command', command: '/bin/sh tell.sh Stop', timeout: 5 }] } })
    const settings = JSON.parse(readFileSync(writeSettings(kit.dir), 'utf8'))
    expect(settings).toEqual({ statusLine: { type: 'command', command: `/bin/sh '${join(kit.dir, 'status.sh')}'`, enabled: true, padding: 0, stack_with_default: true } })
    expect(existsSync(join(kit.dir, 'status.sh'))).toBe(true)
  })

  test('a module that does not answer, or gives a text the protocol refuses, is left out with one line', async () => {
    const log: string[] = []
    const bad = module({ broken: { text: 'no front matter' } })
    const kit = await sessionKit([door('kehikot.gone', 'http://127.0.0.1:9'), door('kehikot.bad', bad)], options({ log }))
    expect(installed(kit.dir)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('kehikot.gone did not answer'))).toBe(true)
    expect(log.some((line) => line.includes('skill broken from kehikot.bad refused'))).toBe(true)
  })

  test('a kehikko-bound skill only when what it needs is on the kehikko — by id, or by what a module there provides', async () => {
    const log: string[] = []
    const factory = module({ 'review-factory': { text: text('review-factory'), needs: ['kehikot.review'] }, 'flow-roadmap': { text: text('flow-roadmap'), needs: [{ provides: 'steps' }] } }, { id: 'kehikot.factory', name: 'Factory' })
    const alone = await sessionKit([door('kehikot.factory', factory)], options({ log }))
    expect(installed(alone.dir)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('review-factory') && line.includes('left out'))).toBe(true)
    const review = module({}, { id: 'kehikot.review', name: 'Review' })
    const journeys = module({}, { id: 'kehikot.journeys', name: 'Journeys', declares: { provides: ['steps'] } })
    const kit = await sessionKit([door('kehikot.factory', factory), door('kehikot.review', review), door('kehikot.journeys', journeys)], options())
    expect(installed(kit.dir)).toEqual(['flow-roadmap', 'kehikot-here', 'review-factory'])
  })

  test('a skill of the person’s own by that name, in a folder the CLI reads first, wins: Kehikot’s is not given, and the session is told why', async () => {
    const personal = dir()
    mkdirSync(join(personal, 'kehikot-here'))
    writeFileSync(join(personal, 'kehikot-here', 'SKILL.md'), text('kehikot-here', 'Mine.'))
    const kit = await sessionKit([], options({ personal: [personal] }))
    expect(installed(kit.dir)).toEqual([])
    expect(kitSkills(kit.dir)).toMatchObject([{ name: 'kehikot-here', state: 'taken' }])
    expect(readFileSync(join(personal, 'kehikot-here', 'SKILL.md'), 'utf8')).toContain('Mine.')
  })

  test('the skills the host keeps for every conversation are given too; one from somewhere not this computer is not fetched', async () => {
    const kehikot = module({ 'kehikot-module': { text: text('kehikot-module') } })
    const log: string[] = []
    const kit = await sessionKit([], options({ log, everywhere: [{ module: 'kehikko', name: 'kehikot-module', origin: kehikot }, { module: 'kehikot.far', name: 'far', origin: 'https://example.com' }] as never }))
    expect(installed(kit.dir)).toEqual(['kehikot-here', 'kehikot-module'])
    expect(log.some((line) => line.includes('not on this computer'))).toBe(true)
  })
})

describe('a skill written for Claude Code, said for Antigravity', () => {
  const claude = [
    '---',
    'name: monitor',
    'description: Ask Monitor what repeats. Only a person runs it, by typing /monitor.',
    'disable-model-invocation: true',
    'allowed-tools: Bash(curl:*), mcp__monitor__traffic',
    '---',
    '',
    'The person typed `/monitor $ARGUMENTS`. Monitor answers at http://127.0.0.1:9010:',
    '',
    '!`curl -s -m 5 -G --data-urlencode "session=${CLAUDE_SESSION_ID}" http://127.0.0.1:9010/api/traffic`',
    '',
    'Then say what repeats.',
  ].join('\n')

  test('Claude Code’s front matter goes; a person-only skill stays one; its name is a slash command, as in Claude Code', () => {
    const said = forAntigravity(claude, 'monitor')
    expect(said.implicit).toBe(false)
    expect(said.description).toBe('Ask Monitor what repeats. Only a person runs it, by typing /monitor.')
    expect(said.text.startsWith('---\nname: monitor\ndescription: "Ask Monitor what repeats. Only a person runs it, by typing /monitor."\n---\n')).toBe(true)
    expect(said.text).not.toContain('allowed-tools')
    expect(said.text).not.toContain('disable-model-invocation')
    expect(said.text).toContain('The person typed `/monitor $ARGUMENTS`')
    expect(said.text).toContain('Only the person runs this skill, by typing `/monitor`')
  })

  test('a line Claude Code runs on load is a command to run first; the session id is the CLI’s', () => {
    const said = forAntigravity(claude, 'monitor')
    expect(said.text).not.toContain('!`curl')
    expect(said.text).toContain('```sh\ncurl -s -m 5 -G --data-urlencode "session=$ANTIGRAVITY_CONVERSATION_ID" http://127.0.0.1:9010/api/traffic\n```')
    expect(said.text).toContain('outside the sandbox')
    expect(said.text).toContain('`$ARGUMENTS` below is whatever the person wrote after `/monitor`')
    expect(said.text).not.toContain('CLAUDE_SESSION_ID')
  })

  test('a skill with none of that is the same text under Antigravity’s front matter', () => {
    expect(forAntigravity(text('journey', 'Read the steps.'), 'journey')).toEqual({ name: 'journey', description: 'journey skill', implicit: true, text: '---\nname: journey\ndescription: "journey skill"\n---\nRead the steps.\n' })
  })

  test('the session is told its skills as /name entries it can call, and what was not given', async () => {
    const kit = await sessionKit([], options())
    const said = skillsText([...kitSkills(kit.dir), { name: 'journey', description: 'Mine.', implicit: true, module: 'kehikot.journeys', by: 'Journeys', state: 'taken' }])!
    expect(said.startsWith(SKILLS_HEADING)).toBe(true)
    expect(said).toContain('a workspace folder of its own')
    expect(said).toContain('- `/kehikot-here` (Antigravity): ')
    expect(said).toContain('Only when the person types it.')
    expect(said).toContain("a skill of the person's own already has the name (`/name` runs theirs): `/journey` (Journeys).")
    expect(said).not.toContain('<skills_instructions>')
    expect(skillsText([])).toBeNull()
    expect(skillText('kehikot-here')).toContain('/api/here')
  })
})

describe('session folders a stopped process left behind', () => {
  test('swept at start: a dead pid goes, a live one stays, no pid only when an hour old', () => {
    const base = dir()
    const root = configDirOf(base)
    mkdirSync(root, { recursive: true })
    const kit = (name: string, pid: number | null, ageMs?: number) => {
      const at = join(root, `session-${name}`)
      mkdirSync(join(at, 'kehikot'), { recursive: true })
      if (pid !== null) writeFileSync(join(at, 'kehikot', 'pid'), String(pid))
      if (ageMs !== undefined) {
        const when = new Date(Date.now() - ageMs)
        utimesSync(at, when, when)
      }
      return at
    }
    kit('live', process.pid)
    kit('dead', 2 ** 22 + 12345)
    kit('fresh', null)
    kit('old', null, 2 * 60 * 60_000)
    expect(sweepKits(base)).toBe(2)
    expect(readdirSync(root).sort()).toEqual(['session-fresh', 'session-live'])
    expect(existsSync(join(root, 'session-live', 'kehikot', 'pid'))).toBe(true)
  })
})
