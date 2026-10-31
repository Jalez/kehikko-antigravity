/**
 * What a conversation's own record says about how it ended: whether its last turn was still under
 * way, and whether the person has moved on since something was said about it.
 *
 * ## What the Antigravity CLI's record does not say, here
 *
 * The CLI writes a transcript (`brain/<id>/.system_generated/logs/transcript.jsonl`), but its rows
 * are not documented, and this module was built without reading anybody's. So nothing in it is
 * parsed: a turn a restart cut off is known by the record's own `working` mark, which this module
 * keeps while it sees the session work (`markWorking` in live.ts) — `midTurn` finds nothing, and a
 * person moving on is known only by opening the conversation (`movedOn` finds nothing). The CLI's
 * background tasks end with its process and nothing about them is said, so `cutOffs` finds none.
 */

/** Which way something did not finish: `turn` is a turn a restart cut off. The others are kept for the record's format. */
export type CutKind = 'turn' | 'ended' | 'stopped' | 'failed'

export interface CutOff {
  /** When it was found, in milliseconds. */
  at: number
  kind: CutKind
  /** One line, for the person. */
  summary: string
  tasks: number
}

export const SUMMARY_CHARS = 90

/** Background work a transcript says was cut off: none is read (see above). */
export function cutOffs(_text: string): CutOff[] {
  return []
}

/** Whether the person said something after `after`: not read from the transcript (see above). */
export function movedOn(_text: string, _after: number, _except: readonly string[] = []): boolean {
  return false
}

/** Whether the last turn was still under way when the record stopped growing: not read from the transcript (see above). */
export function midTurn(_text: string): boolean {
  return false
}

/** The words for what was cut off: the label's tail, and the detail. */
export function cutOffWords(open: readonly CutOff[]): { said: string; detail: string } {
  if (open.some((one) => one.kind === 'turn')) {
    return { said: 'its turn was cut off when Kehikot restarted', detail: 'Open it to carry on: it is told what happened when you do, unless “Resume conversations cut off by a restart” is off.' }
  }
  const count = open.reduce((sum, one) => sum + one.tasks, 0)
  const tasks = `${count} background task${count === 1 ? '' : 's'}`
  return { said: `${tasks} ${count === 1 ? 'was' : 'were'} cut off or failed`, detail: open.map((one) => one.summary).join('; ') }
}
