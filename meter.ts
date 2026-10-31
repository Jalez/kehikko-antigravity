/**
 * How full a conversation's context window is, and what else the CLI's own status line says about a
 * session — read without anybody typing anything into it.
 *
 * ## Where the figures come from, and it is the whole list
 *
 * **The session's status line.** A session started here is given one for its one process
 * (`--settings`, `status.sh`), which the CLI runs with its session state on standard input (the
 * docs' "Customize the status line"): of it, `status.sh` passes on `context_window.used_percentage`
 * and `context_window_size`, the last request's `current_usage` (`input_tokens`,
 * `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`), `model.display_name`,
 * `cost.total_usd` (a list-price estimate, the docs say, not what is billed) and the conversation's
 * id, state and title. Nothing anybody wrote is read for this.
 *
 * The transcript is not read: its format is not documented. So a session that is not running has no
 * meter until it runs again, and a compaction is not seen.
 *
 * ## What cannot be known from here, and it is said rather than guessed
 *
 *  - **Where it compacts by itself.** The CLI compacts automatically, at a point it does not say. The
 *    meter warns from 80 % and says no point.
 *  - **How the window splits** into instructions, tools and messages: the status line has totals
 *    only. The breakdown shows the last request's own numbers.
 */

/** Where this module starts saying "the window is filling": 80 % of it. */
const WARN_SHARE = 0.8

/** The window a session runs with: what the CLI said, else nothing; never a guess from the model. */
export function windowFor(said: number | null): { window: number; sure: boolean } {
  if (said !== null && Number.isFinite(said) && said > 0) return { window: Math.floor(said), sure: true }
  return { window: 0, sure: false }
}

/** Where this module warns, and the window itself: the CLI says no point of its own. */
export function thresholds(window: number): { compactAt: number; warnAt: number; effective: number } {
  return { compactAt: window, warnAt: Math.round(window * WARN_SHARE), effective: window }
}

export const percentOf = (tokens: number, window: number): number => (window > 0 ? Math.min(100, Math.max(0, Math.round((tokens / window) * 100))) : 0)

/** One request's own numbers. `input` is what was sent new, `cacheRead` and `cacheWrite` what the prompt cache read and wrote. */
export interface Usage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export interface Compaction {
  at: number | null
  trigger: string
  before: number | null
  after: number | null
}

/** What a session's status line last said, as this module keeps it (`readStatus`). */
export interface StatusSaid {
  /** The conversation it is on. */
  thread: string
  /** The CLI's `agent_state`: idle, working, tool_use, reviewing, authenticating, initializing or error; `''` when not said. */
  state: string
  /** A permission prompt is on screen (`tool_confirmation_pending`). */
  asking: boolean
  /** The share of the window in use, 0–100, or null. */
  used: number | null
  window: number | null
  usage: Usage | null
  model: string | null
  /** The CLI's list-price estimate, in dollars, or null. */
  cost: number | null
  /** The conversation's title, one line, or `''`. */
  title: string
  at: number
}

const count = (value: string | null): number | null => {
  if (value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** A JSON string's inside, as the status line wrote it, read back: `\"` and `\\` and `\uXXXX`, nothing else interpreted. */
function unescaped(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_all, one: string) => {
    if (one.length === 5) return String.fromCharCode(parseInt(one.slice(1), 16))
    return one === 'n' || one === 'r' || one === 't' ? ' ' : one
  })
}

/** One line of plain text: no control, bidi or zero-width characters, at most `most` long. */
function oneLine(text: string, most: number): string {
  const said = text.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  return said.length > most ? `${said.slice(0, most - 1).trimEnd()}…` : said
}

const STATE_WORD = /^[a-z_]{1,24}$/
const THREAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** What `status.sh` posted, as numbers and words; null when it names no conversation. */
export function readStatus(query: { get(name: string): string | null }, at: number): StatusSaid | null {
  const thread = query.get('thread') ?? ''
  if (!THREAD.test(thread)) return null
  const state = query.get('state') ?? ''
  const used = count(query.get('used'))
  const window = count(query.get('size'))
  const input = count(query.get('input'))
  const cacheRead = count(query.get('cacheRead'))
  const cacheWrite = count(query.get('cacheWrite'))
  const output = count(query.get('output'))
  const usage = input === null && cacheRead === null && cacheWrite === null && output === null ? null : { input: Math.floor(input ?? 0), cacheRead: Math.floor(cacheRead ?? 0), cacheWrite: Math.floor(cacheWrite ?? 0), output: Math.floor(output ?? 0) }
  const model = oneLine(query.get('model') ?? '', 40)
  return {
    thread,
    state: STATE_WORD.test(state) ? state : '',
    asking: query.get('asking') === '1',
    used: used === null ? null : Math.min(100, used),
    window: window !== null && window > 0 ? Math.floor(window) : null,
    usage,
    model: model || null,
    cost: count(query.get('cost')),
    title: oneLine(unescaped((query.get('title') ?? '').slice(0, 1000)), 120),
    at,
  }
}

/** A model's name as a person reads it: the CLI already says it so ("Gemini 3.8 Flash (High)"). */
export function modelName(id: string): string {
  return id.trim().slice(0, 40)
}

/** A session's context, whole: what the page draws, the list's rows carry and the MCP tool says. */
export interface Context {
  /** The tokens in the window now, or null when nothing has been sent yet. */
  tokens: number | null
  window: number
  /** Whether the CLI itself said the window. */
  windowSure: boolean
  percent: number | null
  compactAt: number
  warnAt: number
  effective: number
  soon: boolean
  model: { id: string; name: string } | null
  /** The CLI's own estimate at list prices; `live`: from a running session's status line. */
  cost: { usd: number; live: boolean } | null
  /** Never known here: the transcript is not read. Kept in the shape the page and the door share. */
  compacted: { times: number; last: Compaction } | null
  afterCompact: boolean
  split: Usage | null
  from: 'status'
  at: number | null
}

/** What is shown for a session, from what its status line last said. Null when it says nothing yet. */
export function contextOf(status: StatusSaid | null): Context | null {
  if (!status) return null
  const { window, sure } = windowFor(status.window)
  const fromUsage = status.usage ? status.usage.input + status.usage.cacheRead + status.usage.cacheWrite : null
  const tokens = status.used !== null && window > 0 ? Math.round((status.used / 100) * window) : fromUsage !== null && fromUsage > 0 ? fromUsage : null
  if (tokens === null && !status.model) return null
  const { compactAt, warnAt, effective } = thresholds(window)
  const percent = status.used !== null ? Math.round(status.used) : tokens === null || window === 0 ? null : percentOf(tokens, window)
  return {
    tokens,
    window,
    windowSure: sure,
    percent,
    compactAt,
    warnAt,
    effective,
    soon: tokens !== null && window > 0 && tokens >= warnAt,
    model: status.model ? { id: status.model, name: modelName(status.model) } : null,
    cost: status.cost !== null && status.cost > 0 ? { usd: status.cost, live: true } : null,
    compacted: null,
    afterCompact: false,
    split: status.usage,
    from: 'status',
    at: status.at,
  }
}

/** A number of tokens as a person reads it: 823, 12k, 182k, 1.0M. */
export function tokensSaid(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 999_500) return `${Math.round(tokens / 1_000)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/** Dollars as a person reads them. */
export function costSaid(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

/**
 * A context in words: the share (`41%`), the line beside a meter (`82k of 1.0M · 41%`), and the
 * warning, in words and never by colour alone (`82% — filling up`).
 */
export function contextWords(context: Context): { percent: string; line: string; warning: string | null; title: string } {
  const pct = context.percent === null ? '—' : `${context.percent}%`
  const line = context.tokens === null ? 'nothing sent yet' : context.window ? `${tokensSaid(context.tokens)} of ${tokensSaid(context.window)} · ${pct}` : `${tokensSaid(context.tokens)}`
  const warning = context.soon ? `${pct} — filling up; it compacts by itself` : null
  const parts = [
    context.tokens === null ? 'Context: nothing sent yet in this conversation' : `Context: ${context.tokens.toLocaleString('en-US')} of ${context.window.toLocaleString('en-US')} tokens (${pct})`,
    context.window ? 'the CLI compacts by itself, at a point it does not say' : '',
    context.model ? context.model.name : '',
    context.cost ? `about ${costSaid(context.cost.usd)} at list prices` : '',
  ]
  return { percent: pct, line, warning, title: parts.filter(Boolean).join(' · ') }
}
