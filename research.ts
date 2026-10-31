/**
 * "Research complete": the Inbox event this module declares (protocol 2.31.0, `events` in the
 * manifest), and the one rule for when a subagent's finish is one.
 *
 * ## How a finished piece of research is told
 *
 *  - **The session's own agent** calls `tell_finished({ event: 'research-complete', label })` on
 *    this module's MCP door (`doors.ts`). The door knows the conversation by the place token on its
 *    URL, so only that conversation's agent (or a subagent of it, which calls the same doors) can
 *    tag its item. The tag waits for the turn to end (`Stop`), and the finished item then names the
 *    event and carries the label. The turn's end is the CLI's `Stop` hook, or its OSC 7501 `done`.
 *
 * ## What the Antigravity CLI says of a subagent
 *
 * Nothing a hook hears: the CLI has no subagent events (its hooks are SessionStart, PreInvocation,
 * PostInvocation, PreToolUse, PostToolUse and Stop), and its OSC 7501 child records carry no task.
 * So "Research complete" comes from the agent's own `tell_finished` alone, at the end of its turn;
 * a subagent's finish says nothing by itself. The rule below stays for the day the CLI says more.
 */

export { EVENTS, EVENT_IDS, RESEARCH_EVENT } from './events.ts'

const RESEARCH_WORDS =
  /\b(research\w*|investigat\w*|find(?:ing)? out|look(?:ing)? into|compar\w*|audit\w*|survey\w*|explor\w*|analy[sz]\w*|stud(?:y|ies|ying)|review\w*|evaluat\w*|assess\w*|read(?:ing)? up)\b/i
/** A read-only role, should a subagent ever be named by one. */
const RESEARCH_ROLES = new Set(['explorer', 'research', 'researcher'])

/** Whether a finished subagent was research: an `explorer`, or a task whose first line has a research word. */
export function isResearch(agent: { agentType?: string | null; task?: string | null }): boolean {
  if (agent.agentType && RESEARCH_ROLES.has(agent.agentType)) return true
  return RESEARCH_WORDS.test((agent.task ?? '').trim())
}

/** An agent id as a hook would give one; nothing else is used to find a record. */
export const AGENT_ID = /^[0-9a-f-]{36}$/
/** An agent type (a role) as a hook gives one. */
export const AGENT_TYPE = /^[A-Za-z0-9:._-]{1,64}$/

/** The first line of the task a subagent was given. The CLI's records are not read (their format is not documented): always null. */
export async function subagentTask(_agent: string): Promise<string | null> {
  return null
}

/** What the session's agent said it finished, waiting for the turn or a subagent to end. */
export interface Told {
  event: string
  label: string
  at: number
}

/** A subagent's finished research, as an item of its own until the person opens the session. */
export interface Found {
  agent: string
  event: string
  label: string
  at: number
}

/** How many subagent items one session keeps at most; the oldest go first. */
export const FOUND_MOST = 8
