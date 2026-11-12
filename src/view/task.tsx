import { useEffect, useState } from 'react'

import type { Kehikko } from '../../place.ts'
import { TerminalView } from './terminal-view.tsx'

/**
 * The page for ONE conversation (`agent.tasks`' view, protocol 2.88.0): `/app?session=<id>`, which a
 * host frames in a dialog of its own while a task it started runs — without the greeting a container
 * gets. So nothing here waits for a host: the server says where the conversation is (`/api/task`,
 * with the page's ticket), and its terminal is opened at that place, the place it is filed under, so
 * opening it files it nowhere new (`remember` in live.ts).
 */

/** The conversation this page is for, from its address; null for the ordinary page. */
export function taskSession(search: string = typeof location === 'undefined' ? '' : location.search): string | null {
  const id = new URLSearchParams(search).get('session') ?? ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null
}

/** Where the server says the conversation is (`taskTarget` in live.ts). */
export interface TaskTarget {
  projectPath: string
  projectId: string | null
  place: { epic: string | null; parts: string[]; kehikko: Kehikko | null; kehikkoName?: string }
}

const darkNow = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export function TaskApp({ session, find }: { session: string; find: (session: string) => Promise<TaskTarget> }) {
  const [target, setTarget] = useState<TaskTarget | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [theme] = useState<'light' | 'dark'>(() => (darkNow() ? 'dark' : 'light'))
  useEffect(() => {
    let gone = false
    find(session).then(
      (found) => !gone && setTarget(found),
      (error: unknown) => !gone && setFailed(error instanceof Error ? error.message : String(error)),
    )
    return () => {
      gone = true
    }
  }, [session, find])

  if (failed) return <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground" data-task-failed>{failed}</div>
  if (!target) return <div className="h-full" data-task-waiting />
  return (
    <div className="h-full w-full" data-task={session}>
      <TerminalView
        theme={theme}
        target={{
          what: 'session',
          projectPath: target.projectPath,
          ...(target.projectId ? { projectId: target.projectId } : {}),
          place: { epic: target.place.epic, parts: target.place.parts, kehikko: target.place.kehikko, kehikkoName: target.place.kehikkoName ?? '' },
          session,
        }}
        shown
      />
    </div>
  )
}
