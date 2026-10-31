import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { brainDir, transcriptOf } from '../program.ts'

/**
 * Conversation folders, written where the Antigravity CLI keeps them — `~/.gemini/antigravity-cli/
 * brain/<id>/.system_generated/logs/transcript.jsonl`, in the scratch home of test/setup.ts. The
 * module reads only that a folder is there and when its transcript last grew, so the rows are
 * nothing in particular.
 */
export const T0 = Date.parse('2026-10-21T17:30:00.000Z')

/** A conversation's folder and transcript. `when` sets its time. */
export function writeConversation(id: string, rows: string[] = [], when?: string | number): string {
  const file = transcriptOf(id)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, rows.length ? `${rows.join('\n')}\n` : '')
  if (when !== undefined) utimesSync(file, new Date(when), new Date(when))
  return file
}

export function removeConversation(id: string): void {
  rmSync(brainDir(id), { recursive: true, force: true })
}
