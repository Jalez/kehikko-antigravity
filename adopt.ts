import {
  CONVERSATION_MATCHES,
  agentTaskStartParams,
  conversationsBringParams,
  conversationsFindParams,
  type AgentTaskStartResult,
  type ConversationCandidate,
  type ConversationMatch,
  type ConversationPlace,
  type ConversationsBringParams,
  type ConversationsBringResult,
  type ConversationsFindParams,
} from 'kehikot-module-protocol'
import { acceptTask, vouchHost, type Before } from 'kehikot-module-protocol/serve'

import { freshToken } from './doorConfig.ts'
import { ID } from './manifest.ts'
import { placeKey, readPlaceKey, sortedParts } from './place.ts'
import { hasRecord, type Program } from './program.ts'
import { assign, disconnect, homeOf, projectRoot, readPlaces, tokenFor, type NamedPlace, type Places } from './record.ts'

/**
 * Adopting a tracker item no epic names (protocol 2.88.0): the two services the HOST calls on this
 * module, and only the host — every route here is held to `vouchHost`.
 *
 * ## `conversations.finder`
 *
 * `find`: which of this module's Antigravity conversations in a project worked on a ref. Asked only
 * of what this module already reads of them — its session listing (`sessions` in program.ts: the
 * project's record, `places.json`, with the titles the CLI's status line gave them). The transcript's
 * format is not documented and is never parsed (CLAUDE.md), and the record keeps no git branch and no
 * command a conversation ran, so this module cannot say `created`, `pushed` or `branch`. It says:
 *
 * - `mentioned`: the conversation's title names one of the ref's spellings (`!4721`, `#12`);
 * - `folder`: any other conversation the project's record holds — every one of them ran in the
 *   project's folder (started there, or filed there by `/kehikot-here`, which takes only a folder
 *   inside the project).
 *
 * Neither is confident enough for a host to bring a conversation along by itself; both are listed for
 * the person. A conversation a person said is no Kehikot one (`ignored`) is never listed.
 *
 * `bring`: file one conversation under a place, ONLY if it is filed under `from` now — the record write
 * `/kehikot-here` does (`assign` in record.ts, as here.ts calls it, with its token), or, to no place,
 * the container's "Disconnect" (`disconnect`). A conversation filed somewhere else is answered
 * `elsewhere` and never moved.
 *
 * ## `agent.tasks`
 *
 * `start`: a NEW Antigravity conversation in the project, fed the brief as its first prompt, started
 * the way a place starts one (`task` in live.ts), filed under the place like any conversation it
 * starts. `view` is the page with `?session=<id>`, which shows that one conversation (`TaskApp`).
 */

export const ROUTES = { find: '/api/conversations/find', bring: '/api/conversations/bring', start: '/api/tasks/start' } as const

/** What these need of the rest of the module; the server's are in `adoptDoor`, a test stands its own in. */
export interface AdoptNeeds {
  program: Program
  /** The conversations running now: a run here, or an agy process started on it by id. */
  running(): Promise<Set<string>>
  /** Whether a run here holds this conversation in its project; then it takes `place` at once (`holding` in live.ts). */
  holding(project: string, session: string, place: NamedPlace | null): boolean
  /** Whether a run here holds this conversation in this project. */
  runsIn(project: string, session: string): boolean
  /** The record changed: pages read their lists again; `assigned` puts it on screen at its place. */
  told(project: string, assigned?: { key: string; session: string }): void
  /** Start a new conversation with a brief (`task` in live.ts), its run under `id` when given (what `start` answered). */
  task(project: string, place: NamedPlace, brief: string, title: string, id?: string): Promise<{ ok: true; session: string } | { ok: false; why: string }>
  /** Where `tasks.report` goes, for a test (the host this module was started by, otherwise). */
  report?: { env?: Record<string, string | undefined>; fetch?: typeof fetch; log?: (line: string) => void }
}

/** A protocol place as this module's record names one. Null is no place. */
export function namedOf(place: ConversationPlace): NamedPlace {
  return { epic: place.epic, parts: sortedParts(place.parts), kehikko: place.kehikko ? { key: place.kehikko } : null }
}

/**
 * A key of this module's record as a protocol place, or null for none. A kehikko this module knows only
 * by an older host's row number has no key to say: it is said as none.
 */
export function conversationPlaceOf(key: string | null): ConversationPlace | null {
  const place = key ? readPlaceKey(key) : null
  if (!place) return null
  return { epic: place.epic, parts: place.parts, kehikko: place.kehikko && 'key' in place.kehikko ? place.kehikko.key : null }
}

/** Whether a title names a ref: the spelling, case aside, not inside a longer word or number. */
export function mentions(title: string, ref: string): boolean {
  const said = ref.trim().toLowerCase()
  if (said.length < 2) return false
  const text = title.toLowerCase()
  const word = /[a-z0-9]/
  for (let at = text.indexOf(said); at >= 0; at = text.indexOf(said, at + 1)) {
    const before = text[at - 1] ?? ''
    const after = text[at + said.length] ?? ''
    if (word.test(said[0]!) && word.test(before)) continue
    if (word.test(said[said.length - 1]!) && word.test(after)) continue
    return true
  }
  return false
}

const rank = (match: ConversationMatch) => CONVERSATION_MATCHES.indexOf(match)

/** `find`: the project's conversations that worked on the ref, as far as this module can tell, strongest first, at most 20. */
export async function findConversations(params: ConversationsFindParams, needs: AdoptNeeds): Promise<ConversationCandidate[]> {
  const root = projectRoot(params.project)
  if (!root.ok) return []
  const read = readPlaces(root.value)
  const places: Places = read.ok ? read.value : { version: 1, places: {}, sessions: {} }
  const listed = await needs.program.sessions(root.value)
  const running = await needs.running()
  const found: ConversationCandidate[] = []
  for (const one of listed) {
    const entry = Object.hasOwn(places.sessions, one.id) ? places.sessions[one.id] : undefined
    if (entry?.ignored) continue
    const ref = one.label ? params.refs.find((spelling) => mentions(one.label, spelling)) : undefined
    found.push({
      session: one.id,
      title: one.label,
      folder: root.value,
      lastActive: Math.max(0, Math.trunc(one.lastActive || 0)),
      match: ref ? 'mentioned' : 'folder',
      reason: ref ? `mentioned ${ref.trim()}` : 'worked in this repository',
      place: conversationPlaceOf(homeOf(places, one.id)),
      running: running.has(one.id),
    })
  }
  return found.sort((a, b) => rank(a.match) - rank(b.match) || b.lastActive - a.lastActive).slice(0, 20)
}

/** `bring`: a compare-and-set of one conversation's place. */
export function bringConversation(params: ConversationsBringParams, needs: AdoptNeeds): ConversationsBringResult {
  const result = (outcome: ConversationsBringResult['outcome'], more: Partial<ConversationsBringResult> = {}): ConversationsBringResult => ({ outcome, place: null, resumed: false, why: '', ...more })
  const root = projectRoot(params.project)
  if (!root.ok) return result('declined', { why: root.error })
  const project = root.value
  const id = params.session
  if (!needs.program.isId(id)) return result('no-such-session', { why: 'That is not an Antigravity conversation’s id.' })
  const read = readPlaces(project)
  if (!read.ok) return result('declined', { why: read.error })
  const places = read.value
  /* One of this project's: in its record, or run here in it. Never one this project never had. */
  const recorded = Object.hasOwn(places.sessions, id) || Object.values(places.places).some((entry) => entry.sessions.includes(id))
  if (!(recorded && hasRecord(id)) && !needs.runsIn(project, id)) {
    return result('no-such-session', { why: 'This project has no Antigravity conversation by that id on this computer.' })
  }
  const now = homeOf(places, id)
  const from = params.from ? placeKey(namedOf(params.from)) : null
  if (now !== from) return result('elsewhere', { place: conversationPlaceOf(now), why: now ? 'It is filed under another place.' : 'It is filed under no place.' })
  const to = params.to ? namedOf(params.to) : null
  const key = to ? placeKey(to) : null
  if (key === now) return result('brought', { place: conversationPlaceOf(now), resumed: needs.holding(project, id, to) })
  if (to && key) {
    /* What `/kehikot-here` writes (here.ts): filed under the place, its own when the place had none, and its token. */
    const written = assign(project, to, id)
    if (!written.ok) return result('declined', { why: written.error })
    tokenFor(project, id, freshToken)
    needs.told(project, { key, session: id })
  } else {
    /* What "Disconnect this conversation" writes: off every place, and filed nowhere again on its own. */
    const written = disconnect(project, id)
    if (!written.ok) return result('declined', { why: written.error })
    needs.told(project)
  }
  return result('brought', { place: conversationPlaceOf(key), resumed: needs.holding(project, id, to) })
}

/** The place a task is filed under: the one asked for, or the project's own (no epic, no parts, no kehikko). */
export function taskPlace(place: ConversationPlace | null): NamedPlace {
  return place ? namedOf(place) : { epic: null, parts: [], kehikko: null }
}

/**
 * `start`: a new conversation fed the brief. Answered at once (protocol 2.99.0): declined when the folder
 * is no project or Antigravity is not installed, else ACCEPTED under the id its run will have, and agy is
 * started after the answer — it boots and is waited for until it says its conversation's id (up to a
 * minute), far longer than the host waits: the person was told it did not answer while the conversation
 * started anyway. What it came to goes to the host as `tasks.report`, said in the person's Inbox.
 */
export async function startTask(params: { project: string; brief: string; place: ConversationPlace | null; title: string }, needs: AdoptNeeds): Promise<AgentTaskStartResult> {
  const root = projectRoot(params.project)
  if (!root.ok) return { outcome: 'declined', session: null, why: root.error.slice(0, 400), pending: false }
  if (!needs.program.find().file) return { outcome: 'declined', session: null, why: `${needs.program.name} is not installed on this computer.`, pending: false }
  const id = needs.program.newId()
  return acceptTask(
    id,
    async () => {
      const started = await needs.task(root.value, taskPlace(params.place), params.brief, params.title, id)
      return started.ok ? { ok: true, conversation: started.session } : { ok: false, why: started.why.slice(0, 400) }
    },
    { module: ID, ...needs.report, log: needs.report?.log ?? ((line) => console.log(`antigravity: ${line}`)) },
  )
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/**
 * The three routes, asked before the protocol's doors (`Before`): they need the request's headers, which
 * the doors do not hand `answer`. Every one is refused with 403 unless the host vouches for it.
 */
export function adoptDoor(needs: () => AdoptNeeds, vouch: typeof vouchHost = vouchHost): Before {
  return async (request, { url }) => {
    const path = url.pathname
    if (path !== ROUTES.find && path !== ROUTES.bring && path !== ROUTES.start) return undefined
    if (request.method.toUpperCase() !== 'POST') return json({ ok: false, error: 'this door takes POST' }, 405)
    const vouched = await vouch(request.headers)
    if (!vouched.ok) return json({ ok: false, error: vouched.why }, 403)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, error: 'the body must be JSON' }, 400)
    }
    if (path === ROUTES.find) {
      const parsed = conversationsFindParams.safeParse(body)
      if (!parsed.success) return json({ ok: false, error: 'that is not a find request' }, 400)
      return json({ conversations: await findConversations(parsed.data, needs()) })
    }
    if (path === ROUTES.bring) {
      const parsed = conversationsBringParams.safeParse(body)
      if (!parsed.success) return json({ ok: false, error: 'that is not a bring request' }, 400)
      return json(bringConversation(parsed.data, needs()))
    }
    const parsed = agentTaskStartParams.safeParse(body)
    if (!parsed.success) return json({ ok: false, error: 'that is not a task' }, 400)
    return json(await startTask(parsed.data, needs()))
  }
}
