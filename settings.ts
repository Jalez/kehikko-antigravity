import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, normalize, sep } from 'node:path'

import { ACT_ON_MESSAGES_SETTING, KEHIKOT_DIR, WAKE_ON_MESSAGES_SETTING, settingValueIssue, settingsDeclarationSchema, type SettingField } from 'kehikot-module-protocol'

/**
 * Antigravity's settings as a host shows them (protocol 2.15.0, `declares.settings`), kept in the
 * project's `.kehikot/antigravity/settings.json` — the same file the page's toggle writes, in the
 * same format. Pure; the door is in `doors.ts`, the arguments a setting becomes are `sessionFlags`.
 *
 * Each is the person's (`personOnly`): an agent is refused. Resuming a conversation a restart cut
 * off sends a sentence on the person's account; the model and its effort change what a session
 * costs; the mode is how often the CLI asks before it acts.
 *
 * What is NOT a setting here, on purpose: the sandbox, `--dangerously-skip-permissions` and the
 * `auto` mode (which approves commands by itself). A session opened here has the sandbox and
 * permissions the same `agy` would have in a terminal in that folder, and nothing on this page or
 * this door can widen them beyond the mode the person picks here, which the CLI also offers with
 * Shift+Tab.
 *
 * "Other folders sessions may work in" (`folders`) is the one that reaches past the project: each
 * folder becomes one more `--add-dir`, so a session reads there as it reads in its project, without
 * asking file by file (the CLI's permissions page: workspace files are allowed, files outside it
 * ask). It is the person's own list, checked folder by folder (`folderIssue`): an existing
 * directory, never `/`, the home folder or a folder holding it, a system folder, or where the CLI
 * and the shell keep their secrets. Writes and commands there still ask as the mode says.
 */

export const SETTINGS_FILE = `${KEHIKOT_DIR}/antigravity/settings.json`

/** The reasoning efforts `agy --effort` takes (1.4.12's `--help`), and none: the CLI's own default. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** The modes `agy --mode` takes that never approve a command by themselves (`auto` does, so it is not offered). */
const MODES = ['accept-edits', 'plan'] as const

export const SETTINGS: SettingField[] = settingsDeclarationSchema.parse([
  {
    key: 'resumeCutOff',
    label: 'Resume conversations cut off by a restart',
    description: 'A conversation a restart stopped mid-turn is told what happened when you open it again, and carries on. Off: it waits for you.',
    type: 'boolean',
    default: true,
    personOnly: true,
  },
  {
    key: 'model',
    label: 'Model for new sessions',
    description: 'The model a session started or resumed here asks for, as `agy models` names it. Empty: what your Antigravity settings say.',
    type: 'string',
    default: '',
    personOnly: true,
  },
  {
    key: 'effort',
    label: 'Reasoning effort',
    description: 'How hard the model thinks before it answers, for sessions started or resumed here. Your Antigravity settings decide when this is left at its default.',
    type: 'choice',
    choices: [{ value: 'default', label: 'Antigravity settings' }, ...EFFORTS.map((one) => ({ value: one, label: one }))],
    default: 'default',
    personOnly: true,
  },
  {
    key: 'mode',
    label: 'Agent mode',
    description: 'Accept edits: file edits go through without asking, commands still ask. Plan: it researches and plans without making changes. Auto mode is never set from here.',
    type: 'choice',
    choices: [
      { value: 'default', label: 'Antigravity settings' },
      { value: 'accept-edits', label: 'Accept edits' },
      { value: 'plan', label: 'Plan' },
    ],
    default: 'default',
    personOnly: true,
  },
  {
    key: 'folders',
    label: 'Other folders sessions may work in',
    description:
      'Folders outside this project that sessions here may read without asking file by file, one absolute path a line. Edits and commands there still ask as the mode says. Applies when a session starts or restarts.',
    type: 'list',
    default: [],
    personOnly: true,
  },
  /* (protocol 2.43.0) The protocol's own two, the same in every agent module: a message wakes an idle session, and may be acted on. */
  WAKE_ON_MESSAGES_SETTING,
  ACT_ON_MESSAGES_SETTING,
])

/** A project's settings for this module. */
export interface Settings {
  resumeCutOff: boolean
  model: string
  effort: string
  mode: string
  /** Absolute folders beside the project that its sessions are given as workspace folders (`--add-dir`). */
  folders: string[]
  /** Type one line into an idle session's prompt when a message comes for it (protocol 2.43.0). */
  wakeOnMessages: boolean
  /** Sessions here may act on requests from other agent sessions in the project (protocol 2.43.0). */
  actOnMessages: boolean
}

export const DEFAULTS: Settings = { resumeCutOff: true, model: '', effort: 'default', mode: 'default', folders: [], wakeOnMessages: true, actOnMessages: true }

/** Folders that, with everything inside them, are the system's: never a session's workspace. */
const SYSTEM = ['/System', '/Library', '/bin', '/sbin', '/usr', '/etc', '/dev', '/cores', '/Applications', '/private/etc', '/private/var/db', '/private/var/root']
/** Folders that are too wide to hand over whole, though what is inside them may be fine. */
const WIDE = ['/', '/Users', '/Volumes', '/private', '/private/var', '/var', '/tmp', '/private/tmp', '/opt', '/Network']
/** Folders in the home folder, with everything inside them, that hold the CLI's account or the person's keys. */
const SECRET = ['.gemini', '.ssh', '.gnupg', '.aws', '.config/gcloud', '.kube', '.docker', 'Library']

const within = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep)
const homeFolder = (): string => normalize(process.env.HOME || homedir())

/** Why a path cannot be one of the folders a session is given, judged by its spelling alone; null when it can. */
function spelledIssue(path: string, home: string): string | null {
  if (!path || !isAbsolute(path)) return `“${path.slice(0, 120)}” is not an absolute path: start it with /.`
  const at = normalize(path).replace(/(.)\/+$/, '$1')
  if (at === '/') return 'The whole disk cannot be given to a session.'
  if (at === home) return 'Your whole home folder cannot be given to a session: name the folders in it.'
  if (within(home, at)) return `${at} holds your home folder: name the folders you mean instead.`
  if (WIDE.includes(at)) return `${at} is too wide to give a session: name the folders in it you mean.`
  if (SYSTEM.some((one) => within(at, one))) return `${at} is a system folder; sessions are not given those.`
  const secret = SECRET.find((one) => within(at, `${home}${sep}${one}`))
  if (secret) return `${at} is where your ${secret === 'Library' ? 'apps keep their data' : 'keys or accounts are kept'}; sessions are not given it.`
  return null
}

/**
 * Why `path` cannot be one of the folders a session here is given, or null. With `exists`, also
 * that it is a directory on this machine now, judged by both its spelling and where it leads (a
 * link to a system folder is that system folder). Without, by its spelling alone: how a saved list
 * is read, so that a folder that is away for a while is not dropped from the person's list.
 */
export function folderIssue(path: string, options: { exists?: boolean; home?: string } = {}): string | null {
  const home = options.home ?? homeFolder()
  const spelled = spelledIssue(path, home)
  if (spelled || !options.exists) return spelled
  let real: string
  try {
    real = realpathSync(path)
    if (!statSync(real).isDirectory()) return `${path} is not a folder.`
  } catch {
    return `There is no folder at ${path}.`
  }
  let realHome = home
  try {
    realHome = realpathSync(home)
  } catch {
    /* No home folder on disk: judged by its spelling. */
  }
  return real === normalize(path) ? null : spelledIssue(real, realHome)
}

/** A model name as the CLI takes one: no quotes, nothing that is not a model's name ("Gemini 3.8 Flash (High)" has spaces and brackets). */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9 ._:/()-]{0,79}$/

/** Why `value` cannot be setting `key`, or null. Beyond the protocol's type check: a model is one name. */
export function settingIssue(key: string, value: unknown): string | null {
  const field = SETTINGS.find((one) => one.key === key)
  if (!field) return `Antigravity has no setting called "${key.slice(0, 64)}".`
  const wrong = settingValueIssue(field, value)
  if (wrong) return `${field.label}: ${wrong}.`
  if (key === 'model' && value !== '' && !MODEL.test(String(value))) return 'A model is one name, as `agy models` lists it.'
  if (key === 'folders') {
    for (const one of value as string[]) {
      if (!one.trim()) continue
      const issue = folderIssue(one.trim(), { exists: true })
      if (issue) return issue
    }
  }
  return null
}

/** Settings off a file, each value the default where the file says nothing it could be. */
export function settingsOf(raw: unknown): Settings {
  const said = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (key === 'folders') continue
    if (Object.hasOwn(said, key) && settingIssue(key, said[key]) === null) (out as Record<string, unknown>)[key] = said[key]
  }
  out.folders = foldersOf(said.folders)
  return out
}

/** The folders off a file: trimmed, each one that could be one by its spelling, in order, once. A folder away for now stays listed. */
function foldersOf(raw: unknown): string[] {
  if (!Array.isArray(raw) || settingValueIssue({ type: 'list' }, raw) !== null) return []
  const out: string[] = []
  for (const one of raw as string[]) {
    const at = normalize(one.trim()).replace(/(.)\/+$/, '$1')
    if (one.trim() && folderIssue(one.trim()) === null && !out.includes(at)) out.push(at)
  }
  return out
}

/**
 * The folders a session of `projectPath` is given beside its project, now: each listed folder that
 * is a directory on this machine and passes `folderIssue`, never the project itself or a folder in
 * it (already in its workspace). A folder away for now is left out, and given again when it is back.
 */
export function extraFolders(settings: Pick<Settings, 'folders'>, projectPath: string): string[] {
  const project = normalize(projectPath)
  return settings.folders.filter((one) => folderIssue(one, { exists: true }) === null && !within(one, project))
}

/** The CLI's arguments for those folders: one `--add-dir` each (`agy --help`: "Add a directory to the workspace (repeatable)"). */
export const folderFlags = (folders: readonly string[]): string[] => folders.flatMap((one) => ['--add-dir', one])

/**
 * The arguments a project's settings give a session started or resumed here: `--model`, `--effort`
 * and `--mode`, each for that one session (`agy --help`: "for the current CLI session"). Nothing for
 * a setting left at its default — the person's own Antigravity settings then decide, as in any
 * terminal.
 */
export function sessionFlags(settings: Settings): string[] {
  const out: string[] = []
  if (settings.model && MODEL.test(settings.model)) out.push('--model', settings.model)
  if ((EFFORTS as readonly string[]).includes(settings.effort)) out.push('--effort', settings.effort)
  if ((MODES as readonly string[]).includes(settings.mode)) out.push('--mode', settings.mode)
  return out
}
