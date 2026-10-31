import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import { personEnv } from 'kehikot-module-protocol/serve'

import { readPlaces } from './record.ts'

/**
 * The program this module opens, and everything that is specific to it.
 *
 * ## This is the only file that knows it is the Antigravity CLI
 *
 * The rest of the module is a terminal that holds one session per place: a pty, a record of
 * which session belongs where, a list to choose from. Everything that knows the program is
 * Google's Antigravity CLI (`agy`) is here, as one value of one interface — `Program`, the same
 * interface the Claude and Codex modules answer for their agents.
 *
 * What a program has to answer, and it is the whole list:
 *
 *  1. **Where is the binary?** (`find`) The desktop app starts modules with a thin PATH.
 *  2. **Can this copy do what is asked of it?** (`supports`), read off `agy --help`.
 *  3. **How is a new session started, and how is one resumed?** (`fresh`, `resume`) As argv.
 *  4. **Does a session exist yet, and under which id?** (`settled`) The CLI chooses a new
 *     conversation's id itself; the session's own hooks and status line name it (`learnSession`).
 *  5. **Which sessions does it hold for a folder?** (`sessions`) Only the ones this module knows.
 *  6. **How is it installed?** (`install`)
 *  7. **Can it say what it is doing?** (`TELLS`, `signal`, `oscEvent`) Its lifecycle hooks, and
 *     the terminal status it writes over OSC 7501.
 *  8. **Is a session already open in another process?** (`active`) Asked of `ps`, for the `agy`
 *     processes started on a conversation by id.
 *
 * ## What is never here
 *
 * A prompt of anybody's but the person's: the person types. The one sentence this module ever
 * sends is its own, fixed, to a conversation a restart cut off mid-turn, when the person opens it
 * again, behind a setting they can turn off (`RESUME_LINE` in live.ts). And no flag that widens
 * what the program may do: never `--dangerously-skip-permissions`, never `--mode auto`, nothing
 * about the sandbox. A session opened here has exactly the permissions `agy` would have in any
 * terminal in that folder, but for the mode the person chose in Settings (settings.ts).
 *
 * ## Every command line this module ever runs, and it is the whole list
 *
 *     agy --help                                               once per binary: which flags it has
 *     agy [--conversation <id> [-i <line>]] --add-dir <kit> [--settings <file>] [--model m] [--effort e] [--mode m]
 *     ps -axo pid=,args=                                       which agy process holds which conversation: reads
 *     lsof -a -d cwd -F pn -p <pids>                           the folder each of those runs in: reads
 *
 * `--add-dir <kit>` makes the session's own folder a workspace root, and the CLI reads `.agents/`
 * at every workspace root (the docs' "Customization discovery"): its hooks (`.agents/hooks.json`),
 * its MCP doors (`.agents/mcp_config.json`) and its skills (`.agents/skills/<name>/SKILL.md`).
 * `--settings <file>` is "settings for this session only, never saved" (`agy --help`): it carries
 * the status line that reports the session's context. Nothing in `~/.gemini` is written.
 *
 * Checked against `agy --help` of 1.4.12 and the docs at antigravity.google/docs (read
 * 2026-10-31). The CLI was not run with an account: the tests run a stand-in (test/stand-in/agy).
 */

export interface Found {
  /** The binary, absolute, or null when no candidate is an executable file. */
  file: string | null
  /** Every directory looked in, in the order it was looked in. */
  looked: string[]
  /** The ones among them that are not from PATH: the usual places an install lands. */
  usual: string[]
}

export interface Able {
  ok: boolean
  /** What this copy lacks, for the sentence on screen. Null when ok, or when nothing could be told. */
  missing: string | null
  /** Whether this copy reads a session's hooks from a folder given for one process (`--add-dir`): how a session says what it is doing. */
  tells: boolean
  /** Whether this copy can be asked which process holds a conversation. */
  lists: boolean
  /** Whether this copy takes a display name for a session. The CLI does not. */
  names?: boolean
  /** Whether this copy takes MCP servers for one process (`--add-dir`'s `.agents/mcp_config.json`): how a session is given its place. */
  configures?: boolean
  /** Whether a session can be given this module's skills: they live in the same folder as its hooks, so with `tells`. */
  plugins?: boolean
  /** Whether this copy runs a session in the background that outlives this process. Not here (see `fresh`). */
  backgrounds?: boolean
  /** Whether this copy takes settings for one process (`--settings`): how its status line is given. */
  settings?: boolean
}

/** A session started or woken in the background, or why not. Never, here: the type stays for the interface. */
export type Backgrounded = { ok: true; handle: string; active: Active } | { ok: false; why: string }

/** One conversation a process holds now. */
export interface Active {
  session: string
  /** Always `interactive` here: nothing the CLI runs can be attached to. */
  kind: 'background' | 'interactive' | 'other'
  called: string
  /** What `attach` would take. Null: the CLI has no attach. */
  handle: string | null
  pid: number | null
  cwd: string
  startedAt: number | null
  name: string
  state?: State | null
  status?: ActiveStatus | null
}

export type ActiveStatus = 'idle' | 'busy' | 'waiting' | 'shell'

export type Running = { known: true; active: Active[] } | { known: false; why: 'too-old' | 'failed' }

/** What a session is doing, as far as its program says. */
export type State = 'working' | 'needs-you' | 'finished'
export const STATES: readonly State[] = ['working', 'needs-you', 'finished']

/** One session as the program's own records describe it. */
export interface Recorded {
  id: string
  /** What the session is called: the CLI's own title for it, one line, cut short. `''` when none is known. */
  label: string
  firstPrompt?: string
  lastPrompt?: string
  prs?: { number: number; url: string }[]
  /** The sessions this conversation was carried on in. The CLI resumes a conversation under its own id, so none. */
  next?: string[]
  /** When the record last grew, in milliseconds. */
  lastActive: number
}

export interface Install {
  line: string
  lands: string
  source: string
  checked: string
}

/** One group of hook handlers for one event: every command runs, in order. */
export interface HookGroup {
  event: HookEvent
  /** A regex the CLI matches against the tool name, for PreToolUse and PostToolUse only. */
  matcher?: string
  commands: { command: string; timeout: number }[]
}

export interface Program {
  name: string
  binary: string
  find(env?: NodeJS.ProcessEnv): Found
  supports(file: string): Promise<Able>
  newId(): string
  isId(id: string): boolean
  fresh(id: string, name?: string): string[]
  resume(id: string, name?: string, line?: string): string[]
  settled(projectPath: string, id: string, since: number): Promise<string | null>
  sessions(projectPath: string, also?: readonly string[]): Promise<Recorded[]>
  install(env?: NodeJS.ProcessEnv): Install
  /** The environment the installer runs in: the one given, with the usual places added to PATH. */
  installEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  /** What to tell the person when the installer ended without a binary: plain words and the next step. */
  explain(output: string, exitCode: number, ran: string, env?: NodeJS.ProcessEnv): string
  environment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  /** The arguments that give one process its own folder (hooks, doors, skills) and its one-run settings. */
  kitArgs(kitDir: string, settingsFile: string | null): string[]
  signal(event: string): State | null
  active(file: string, env?: NodeJS.ProcessEnv): Promise<Running>
}

/* ------------------------------------------------------------------------ *
 * The Antigravity CLI
 * ------------------------------------------------------------------------ */

const BINARY = 'agy'

/** The home folder as the environment names it, which is what the program itself goes by. */
export function home(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || homedir()
}

/**
 * Where the CLI keeps what it knows: `~/.gemini/antigravity-cli` (its "app data dir" in the hooks
 * docs). Read, never written, and only for one thing: whether a conversation has a folder there
 * (`brain/<id>/`), where its transcript lives. A test points HOME at a scratch folder.
 */
export function agyHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(home(env), '.gemini', 'antigravity-cli')
}

/** The places an install usually lands that a thin PATH leaves out: the vendor's installer's (`~/.local/bin`), Homebrew's and Bun's. */
function usualDirs(env: NodeJS.ProcessEnv): string[] {
  const at = home(env)
  return [join(at, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(at, '.bun', 'bin')]
}

/** PATH with the usual places added after it, so `curl` and `bash` are found under the desktop app's thin one. */
function installPath(env: NodeJS.ProcessEnv): string {
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...usualDirs(env), '/usr/bin', '/bin']
  return [...new Set(dirs)].join(delimiter)
}

function runnable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function find(env: NodeJS.ProcessEnv = process.env): Found {
  const looked: string[] = []
  const usual = usualDirs(env)
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...usual]
  for (const dir of dirs) {
    if (looked.includes(dir)) continue
    looked.push(dir)
    const file = join(dir, BINARY)
    if (runnable(file)) return { file, looked, usual }
  }
  return { file: null, looked, usual }
}

/**
 * What `supports` needs of `agy --help`, as 1.4.12 prints it (checked, not written from memory):
 *
 *     --add-dir        Add a directory to the workspace (repeatable) (default [])
 *     --conversation   Resume a previous conversation by ID
 *     --settings       Settings for this session only, never saved: a JSON object of settings.json keys, inline or as a file path
 */
const NEEDS: readonly { said: string; test: RegExp }[] = [{ said: '--conversation', test: /--conversation\b/ }]
const ADD_DIR = /--add-dir\b/
const SETTINGS_FLAG = /--settings\b/

const able = new Map<string, Able>()

/**
 * What the program prints for a command that only answers, read through a real pipe, whole.
 * Standard input closed; `''` for anything that went wrong.
 */
function answered(file: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((done) => {
    const child = execFile('/bin/sh', ['-c', '"$0" "$@" </dev/null 2>&1 | /bin/cat', file, ...args], { timeout: 8000, maxBuffer: 16 * 1024 * 1024, ...(env ? { env } : {}) }, (error, stdout) =>
      done(error ? '' : String(stdout ?? '')),
    )
    child.on('error', () => done(''))
  })
}

/**
 * Whether this copy has what is used, asked once per binary per build. A copy whose help cannot be
 * read at all is NOT called too old: nothing was learned, and nothing extra is passed either.
 */
async function supports(file: string): Promise<Able> {
  let stamp = file
  try {
    stamp = `${file}@${statSync(file).mtimeMs}`
  } catch {
    /* Gone between being found and being asked. */
  }
  const known = able.get(stamp)
  if (known) return known
  const help = await answered(file, ['--help'], environment())
  let said: Able
  if (!help) said = { ok: true, missing: null, tells: false, lists: true, names: false, configures: false, plugins: false, backgrounds: false, settings: false }
  else {
    const missing = NEEDS.find((one) => !one.test.test(help))?.said ?? null
    const kit = ADD_DIR.test(help)
    said = { ok: missing === null, missing, tells: kit, lists: true, names: false, configures: kit, plugins: kit, backgrounds: false, settings: SETTINGS_FLAG.test(help) }
  }
  able.set(stamp, said)
  return said
}

/* ------------------------------------------------------------------------ *
 * Its records: ~/.gemini/antigravity-cli/brain/<conversation id>/
 * ------------------------------------------------------------------------ */

/** A conversation id as the CLI spells one: a UUID (the hooks docs' `conversationId`). */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Where a conversation's folder is: `brain/<id>/` under the CLI's app data dir. */
export function brainDir(id: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(agyHome(env), 'brain', id)
}

/** Where the CLI writes a conversation's transcript (the hooks docs' `transcriptPath`). */
export function transcriptOf(id: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(brainDir(id, env), '.system_generated', 'logs', 'transcript.jsonl')
}

/**
 * The transcript of conversation `id`, or null when this computer has none. Only its size and time
 * are read: its format is not documented, so nothing in it is parsed.
 */
export async function recordFile(_projectPath: string, id: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!SESSION_ID.test(id)) return null
  try {
    return (await stat(transcriptOf(id, env))).isFile() ? transcriptOf(id, env) : null
  } catch {
    return null
  }
}

export const LABEL_CHARS = 80

const line = (text: unknown, most: number): string => {
  const first = typeof text === 'string' ? (text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').split('\n').map((one) => one.trim()).find(Boolean) ?? '') : ''
  return first.length > most ? `${first.slice(0, most - 1).trimEnd()}…` : first
}

/**
 * The titles the CLI gave conversations, by id, as their status lines said them
 * (`conversation_title`, see status.sh). The CLI's own records are not read for a label: their
 * format is not documented. Kept for this process; the record keeps the label it was given.
 */
const TITLES = new Map<string, string>()

/** Keep a conversation's title; true when it is new. */
export function learnTitle(id: string, title: string): boolean {
  if (!SESSION_ID.test(id)) return false
  const said = line(title, LABEL_CHARS)
  if (!said || TITLES.get(id) === said) return false
  TITLES.delete(id)
  TITLES.set(id, said)
  while (TITLES.size > 2048) TITLES.delete(TITLES.keys().next().value!)
  return true
}

export const titleOf = (id: string): string => TITLES.get(id) ?? ''

/**
 * Conversations a session of this module's own reported (its hooks or status line, during a turn):
 * they exist, whether or not the CLI keeps them where `brainDir` looks.
 */
const VOUCHED = new Set<string>()

/**
 * Whether this computer has conversation `id`: its folder, or a report of a session of this
 * module's. Only where the CLI keeps no `brain/` folder at all — its records elsewhere than the docs
 * say — is the project's record taken for it, so that a conversation is not lost to a layout this
 * module did not foresee; where it does keep one, a conversation without a folder there is missing.
 */
function exists(projectPath: string, id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!SESSION_ID.test(id)) return false
  if (VOUCHED.has(id) || existsSync(brainDir(id, env))) return true
  if (!projectPath || existsSync(join(agyHome(env), 'brain'))) return false
  const read = readPlaces(projectPath)
  return read.ok && Object.hasOwn(read.value.sessions, id)
}

async function lastActiveOf(id: string, fallback: number, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  for (const file of [transcriptOf(id, env), brainDir(id, env)]) {
    try {
      return (await stat(file)).mtimeMs
    } catch {
      /* Next. */
    }
  }
  return fallback
}

/**
 * The conversations of a project, as far as this module can tell: the ones its record holds and the
 * ones asked for, that this computer has. The CLI's own list (`/resume`) is not readable from here —
 * its records are not documented — so a conversation started outside Kehikot is listed only once
 * `/kehikot-here` filed it.
 */
async function sessions(projectPath: string, also: readonly string[] = []): Promise<Recorded[]> {
  const read = projectPath ? readPlaces(projectPath) : null
  const recorded = read?.ok ? read.value.sessions : {}
  const ids = new Set([...also.filter((id) => SESSION_ID.test(id)), ...Object.keys(recorded).filter((id) => SESSION_ID.test(id))])
  const found: Recorded[] = []
  for (const id of ids) {
    if (!exists(projectPath, id)) continue
    const entry = Object.hasOwn(recorded, id) ? recorded[id] : undefined
    const label = titleOf(id) || entry?.label || ''
    const kept = entry?.lastActive ? Date.parse(entry.lastActive) : NaN
    const lastActive = await lastActiveOf(id, Number.isFinite(kept) ? kept : 0)
    found.push({ id, label, firstPrompt: label, lastPrompt: '', prs: [], next: [], lastActive })
  }
  return found.sort((a, b) => b.lastActive - a.lastActive)
}

/** Where a conversation is now, from an id it was once under. The CLI keeps one id per conversation, so it is that id. */
export function headOf(id: string, _held?: ReadonlyMap<string, Recorded>, _live?: ReadonlySet<string>): string {
  return id
}

/** A place's name: one line, no control characters, never starting with a dash, short. */
export function sessionName(words: readonly (string | null | undefined)[]): string {
  const said = words.map((one) => (one ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ')
  return said.replace(/^-+\s*/, '').slice(0, 120)
}

/* ------------------------------------------------------------------------ *
 * A new session's id, which the CLI chooses
 * ------------------------------------------------------------------------ */

/**
 * The id the CLI gave each new session this module started, by the id this module opened it under.
 *
 * The CLI takes no conversation id on its command line for a new conversation. Its hooks name it —
 * every hook is handed `conversationId` — and so does its status line (`conversation_id`); `tell.sh`
 * and `status.sh` pass it here beside the run's own id, which only this module and the session's
 * environment know. A conversation switched to in the same process (`/resume`, a new one) is said
 * the same way.
 */
const LEARNED = new Map<string, string>()

export function learnSession(opened: string, session: string): void {
  if (!SESSION_ID.test(opened) || !SESSION_ID.test(session)) return
  LEARNED.delete(opened)
  LEARNED.set(opened, session)
  VOUCHED.add(session)
  while (LEARNED.size > 1024) LEARNED.delete(LEARNED.keys().next().value!)
}

/** A session of this module's said it is on `session`, during a turn: it exists. */
export function vouch(session: string): void {
  if (SESSION_ID.test(session)) VOUCHED.add(session)
}

async function settled(projectPath: string, id: string): Promise<string | null> {
  const real = LEARNED.get(id) ?? id
  return exists(projectPath, real) ? real : null
}

/** What `/kehikot-here` takes as a recorded conversation's folder: none is readable from the CLI's records. */
export async function folderOfRecord(_id: string): Promise<string | null> {
  return null
}

/** Whether this computer has a record of conversation `id` at all (its folder under `brain/`). */
export function hasRecord(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return SESSION_ID.test(id) && (VOUCHED.has(id) || existsSync(brainDir(id, env)))
}

/* ------------------------------------------------------------------------ *
 * How it is installed
 * ------------------------------------------------------------------------ */

/**
 * How the Antigravity CLI is installed, from the vendor's own page.
 *
 *   Source: https://antigravity.google/docs/getting-started?tab=cli — macOS and Linux:
 *   `curl -fsSL https://antigravity.google/cli/install.sh | bash`, which puts `agy` in
 *   `~/.local/bin`. No Homebrew formula or npm package is documented. Read 2026-10-31.
 *
 * It needs no admin rights. It is DATA: nothing in this file runs it — `live.ts` does, in a pty the
 * person is looking at, and only after a press in the page. Signing in is the CLI's own first
 * screen afterwards.
 */
const SOURCE = 'https://antigravity.google/docs/getting-started?tab=cli'
const CHECKED = '2026-10-31'
const LINE = 'curl -fsSL https://antigravity.google/cli/install.sh | bash'

export function installFor(_env: NodeJS.ProcessEnv = process.env): Install {
  return { line: LINE, lands: '~/.local/bin', source: SOURCE, checked: CHECKED }
}

/** The install command, or the stand-in a test names (`KEHIKOT_ANTIGRAVITY_INSTALL_LINE`, from the environment of whoever started this server). */
function install(env: NodeJS.ProcessEnv = process.env): Install {
  const said = env.KEHIKOT_ANTIGRAVITY_INSTALL_LINE
  const chosen = installFor(env)
  return said ? { ...chosen, line: said } : chosen
}

function installEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, PATH: installPath(env) }
}

/* eslint-disable-next-line no-control-regex */
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

/** Terminal output as plain text. */
export function plain(output: string): string {
  return output.replace(ESCAPES, '').replace(/\r/g, '')
}

/** Whether the installer failed for lack of permission to write where it was asked to. */
export function deniedWrite(output: string): boolean {
  return /\bEACCES\b|permission denied/i.test(plain(output))
}

/**
 * What the person is told when the installer ended and no binary was found: plain words and the
 * next step, never a stack. The whole output stays in the terminal ("See the log").
 */
function explain(output: string, exitCode: number, ran: string): string {
  const text = plain(output)
  if (exitCode === 0) return 'The installer finished, but agy was not found afterwards. See the log.'
  if (deniedWrite(text)) return `The installer can't write where it was asked to. Check that ~/.local/bin is yours, or install the Antigravity CLI another way: ${SOURCE}`
  if (exitCode === 127 || /(curl|bash): (command )?not found/i.test(text)) return `curl or bash was not found. Install the Antigravity CLI from ${SOURCE}.`
  if (/could not resolve host|failed to connect|timed out/i.test(text)) return `The installer could not be downloaded. Check the connection, then try again, or run ${ran} in a terminal.`
  return `The installer exited with ${exitCode}. See the log, or run ${ran} in a terminal.`
}

/**
 * The variables an Antigravity process exports to the commands it runs (found in the CLI). A module
 * started from inside one would hand them on, and the session opened here would believe it was a
 * tool call of another conversation.
 */
const NESTED = [
  'ANTIGRAVITY_CONVERSATION_ID',
  'ANTIGRAVITY_PROJECT_ID',
  'ANTIGRAVITY_PERM_GRANTS',
  'ANTIGRAVITY_CSRF_TOKEN',
  'ANTIGRAVITY_LS_ADDRESS',
  'ANTIGRAVITY_CONTROL_OUT',
  'ANTIGRAVITY_SIDECAR_UI_TOKEN',
  'ANTIGRAVITY_SIDECAR_WEB_PORT',
]

/**
 * A session's environment: the person's (`personEnv`, without the host's own `bun` this module was
 * started with first on its PATH and `BUN_BE_BUN`), without the variables of an Antigravity process
 * it was started inside — and with the CLI asked to say its state over OSC 7501
 * (`AGY_CLI_OSC7501=on`, for a terminal that "supports it but doesn't answer the check": this
 * module reads the reports off the pty, and the screen ignores them). `brief` keeps the pending
 * command or question out of the reports: only the state is read.
 */
function environment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = personEnv(env)
  for (const name of NESTED) delete out[name]
  out.AGY_CLI_OSC7501 = 'on'
  out.AGY_CLI_OSC7501_MESSAGES = 'brief'
  return out
}

/* ------------------------------------------------------------------------ *
 * What it says it is doing: its hooks, and OSC 7501
 * ------------------------------------------------------------------------ */

/**
 * The CLI's hook events (the hooks docs, and the reference built into `agy` 1.4.12):
 *
 *     SessionStart     once, when a new conversation starts, before its first model call
 *     PreInvocation    before each model call
 *     PostInvocation   after each model call
 *     PreToolUse       before a tool runs (matcher: the tool's name)
 *     PostToolUse      after it ran
 *     Stop             when the execution loop ends: the turn is over
 *
 * No event when a permission prompt is drawn, and none for a subagent: the first comes from OSC
 * 7501 (`blocked`, `kind=permission`), the second not at all.
 */
export type HookEvent = 'SessionStart' | 'PreInvocation' | 'PostInvocation' | 'PreToolUse' | 'PostToolUse' | 'Stop'
export const HOOK_EVENTS: readonly HookEvent[] = ['SessionStart', 'PreInvocation', 'PostInvocation', 'PreToolUse', 'PostToolUse', 'Stop']
/** The events whose handlers sit in a group with a `matcher` (the others are a flat list). */
const GROUPED = new Set<HookEvent>(['PreToolUse', 'PostToolUse'])

/**
 * What each report means. `AskUser` is this module's own name for `PreToolUse` of the CLI's
 * question tool (`ask_question`), which puts a question on screen and waits. `Osc*` are the states
 * the CLI writes over OSC 7501 (`oscEvent`). A question asked in prose is a turn that ended,
 * `finished` like any other.
 */
const SIGNALS: Record<string, State> = {
  PreInvocation: 'working',
  PostToolUse: 'working',
  AskUser: 'needs-you',
  Confirm: 'needs-you',
  Stop: 'finished',
  OscWorking: 'working',
  OscBlocked: 'needs-you',
  OscDone: 'finished',
}

/** The events `tell.sh` is run at, each under its event, and the word it says. */
export const TELLS: readonly { event: HookEvent; matcher?: string; says: string }[] = [
  { event: 'SessionStart', says: 'SessionStart' },
  { event: 'PreInvocation', says: 'PreInvocation' },
  { event: 'PreToolUse', matcher: '^ask_question$', says: 'AskUser' },
  { event: 'PostToolUse', matcher: '*', says: 'PostToolUse' },
  { event: 'Stop', says: 'Stop' },
]

/**
 * A session's `hooks.json` (the CLI's format: top-level keys are hook NAMES, each holding events;
 * PreToolUse and PostToolUse take groups of `{ matcher, hooks }`, the others a flat list of
 * handlers). One name, this module's, so `/hooks` shows whose they are.
 */
export function hooksJson(groups: readonly HookGroup[]): string {
  const events: Partial<Record<HookEvent, unknown[]>> = {}
  for (const group of groups) {
    if (!group.commands.length) continue
    const handlers = group.commands.map((one) => ({ type: 'command', command: one.command, timeout: Math.max(1, Math.min(60, Math.trunc(one.timeout))) }))
    const list = (events[group.event] ??= [])
    if (GROUPED.has(group.event)) list.push({ matcher: group.matcher ?? '*', hooks: handlers })
    else list.push(...handlers)
  }
  return `${JSON.stringify({ kehikot: events }, null, 2)}\n`
}

/**
 * The event an OSC 7501 report stands for, or null. A report is `ESC ] 7501 ; key=value:… ST`
 * (the Program Status Protocol: `state` is idle, working, done, blocked, error or clear; `kind`, with
 * blocked, is permission, question or auth). `idle` is a session at its prompt, and `clear` takes a
 * record away: neither is a turn's state. An `id` names a child record (a subagent's): only the
 * root record is the session.
 */
export function oscEvent(body: string): string | null {
  const pairs = new Map<string, string>()
  for (const pair of body.split(':')) {
    const at = pair.indexOf('=')
    if (at <= 0) continue
    pairs.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
  }
  if (pairs.has('id')) return null
  switch (pairs.get('state')) {
    case 'working':
      return 'OscWorking'
    case 'blocked':
      return 'OscBlocked'
    case 'done':
    case 'error':
      return 'OscDone'
    default:
      return null
  }
}

/* eslint-disable-next-line no-control-regex */
const OSC = /\u001b\]7501;([^\u0007\u001b]{1,4096})(?:\u0007|\u001b\\)/g
const OSC_START = '\u001b]7501;'

/**
 * The OSC 7501 reports in a chunk of the pty's output, as events, in order. A report split across
 * two chunks is read when its end arrives: `carry` is what is kept of the last chunk.
 */
export function oscEvents(chunk: string, carry = ''): { events: string[]; carry: string } {
  const text = carry + chunk
  if (!text.includes('\u001b]')) return { events: [], carry: '' }
  const events: string[] = []
  let end = 0
  for (const match of text.matchAll(OSC)) {
    const said = oscEvent(match[1]!)
    if (said) events.push(said)
    end = match.index! + match[0].length
  }
  const rest = text.slice(end)
  const open = rest.lastIndexOf(OSC_START)
  const partial = open >= 0 ? rest.slice(open) : /\u001b(?:\](?:7(?:5(?:0(?:1)?)?)?)?)?$/.exec(rest)?.[0] ?? ''
  return { events, carry: partial.length < 4200 ? partial : '' }
}

/* ------------------------------------------------------------------------ *
 * Which process holds which conversation
 * ------------------------------------------------------------------------ */

/** `ps -axo pid=,args=` output: the agy processes started on a conversation by id (`--conversation <id>`). */
export function readPs(text: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const raw of text.split('\n')) {
    const said = /^\s*(\d+)\s+(\S+)(.*)$/.exec(raw)
    if (!said) continue
    const pid = Number(said[1])
    if (!Number.isSafeInteger(pid) || pid <= 1) continue
    if (said[2]!.split('/').pop() !== BINARY) continue
    const id = /(?:^|\s)--conversation(?:\s+|=)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\s|$)/.exec(said[3]!)?.[1]
    if (id) out.set(pid, id)
  }
  return out
}

/** `lsof -F pn` output for `-d cwd`: each process's working folder. */
export function readCwds(text: string): Map<number, string> {
  const out = new Map<number, string>()
  let pid: number | null = null
  for (const raw of text.split('\n')) {
    if (raw.startsWith('p')) {
      const n = Number(raw.slice(1))
      pid = Number.isSafeInteger(n) && n > 1 ? n : null
    } else if (raw.startsWith('n') && pid !== null && !out.has(pid)) out.set(pid, raw.slice(1))
  }
  return out
}

/** The ps and lsof this machine has, by full path, so that nothing a project puts on PATH is run in their place. */
const PS = ['/bin/ps', '/usr/bin/ps']
const LSOF = ['/usr/sbin/lsof', '/usr/bin/lsof']

function ran(file: string, args: readonly string[], okCodes: readonly number[] = [0]): Promise<string | null> {
  return new Promise((done) => {
    execFile(file, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (!error) return done(String(stdout ?? ''))
      const code = (error as { code?: unknown }).code
      done(typeof code === 'number' && okCodes.includes(code) ? String(stdout ?? '') : null)
    })
  })
}

/**
 * Every conversation an agy process holds now, as far as can be seen: the ones started with
 * `--conversation <id>` (by this module, or by a person resuming one in a terminal). A conversation
 * opened another way (`agy -c`, `/resume` typed in a session) is not seen — the CLI keeps no lock
 * that says so. `ps` and `lsof` read; nothing is started. A failure is `failed`, never an empty list.
 */
async function active(_file: string): Promise<Running> {
  const ps = PS.find(runnable)
  if (!ps) return { known: false, why: 'failed' }
  const text = await ran(ps, ['-axo', 'pid=,args='])
  if (text === null) return { known: false, why: 'failed' }
  const held = readPs(text)
  if (held.size === 0) return { known: true, active: [] }
  const lsof = LSOF.find(runnable)
  const cwds = lsof ? readCwds((await ran(lsof, ['-w', '-a', '-d', 'cwd', '-F', 'pn', '-p', [...held.keys()].slice(0, 256).join(',')], [1])) ?? '') : new Map<number, string>()
  const out: Active[] = []
  for (const [pid, session] of held) {
    out.push({ session, kind: 'interactive', called: 'an Antigravity CLI process', handle: null, pid, cwd: cwds.get(pid) ?? '', startedAt: null, name: '', state: null, status: null })
  }
  return { known: true, active: out }
}

/* ------------------------------------------------------------------------ *
 * The arguments
 * ------------------------------------------------------------------------ */

/**
 * A new session: no arguments of its own — the CLI chooses the id. Its folder and settings
 * (`kitArgs`) are added by whoever starts it.
 *
 * ## Why not in the background
 *
 * The CLI's `remote-control` daemon serves sessions to other devices, not to a terminal that
 * attaches; a session started here is a child of this module's process and ends with it, and the
 * next open of its place resumes it by id.
 */
const fresh = (): string[] => []

/** A recorded session, with a sentence of this module's own as its first prompt when there is one (`-i`: "run an initial prompt interactively and continue the session"). */
const resume = (id: string, _name?: string, said?: string): string[] => {
  if (!SESSION_ID.test(id)) throw new Error('that is not a session id')
  return ['--conversation', id, ...(said && !said.startsWith('-') ? ['-i', said] : [])]
}

/** The session's own folder as a workspace root, and its one-run settings. */
const kitArgs = (kitDir: string, settingsFile: string | null): string[] => ['--add-dir', kitDir, ...(settingsFile ? ['--settings', settingsFile] : [])]

export const PROGRAM: Program = {
  name: 'Antigravity',
  binary: BINARY,
  find,
  supports,
  newId: () => randomUUID(),
  isId: (id) => SESSION_ID.test(id),
  fresh,
  resume,
  settled,
  sessions,
  install,
  installEnvironment,
  explain,
  environment,
  kitArgs,
  signal: (event) => (Object.hasOwn(SIGNALS, event) ? SIGNALS[event]! : null),
  active,
}
