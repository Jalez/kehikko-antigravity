import { KEHIKOT_DIR, settingValueIssue, settingsDeclarationSchema, type SettingField } from 'kehikot-module-protocol'

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
])

/** A project's settings for this module. */
export interface Settings {
  resumeCutOff: boolean
  model: string
  effort: string
  mode: string
}

export const DEFAULTS: Settings = { resumeCutOff: true, model: '', effort: 'default', mode: 'default' }

/** A model name as the CLI takes one: no quotes, nothing that is not a model's name ("Gemini 3.8 Flash (High)" has spaces and brackets). */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9 ._:/()-]{0,79}$/

/** Why `value` cannot be setting `key`, or null. Beyond the protocol's type check: a model is one name. */
export function settingIssue(key: string, value: unknown): string | null {
  const field = SETTINGS.find((one) => one.key === key)
  if (!field) return `Antigravity has no setting called "${key.slice(0, 64)}".`
  const wrong = settingValueIssue(field, value)
  if (wrong) return `${field.label}: ${wrong}.`
  if (key === 'model' && value !== '' && !MODEL.test(String(value))) return 'A model is one name, as `agy models` lists it.'
  return null
}

/** Settings off a file, each value the default where the file says nothing it could be. */
export function settingsOf(raw: unknown): Settings {
  const said = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (Object.hasOwn(said, key) && settingIssue(key, said[key]) === null) (out as Record<string, unknown>)[key] = said[key]
  }
  return out
}

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
