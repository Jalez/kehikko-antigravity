import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TELL_ENV } from '../live.ts'
import { PROGRAM } from '../program.ts'
import { sessionKit, writeSettings } from '../skills.ts'

/**
 * `status.sh`, run by the stand-in CLI as the status line a session is given for its one process
 * (`--settings`): what reaches this module, what never does, and that it prints nothing.
 */

const STAND_IN = join(import.meta.dir, 'stand-in', 'agy')
const SESSION = '11111111-1111-4111-8111-111111111111'
const SECRET = 'cd'.repeat(24)
const heard: { url: string; ticket: string | undefined }[] = []
let server: Server
let port = 0
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-antigravity-status-')))

beforeAll(async () => {
  server = createServer((request, response) => {
    heard.push({ url: request.url ?? '', ticket: request.headers['x-module-ticket'] as string | undefined })
    response.writeHead(204).end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  port = (server.address() as AddressInfo).port
})
afterAll(() => {
  server.close()
  rmSync(scratch, { recursive: true, force: true })
})

function ran(file: string, args: string[], env: NodeJS.ProcessEnv, input: string, cwd: string): Promise<string> {
  return new Promise((done) => {
    const child = spawn(file, args, { env, cwd })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.on('close', () => done(out))
    child.stdin.end(input)
  })
}

describe('the status line', () => {
  test('says the conversation, its state, its context and its title — never the email or folder — and prints nothing', async () => {
    const home = mkdtempSync(join(scratch, 'home-'))
    const bin = join(home, 'bin')
    mkdirSync(bin)
    copyFileSync(STAND_IN, join(bin, 'agy'))
    copyFileSync(`${STAND_IN}.ts`, join(bin, 'agy.ts'))
    chmodSync(join(bin, 'agy'), 0o755)
    const kit = await sessionKit([], { base: join(home, 'base'), personal: [], fetch: (async () => new Response('', { status: 404 })) as unknown as typeof fetch })
    const settings = writeSettings(kit.dir)
    const out = await ran(join(bin, 'agy'), PROGRAM.kitArgs(kit.dir, settings), { PATH: '/usr/bin:/bin', HOME: home, KEHIKOT_TEST_BUN: process.execPath, [TELL_ENV.port]: String(port), [TELL_ENV.secret]: SECRET, [TELL_ENV.session]: SESSION }, 'hello\n/ask\nyes\n/exit\n', home)
    expect(out).toContain('statusline=yes')
    expect(out).not.toContain('status line printed')
    const posts = heard.filter((one) => one.url.startsWith('/api/status'))
    expect(posts.length).toBeGreaterThan(1)
    expect(posts.every((one) => one.ticket === SECRET)).toBe(true)
    const first = new URL(posts[0]!.url, 'http://x').searchParams
    expect(first.get('session')).toBe(SESSION)
    expect(PROGRAM.isId(first.get('thread') ?? '')).toBe(true)
    expect(first.get('size')).toBe('1048576')
    expect(first.get('model')).toBe('Gemini 3.8 Flash (High)')
    expect(first.get('title')).toBe('About hello')
    expect(posts.some((one) => new URL(one.url, 'http://x').searchParams.get('asking') === '1')).toBe(true)
    const all = posts.map((one) => decodeURIComponent(one.url)).join('\n')
    expect(all).not.toContain('example.com')
    expect(all).not.toContain(home)
    /* What it last said is kept beside it, so the same thing is not said twice in a row. */
    expect(readFileSync(join(kit.dir, 'kehikot', 'status.last'), 'utf8')).toContain(first.get('thread')!)
    const urls = posts.map((one) => one.url)
    expect(urls.every((url, i) => url !== urls[i - 1])).toBe(true)
  })
})
