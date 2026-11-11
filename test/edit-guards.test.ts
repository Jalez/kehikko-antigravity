import { describe, expect, test } from 'bun:test'
import { placedGuardsSchema } from 'kehikot-module-protocol'

import { guardAnswer, type EditFiles } from '../context.ts'
import { GUARD_MATCHER } from '../skills.ts'

/**
 * Edit guards through the protocol's one check (`checkToolCall`, protocol 2.80.0): the CLI's file tools
 * (`write_to_file`, `replace_file_content`, `multi_replace_file_content`, the file in `TargetFile`) are
 * refused in a main checkout or under paths a module on the kehikko names.
 */

const guards = placedGuardsSchema.parse([
  {
    module: 'kehikot.worktrees',
    name: 'Worktrees',
    guard: { id: 'main-checkout', tool: 'edit', match: { checkouts: ['main'], paths: ['~/Library/Application Support/Kehikot/installed/**'] }, action: 'deny', why: 'Work in a worktree: git worktree add ../<repo>-worktrees/<branch> -b <branch> origin/main' },
  },
])

const files: EditFiles = { home: '/Users/p', checkoutOf: (path) => (path.startsWith('/Users/p/Projects/app/') ? 'main' : path.startsWith('/Users/p/Projects/app-worktrees/') ? 'linked' : null) }
const TOOLS = ['write_to_file', 'replace_file_content', 'multi_replace_file_content']
const call = (name: string, TargetFile: string, workspacePaths?: string[]) => ({ conversationId: 'c', stepIdx: 1, toolCall: { name, args: { TargetFile } }, ...(workspacePaths ? { workspacePaths } : {}) })

describe('edit guards', () => {
  test('the hook is matched on the shell, the file tools and starting subagents', () => {
    expect(GUARD_MATCHER).toBe('^(run_command|write_to_file|replace_file_content|multi_replace_file_content|invoke_subagent)$')
  })

  test('an edit in a main checkout is refused with the module’s words', () => {
    for (const tool of TOOLS) {
      const answer = guardAnswer(call(tool, '/Users/p/Projects/app/src/a.ts'), guards, false, null, files)
      expect(answer).toMatchObject({ decision: 'deny' })
      expect(answer?.reason).toContain('git worktree add')
    }
  })

  test('a relative path is read against the first workspace path', () => {
    expect(guardAnswer(call('write_to_file', 'src/a.ts', ['/Users/p/Projects/app']), guards, false, null, files)).toMatchObject({ decision: 'deny' })
    expect(guardAnswer(call('write_to_file', 'src/a.ts', ['/Users/p/Projects/app-worktrees/x']), guards, false, null, files)).toBeNull()
  })

  test('an installed module’s folder is refused, a worktree and elsewhere pass', () => {
    for (const tool of TOOLS) {
      expect(guardAnswer(call(tool, '/Users/p/Library/Application Support/Kehikot/installed/kehikot.queue/x.ts'), guards, false, null, files)).toMatchObject({ decision: 'deny' })
      expect(guardAnswer(call(tool, '/Users/p/Projects/app-worktrees/x/src/a.ts'), guards, false, null, files)).toBeNull()
      expect(guardAnswer(call(tool, '/tmp/note.md'), guards, false, null, files)).toBeNull()
    }
  })

  test('KEHIKOT_DIRECT in the session passes, and no edit guard means nothing is asked', () => {
    expect(guardAnswer(call('write_to_file', '/Users/p/Projects/app/a.ts'), guards, true, null, files)).toBeNull()
    expect(guardAnswer(call('write_to_file', '/Users/p/Projects/app/a.ts'), [], false, null, { home: null, checkoutOf: () => { throw new Error('not asked') } })).toBeNull()
  })

  test('viewing a file is not an edit, and an edit guard never touches a shell command', () => {
    expect(guardAnswer({ toolCall: { name: 'view_file', args: { AbsolutePath: '/Users/p/Projects/app/a.ts' } } }, guards, false, null, files)).toBeNull()
    expect(guardAnswer({ toolCall: { name: 'run_command', args: { CommandLine: 'echo x > /Users/p/Projects/app/a.ts' } } }, guards, false, null, files)).toBeNull()
  })
})
