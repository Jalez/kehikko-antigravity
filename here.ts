import { basename } from 'node:path'

import { freshToken } from './doorConfig.ts'
import { placeOf, type Showing } from './live.ts'
import { isKehikkoKey, placeKey } from './place.ts'
import { hasRecord, type Program } from './program.ts'
import { assign, homeOf, ownOf, projectRoot, readPlaces, tokenFor, type NamedPlace, type Places } from './record.ts'

/**
 * `/kehikot-here`: a person types it in an Antigravity conversation, and that conversation is
 * assigned to the kehikko they have on screen.
 *
 * A conversation started from an Antigravity container does not need it: it is filed under the place it
 * was started at by itself, the same way (`autoFile` in context.ts). `/kehikot-here` is for one
 * started anywhere else, and for moving one.
 *
 * ## Why a skill can, where the MCP door cannot
 *
 * The CLI tells an MCP server the calling conversation only as `_meta` on a tool call
 * (`antigravity.google/root_conversation_id`), which this module's door does not trust from a
 * caller. A command it runs is different: the CLI exports `ANTIGRAVITY_CONVERSATION_ID` to what it
 * runs (found in the CLI; not measured with an account). The skill (`plugin/skills/kehikot-here/
 * SKILL.md`) has the model run one `curl` to `POST /api/here?session=$ANTIGRAVITY_CONVERSATION_ID&
 * folder=$PWD&say=<words>` on this module's port, and repeat the answer.
 *
 * ## What the door believes, and what it does not
 *
 * Anything on this machine can reach the door without a ticket, so the id and the folder are
 * claims. The folder is an agy process's own when one started on that conversation by id is
 * running; otherwise the claimed folder is taken only for a conversation this computer has a
 * record of (`brain/<id>/`). Either way it must be a project the host holds. An id nothing has
 * seen is refused.
 *
 * The target is never guessed: the place a framed page of this module has on screen in that
 * project, with an Antigravity container on the open kehikko (`Runs.showingIn`). None, or more than one,
 * is said with the kehikot to choose from (`kehikko: <key>`), and nothing is written.
 *
 * What it can do is what "Assign here" in the container does: file one conversation under one
 * place of its own project, and make it that place's own when it had none or `own` was said. It
 * starts, ends and types nothing, and what it writes is undone the same way as a press.
 */

/** What answers start with, so the skill can tell this module's answer from anything else on the port. */
export const SAID = 'Kehikot:'

export interface HereNeeds {
  program: Program
  /** The places pages have on screen in a project, latest first (`Runs.showingIn`). */
  showingIn(projectPath: string): Showing[]
  /** The projects this server knows: where a record is looked for when the program cannot be asked. */
  knownProjects(): string[]
  /** Whether the host holds a folder as a project. */
  hostHas(folder: string): Promise<boolean>
  /** The record changed under this project: the lists are said again, and the page on `assigned`'s place puts it on screen. */
  told(projectPath: string, assigned?: { key: string; session: string }): void
  env?: NodeJS.ProcessEnv
}

/** What a person can add after `/kehikot-here`. */
export function readSay(say: string): { own: boolean; kehikko: string | null } | null {
  let rest = ` ${say.slice(0, 200)} `
  let kehikko: string | null = null
  const named = /\skehikko\s*[:=]\s*(\S+)\s/i.exec(rest)
  if (named) {
    kehikko = named[1]!.toLowerCase()
    if (!isKehikkoKey(kehikko)) return null
    rest = rest.replace(named[0], ' ')
  }
  const own = /\sown\s/i.test(rest)
  rest = rest.replace(/\sown(?=\s)/gi, ' ')
  return rest.trim() ? null : { own, kehikko }
}

const partsSaid = (place: NamedPlace): string => {
  if (!place.parts.length) return 'whole epic'
  return place.parts.map((part, i) => place.partNames?.[i] || part).join(' + ')
}

/** A place in words: "writing · thesis (Methods + Results)". */
export function placeWords(place: NamedPlace): string {
  return `${place.kehikkoName || 'the kehikko'} · ${place.epic ?? 'no epic'} (${partsSaid(place)})`
}

const titleOf = (places: Places, id: string): string => {
  const label = Object.hasOwn(places.sessions, id) ? places.sessions[id]?.label : ''
  return label ? `“${label}”` : 'an untitled conversation'
}

/**
 * Where a conversation is running, as the program says — the folder of an agy process started on it
 * by id (`active` in program.ts) — or else the folder the skill said it runs in (`$PWD` of the
 * command the CLI ran), for a conversation this computer has a record of (`hasRecord`). The CLI
 * keeps no lock that says which process holds a conversation opened another way, so the claimed
 * folder is believed only as far as the rest of `here` checks it: a project the host holds.
 */
async function folderOf(id: string, claimed: string, needs: HereNeeds): Promise<{ folder: string; via: 'running' | 'claimed' } | null> {
  const found = needs.program.find(needs.env)
  if (found.file && (await needs.program.supports(found.file)).lists) {
    const running = await needs.program.active(found.file, needs.env)
    if (running.known) {
      const it = running.active.find((one) => one.session === id)
      if (it?.cwd) return { folder: it.cwd, via: 'running' }
    }
  }
  if (!claimed.startsWith('/') || claimed.length > 4096 || /[\u0000-\u001f]/.test(claimed)) return null
  return hasRecord(id, needs.env) ? { folder: claimed, via: 'claimed' } : null
}

/** The kehikot the record knows in a project, one line each, with what to type. */
function choices(places: Places | null, showing: readonly Showing[]): string[] {
  const lines = new Map<string, string>()
  for (const one of showing) {
    const key = one.place.kehikko && 'key' in one.place.kehikko ? one.place.kehikko.key : null
    if (key && !lines.has(key)) lines.set(key, `/kehikot-here kehikko: ${key}  (${placeWords(one.place)}, on screen)`)
  }
  for (const entry of Object.values(places?.places ?? {})) {
    const key = entry.kehikko && 'key' in entry.kehikko ? entry.kehikko.key : null
    if (key && !lines.has(key)) lines.set(key, `/kehikot-here kehikko: ${key}  (${entry.kehikko?.name || 'a kehikko'})`)
  }
  return [...lines.values()].slice(0, 12)
}

const listed = (lines: readonly string[]): string => lines.map((line) => `\n  ${line}`).join('')

/**
 * Do what `/kehikot-here <say>` asks for the conversation `id`, and say what was done in one
 * answer for the person — always starting with `SAID`. Nothing is written unless it says
 * "Assigned".
 */
export async function here(id: string, say: string, needs: HereNeeds, claimed = ''): Promise<string> {
  if (!needs.program.isId(id)) return `${SAID} That is not an Antigravity conversation’s id, so nothing was assigned.`
  const asked = readSay(say)
  if (!asked) return `${SAID} /kehikot-here takes “own” and “kehikko: <key>”, and nothing else. Nothing was assigned.`

  const where = await folderOf(id, claimed, needs)
  if (!where) {
    return `${SAID} This computer has no record of this Antigravity conversation, so nothing was assigned.`
  }
  const root = projectRoot(where.folder)
  if (!root.ok || !(await needs.hostHas(root.value))) {
    return `${SAID} This conversation runs in ${where.folder}, which is not a project in Kehikot, so nothing was assigned. Open that folder as a project, or type /kehikot-here in a conversation started in one.`
  }
  const project = root.value
  const name = basename(project)
  const read = readPlaces(project)
  const places = read.ok ? read.value : null
  const showing = needs.showingIn(project)

  let place: NamedPlace | null = null
  if (asked.kehikko) {
    const key = asked.kehikko
    const onIt = (one: { kehikko: unknown }) => typeof one.kehikko === 'object' && one.kehikko !== null && 'key' in one.kehikko && one.kehikko.key === key
    const shown = showing.filter((one) => onIt(one.place))
    if (shown.length) place = shown[0]!.place
    else {
      const kept = Object.values(places?.places ?? {}).filter((entry) => onIt(entry))
      if (kept.length === 1) place = { ...placeOf(kept[0]!) }
      else if (kept.length > 1) {
        return `${SAID} The kehikko ${kept[0]!.kehikko?.name || key} has ${kept.length} places in ${name} (${kept.map((entry) => (entry.epic ?? 'no epic') + (entry.parts.length ? ` · ${entry.parts.join(' + ')}` : '')).join('; ')}), so nothing was assigned. Open it with the epic and parts you mean, and type /kehikot-here again.`
      } else {
        const can = choices(places, showing)
        return `${SAID} No kehikko ${key} with an Antigravity container is known in ${name}, so nothing was assigned.${can.length ? ` Type one of:${listed(can)}` : ''}`
      }
    }
  } else if (showing.length === 1) {
    place = showing[0]!.place
  } else if (showing.length > 1) {
    return `${SAID} ${showing.length} kehikot with an Antigravity container are on screen in ${name}, so nothing was assigned. Say which:${listed(choices(places, showing))}`
  } else {
    const can = choices(places, [])
    return (
      `${SAID} No kehikko with an Antigravity container is on screen in ${name}, so nothing was assigned. Open the kehikko this conversation belongs to and type /kehikot-here again`
      + (can.length ? `, or name one:${listed(can)}` : '.')
    )
  }

  const key = placeKey(place)
  const said = placeWords(place)
  const before = places ?? { version: 1, places: {}, sessions: {} }
  const hadOwn = ownOf(before as Places, key)
  if (homeOf(before as Places, id) === key && (hadOwn === id || !asked.own)) {
    return hadOwn === id
      ? `${SAID} This conversation is already this kehikko’s own (${said}). Nothing changed.`
      : `${SAID} This conversation is already assigned to ${said}; ${titleOf(before as Places, hadOwn!)} is this kehikko’s own. Type /kehikot-here own to make this one its own instead.`
  }
  const written = assign(project, place, id, { own: asked.own })
  if (!written.ok) return `${SAID} The record could not be written (${written.error}), so nothing was assigned.`
  /* Its token, so the doors of a session this module gives them to know its place now. */
  tokenFor(project, id, freshToken)
  needs.told(project, { key, session: id })

  if (!hadOwn) return `${SAID} Assigned to ${said}. It’s now this kehikko’s own (it had none).`
  if (hadOwn === id) return `${SAID} Assigned to ${said}. It is this kehikko’s own.`
  if (asked.own) return `${SAID} Assigned to ${said}, as this kehikko’s own: it replaced ${titleOf(before as Places, hadOwn)}.`
  return `${SAID} Assigned to ${said}. ${titleOf(before as Places, hadOwn)} stays this kehikko’s own conversation; type /kehikot-here own to make this one its own instead.`
}
