/**
 * A stand-in for the Antigravity CLI (`agy`), for tests: it takes the arguments this module passes,
 * keeps a conversation folder where the CLI keeps one (`~/.gemini/antigravity-cli/brain/<id>/`),
 * reads the hooks, doors and skills of every `--add-dir` folder's `.agents/` as the docs say the CLI
 * does, runs the hooks with the documented JSON on stdin at the documented moments, runs the status
 * line given with `--settings`, and writes its state over OSC 7501. Never the real CLI, never an
 * account.
 *
 *   --help                 what `supports` reads. STANDIN_OLD=1: no --conversation; STANDIN_NOKIT=1: no --add-dir.
 *   [--conversation <id> [-i <line>]] [--add-dir <dir>]… [--settings <file>] [--model m] [--effort e] [--mode m]
 *
 * Typed lines:
 *
 *   a line                 SessionStart (first line of a new conversation), PreInvocation ×2, the echo, Stop
 *   /ask                   a turn that stops for a permission prompt (OSC blocked, permission); the next line answers
 *   /question              a turn whose agent calls ask_question (PreToolUse); the next line answers
 *   /work                  a turn with no end, dots until /interrupt
 *   /compact               compacts (the status line's tokens go down)
 *   /mcp <server> <tool> [json]   calls that door's tool, as the CLI would
 *   /exit                  ends
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const out = (text: string) => process.stdout.write(text.replace(/\n/g, '\r\n'))

if (argv[0] === '--help') {
  out('Usage of agy:\n')
  if (!process.env.STANDIN_NOKIT) out('  --add-dir                       Add a directory to the workspace (repeatable) (default [])\n')
  out('  -c                              Short alias for --continue\n')
  if (!process.env.STANDIN_OLD) out('  --conversation                  Resume a previous conversation by ID\n')
  out('  -i                              Short alias for --prompt-interactive\n')
  out('  --settings                      Settings for this session only, never saved: a JSON object of settings.json keys, inline or as a file path\n')
  process.exit(0)
}

const home = join(process.env.HOME ?? '/tmp', '.gemini', 'antigravity-cli')
const dirs: string[] = []
let settingsFile: string | null = null
let session: string | null = null
let line: string | undefined
const flags: string[] = []
for (let i = 0; i < argv.length; i++) {
  const one = argv[i]!
  if (one === '--add-dir') dirs.push(argv[++i] ?? '')
  else if (one === '--settings') settingsFile = argv[++i] ?? null
  else if (one === '--conversation') session = argv[++i] ?? null
  else if (one === '-i' || one === '--prompt-interactive') line = argv[++i]
  else if (one === '--model' || one === '--effort' || one === '--mode') flags.push(one, argv[++i] ?? '')
  else flags.push(one)
}

/* What the workspace folders say: hooks, doors and skills, read as the docs say the CLI reads them. */
type Handler = { command: string; timeout?: number }
type Hook = { event: string; matcher?: string; command: string; cwd: string }
const hooks: Hook[] = []
const doors = new Map<string, string>()
const skills: string[] = []
for (const dir of [process.cwd(), ...dirs]) {
  const agents = join(dir, '.agents')
  const hooksFile = join(agents, 'hooks.json')
  if (existsSync(hooksFile)) {
    const named = JSON.parse(readFileSync(hooksFile, 'utf8')) as Record<string, Record<string, unknown>>
    for (const spec of Object.values(named)) {
      if (spec.enabled === false) continue
      for (const [event, list] of Object.entries(spec)) {
        if (!Array.isArray(list)) continue
        for (const entry of list as Record<string, unknown>[]) {
          if (event === 'PreToolUse' || event === 'PostToolUse') {
            for (const handler of (entry.hooks as Handler[]) ?? []) hooks.push({ event, matcher: String(entry.matcher ?? '*'), command: handler.command, cwd: agents })
          } else hooks.push({ event, command: String(entry.command), cwd: agents })
        }
      }
    }
  }
  const mcp = join(agents, 'mcp_config.json')
  if (existsSync(mcp)) {
    const said = JSON.parse(readFileSync(mcp, 'utf8')) as { mcpServers?: Record<string, { url?: string; serverUrl?: string }> }
    for (const [name, server] of Object.entries(said.mcpServers ?? {})) doors.set(name, server.url ?? server.serverUrl ?? '')
  }
  const skillsDir = join(agents, 'skills')
  if (existsSync(skillsDir)) for (const name of readdirSync(skillsDir)) if (existsSync(join(skillsDir, name, 'SKILL.md'))) skills.push(name)
}
const statusLine = settingsFile ? ((JSON.parse(settingsFile.trim().startsWith('{') ? settingsFile : readFileSync(settingsFile, 'utf8')) as { statusLine?: { command?: string } }).statusLine?.command ?? null) : null

if (session) {
  if (!existsSync(join(home, 'brain', session))) {
    out(`conversation ${session} not found\n`)
    process.exit(1)
  }
}

const osc = (pairs: string) => process.stdout.write(`\x1b]7501;app=agy:${pairs}\x1b\\`)
const transcript = () => (session ? join(home, 'brain', session, '.system_generated', 'logs', 'transcript.jsonl') : '')
const row = (what: unknown) => session && appendFileSync(transcript(), `${JSON.stringify(what)}\n`)
let started = false
let tokens = 12000
let title = ''
let state = 'idle'
let asking = false

const begin = () => {
  if (session && existsSync(join(home, 'brain', session))) return
  session ??= randomUUID()
  mkdirSync(join(home, 'brain', session, '.system_generated', 'logs'), { recursive: true })
  writeFileSync(transcript(), '')
}

async function fire(event: string, more: Record<string, unknown> = {}, tool?: string): Promise<void> {
  const matching = hooks.filter((one) => one.event === event && (one.matcher === undefined || one.matcher === '*' || one.matcher === '' || (tool !== undefined && new RegExp(one.matcher).test(tool))))
  for (const hook of matching) {
    const input = JSON.stringify({ conversationId: session, workspacePaths: [process.cwd(), ...dirs], transcriptPath: transcript(), artifactDirectoryPath: '', modelName: 'Gemini 3.8 Flash (High)', lastUserInput: 'do not read me', ...more })
    const child = Bun.spawn(['/bin/sh', '-c', hook.command], { stdin: new Blob([input]), stdout: 'pipe', stderr: 'ignore', env: process.env, cwd: hook.cwd })
    const said = await new Response(child.stdout).text()
    await child.exited
    try {
      const parsed = JSON.parse(said) as { injectSteps?: { systemMessage?: { systemMessage?: string } }[]; decision?: string }
      for (const step of parsed.injectSteps ?? []) {
        const text = step.systemMessage?.systemMessage
        if (text) {
          out(`system(${event}): ${text.split('\n')[0]}\n`)
          row({ type: 'system', text })
        }
      }
      if ((event === 'PreToolUse' || event === 'Stop') && !parsed.decision) out(`hook ${event} answered without a decision\n`)
    } catch {
      out(`hook ${event} printed no JSON\n`)
    }
  }
}

async function status(): Promise<void> {
  if (!statusLine || !session) return
  const input = JSON.stringify({
    cwd: process.cwd(),
    session_id: session,
    conversation_id: session,
    ...(title ? { conversation_title: title } : {}),
    transcript_path: transcript(),
    model: { id: 'gemini-3.8-flash', display_name: 'Gemini 3.8 Flash (High)', effort: 'high' },
    workspace: { current_dir: process.cwd(), project_dir: process.cwd() },
    context_window: { total_input_tokens: tokens, total_output_tokens: 300, context_window_size: 1048576, used_percentage: Math.round((tokens / 1048576) * 1000) / 10, remaining_percentage: 0, current_usage: { input_tokens: tokens - 4000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000 } },
    quota: { 'gemini-weekly': { remaining_fraction: 0.5 } },
    agent_state: state,
    ...(asking ? { tool_confirmation_pending: true } : {}),
    email: 'someone@example.com',
    cost: { total_usd: 0.0123, subagent_usd: 0, estimated: true },
  })
  const child = Bun.spawn(['/bin/sh', '-c', statusLine], { stdin: new Blob([input]), stdout: 'pipe', stderr: 'ignore', env: process.env })
  const said = await new Response(child.stdout).text()
  await child.exited
  if (said.trim()) out(`status line printed: ${said.trim()}\n`)
}

const turn = async (said: string, open = false) => {
  const fresh = !session || !existsSync(join(home, 'brain', session))
  begin()
  if (fresh && !started) await fire('SessionStart')
  started = true
  state = 'working'
  osc('state=working')
  row({ type: 'user', text: said })
  title ||= `About ${said}`.slice(0, 60)
  await fire('PreInvocation', { invocationNum: 0, initialNumSteps: 0 })
  tokens += 1500
  await status()
  await fire('PreInvocation', { invocationNum: 1, initialNumSteps: 2 })
  if (open) return
  await fire('PostInvocation', { invocationNum: 1, initialNumSteps: 3 })
  await finish()
}

const finish = async () => {
  await fire('Stop', { executionNum: 1, terminationReason: 'NO_TOOL_CALL', fullyIdle: true })
  state = 'idle'
  osc('state=done')
  await status()
}

out(`stand-in agy: ${session ? `RESUMED conversation ${session}` : 'NEW conversation'}\n`)
out(`args: ${JSON.stringify(flags)} hooks=${hooks.length} doors=${[...doors.keys()].join(',')} skills=${skills.join(',')} statusline=${statusLine ? 'yes' : 'no'}\n`)
out(`cwd: ${process.cwd()}\n`)
osc('state=idle')
if (line) {
  await turn(line)
  out(`you said: ${line}\n`)
}

let dots: ReturnType<typeof setInterval> | null = null
let answering: 'permission' | 'question' | null = null
const quiet = () => {
  if (dots) clearInterval(dots)
  dots = null
}
process.on('SIGHUP', () => {
  out('stand-in agy: hung up\n')
  process.exit(0)
})

let buffer = ''
out('> ')
for await (const chunk of process.stdin) {
  buffer += String(chunk)
  let at: number
  while ((at = buffer.search(/[\r\n]/)) >= 0) {
    const said = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    if (!said) continue
    if (answering) {
      const was = answering
      answering = null
      asking = false
      out(`answered: ${said}\n`)
      state = 'working'
      osc('state=working')
      if (was === 'question') await fire('PostToolUse', { toolCall: { name: 'ask_question', args: {} }, stepIdx: 3 }, 'ask_question')
      else await fire('PostToolUse', { toolCall: { name: 'run_command', args: {} }, stepIdx: 3 }, 'run_command')
      await status()
      await finish()
    } else if (said === '/exit') {
      quiet()
      out('bye\n')
      process.exit(0)
    } else if (said === '/interrupt' || said === '\x1b') {
      quiet()
      await fire('Stop', { executionNum: 1, terminationReason: 'USER_CANCELED', fullyIdle: true })
      state = 'idle'
      osc('state=done')
      out('interrupted\n')
    } else if (said === '/work') {
      await turn(said, true)
      dots = setInterval(() => out('.'), 1000)
    } else if (said === '/ask') {
      await turn(said, true)
      await fire('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf build' } }, stepIdx: 2 }, 'run_command')
      asking = true
      osc('state=blocked:kind=permission')
      await status()
      out('stand-in agy: may I? (the next line is the answer)\n')
      answering = 'permission'
    } else if (said === '/question') {
      await turn(said, true)
      await fire('PreToolUse', { toolCall: { name: 'ask_question', args: {} }, stepIdx: 2 }, 'ask_question')
      osc('state=blocked:kind=question')
      out('stand-in agy: a question (the next line is the answer)\n')
      answering = 'question'
    } else if (said === '/compact') {
      tokens = 3000
      await status()
      out('compacted\n')
    } else if (said.startsWith('/mcp ')) {
      const [, server, tool, ...args] = said.split(' ')
      const url = doors.get(server ?? '')
      if (!url) out(`no MCP server ${server}\n`)
      else {
        try {
          const call = (body: unknown, id?: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(id ? { 'mcp-session-id': id } : {}) }, body: JSON.stringify(body) })
          const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stand-in agy', version: '0' } } })
          const sid = init.headers.get('mcp-session-id') ?? undefined
          const answer = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args.length ? JSON.parse(args.join(' ')) : {}, _meta: { 'antigravity.google/root_conversation_id': session } } }, sid)
          out(`mcp ${server} ${tool}: ${(await answer.text()).slice(0, 2000)}\n`)
        } catch (error) {
          out(`mcp ${server} ${tool} failed: ${error instanceof Error ? error.message : String(error)}\n`)
        }
      }
    } else {
      await turn(said)
      out(`you said: ${said}\n`)
    }
    out('> ')
  }
}
