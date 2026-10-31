import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { PROGRAM, TELLS, agyHome, brainDir, deniedWrite, headOf, home, hooksJson, installFor, learnSession, learnTitle, oscEvent, oscEvents, readCwds, readPs, recordFile, sessionName, titleOf, vouch } from '../program.ts'
import { assign } from '../record.ts'
import { writeConversation } from './transcripts.ts'
import { CONFIG, HOME } from './setup.ts'

/**
 * The adapter, against a stand-in `agy` and a scratch home.
 *
 * Nothing here runs the real program or reads a real record: `test/setup.ts` has already pointed
 * the home folder and PATH at scratch.
 */

const STAND_IN = join(import.meta.dir, 'stand-in', 'agy')
const made: string[] = []
const scratch = (name: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `kehikko-antigravity-${name}-`)))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
  rmSync(join(HOME, '.local'), { recursive: true, force: true })
  rmSync(join(CONFIG, 'brain'), { recursive: true, force: true })
})

const A = '01a175cc-82f0-47b1-a11b-77a47b470116'
const B = '01a175cd-511f-4de0-b010-09ebe2616f33'
const C = '01a175ce-511f-4de0-b010-09ebe2616f44'

/** A folder with the stand-in in it as `agy`, and the environment variables a variant needs. */
function standIn(): string {
  const bin = scratch('bin')
  copyFileSync(STAND_IN, join(bin, 'agy'))
  copyFileSync(`${STAND_IN}.ts`, join(bin, 'agy.ts'))
  chmodSync(join(bin, 'agy'), 0o755)
  return join(bin, 'agy')
}

describe('finding the binary', () => {
  test('the test’s machine is scratch: a home of its own, and the CLI’s folder in it', () => {
    expect(home()).toBe(HOME)
    expect(agyHome()).toBe(join(HOME, '.gemini', 'antigravity-cli'))
  })

  test('on PATH first, then the usual places a thin PATH leaves out: the installer’s ~/.local/bin first', () => {
    const bin = scratch('path')
    writeFileSync(join(bin, 'agy'), '#!/bin/sh\n')
    chmodSync(join(bin, 'agy'), 0o755)
    expect(PROGRAM.find({ HOME, PATH: bin }).file).toBe(join(bin, 'agy'))
    const found = PROGRAM.find({ HOME, PATH: '/nowhere' })
    expect(found.file).toBeNull()
    expect(found.usual[0]).toBe(join(HOME, '.local', 'bin'))
    expect(found.looked).toContain(join(HOME, '.local', 'bin'))
  })

  test('in ~/.local/bin, where the vendor’s installer puts it, after the first look found nothing', () => {
    expect(PROGRAM.find({ HOME, PATH: '/nowhere' }).file).toBeNull()
    mkdirSync(join(HOME, '.local', 'bin'), { recursive: true })
    writeFileSync(join(HOME, '.local', 'bin', 'agy'), '#!/bin/sh\n')
    chmodSync(join(HOME, '.local', 'bin', 'agy'), 0o755)
    expect(PROGRAM.find({ HOME, PATH: '/nowhere' }).file).toBe(join(HOME, '.local', 'bin', 'agy'))
    rmSync(join(HOME, '.local'), { recursive: true, force: true })
  })
})

describe('whether a copy can do what is asked of it', () => {
  test('one with --conversation, --add-dir and --settings can, and takes a folder and settings for one process', async () => {
    const able = await PROGRAM.supports(standIn())
    expect(able).toMatchObject({ ok: true, missing: null, tells: true, configures: true, plugins: true, settings: true, lists: true, names: false, backgrounds: false })
  })

  test('one with no --conversation is too old, and says what it lacks', async () => {
    const file = standIn()
    writeFileSync(join(file, '..', 'agy'), `#!/bin/sh\nSTANDIN_OLD=1 exec "${process.execPath}" "$(dirname "$0")/agy.ts" "$@"\n`)
    const able = await PROGRAM.supports(file)
    expect(able.ok).toBe(false)
    expect(able.missing).toBe('--conversation')
  })

  test('one with no --add-dir has no hooks, doors or skills, and is otherwise the same', async () => {
    const file = standIn()
    writeFileSync(join(file, '..', 'agy'), `#!/bin/sh\nSTANDIN_NOKIT=1 exec "${process.execPath}" "$(dirname "$0")/agy.ts" "$@"\n`)
    const able = await PROGRAM.supports(file)
    expect(able).toMatchObject({ ok: true, tells: false, configures: false, plugins: false })
  })

  test('one whose help cannot be read is not called too old: nothing was learned, and nothing extra is passed', async () => {
    const bin = scratch('mute')
    writeFileSync(join(bin, 'agy'), '#!/bin/sh\nexit 3\n')
    chmodSync(join(bin, 'agy'), 0o755)
    expect(await PROGRAM.supports(join(bin, 'agy'))).toMatchObject({ ok: true, missing: null, tells: false, configures: false, settings: false })
  })
})

describe('starting and resuming', () => {
  test('a new session has no arguments of its own — the CLI chooses the id; a resumed one is `--conversation <id>`', () => {
    expect(PROGRAM.fresh(A)).toEqual([])
    expect(PROGRAM.resume(A)).toEqual(['--conversation', A])
    expect(PROGRAM.resume(A, undefined, 'Kehikot restarted.')).toEqual(['--conversation', A, '-i', 'Kehikot restarted.'])
    expect(PROGRAM.resume(A, undefined, '--dangerously-skip-permissions')).toEqual(['--conversation', A])
    expect(() => PROGRAM.resume('--continue')).toThrow()
  })

  test('its own folder is a workspace root, and its settings are for that one session', () => {
    expect(PROGRAM.kitArgs('/tmp/kit', '/tmp/kit/kehikot/settings.json')).toEqual(['--add-dir', '/tmp/kit', '--settings', '/tmp/kit/kehikot/settings.json'])
    expect(PROGRAM.kitArgs('/tmp/kit', null)).toEqual(['--add-dir', '/tmp/kit'])
  })

  test('an id it mints is one it accepts, and what is not an id is refused', () => {
    expect(PROGRAM.isId(PROGRAM.newId())).toBe(true)
    expect(PROGRAM.isId('ec33ebf9-0cba-4100-8142-c61503f6c587')).toBe(true)
    expect(PROGRAM.isId('../../etc')).toBe(false)
  })

  test('the session’s environment does not say it is inside another Antigravity process, and asks for OSC 7501', () => {
    const env = PROGRAM.environment({ PATH: '/bin', ANTIGRAVITY_CONVERSATION_ID: A, ANTIGRAVITY_PROJECT_ID: 'p', GEMINI_API_KEY: 'k' })
    expect(env).toEqual({ PATH: '/bin', GEMINI_API_KEY: 'k', AGY_CLI_OSC7501: 'on', AGY_CLI_OSC7501_MESSAGES: 'brief' })
  })

  test('a session runs the person’s bun and node, never the ones the host put first on this module’s PATH (personEnv)', () => {
    const at = scratch('person-env')
    const hostShim = join(at, 'kehikot-bun-1')
    const bunNode = join(at, 'bun-node-502-x')
    for (const dir of [hostShim, bunNode]) {
      mkdirSync(dir)
      symlinkSync(process.execPath, join(dir, 'bun'))
    }
    symlinkSync(process.execPath, join(bunNode, 'node'))
    const person = join(at, 'person')
    mkdirSync(person)
    writeFileSync(join(person, 'bun'), '#!/bin/sh\necho person-bun\n')
    chmodSync(join(person, 'bun'), 0o755)
    const env = PROGRAM.environment({ PATH: [bunNode, hostShim, person, '/usr/bin', '/bin'].join(delimiter), KEHIKOT_HOST_PATH: hostShim, BUN_BE_BUN: '1' })
    expect(env.BUN_BE_BUN).toBeUndefined()
    expect(env.KEHIKOT_HOST_PATH).toBeUndefined()
    expect(env.PATH).toBe([person, '/usr/bin', '/bin'].join(delimiter))
    const ran = spawnSync('/bin/sh', ['-c', 'command -v bun; bun --version'], { env, encoding: 'utf8' })
    expect(ran.stdout).toBe(`${join(person, 'bun')}\nperson-bun\n`)
  })
})

describe('the hooks, in the session’s own folder', () => {
  test('hooks.json is the CLI’s format: one hook name, tool events grouped by matcher, the others a flat list', () => {
    const said = JSON.parse(hooksJson([
      { event: 'SessionStart', commands: [{ command: 'a', timeout: 5 }] },
      { event: 'PreToolUse', matcher: '^ask_question$', commands: [{ command: 'b', timeout: 5 }] },
      { event: 'Stop', commands: [{ command: 'c', timeout: 500 }] },
      { event: 'PreInvocation', commands: [] },
    ]))
    expect(said).toEqual({
      kehikot: {
        SessionStart: [{ type: 'command', command: 'a', timeout: 5 }],
        PreToolUse: [{ matcher: '^ask_question$', hooks: [{ type: 'command', command: 'b', timeout: 5 }] }],
        Stop: [{ type: 'command', command: 'c', timeout: 60 }],
      },
    })
  })

  test('what each report means: working, needs you, finished', () => {
    expect(TELLS.map((one) => one.says)).toEqual(['SessionStart', 'PreInvocation', 'AskUser', 'PostToolUse', 'Stop'])
    expect(PROGRAM.signal('PreInvocation')).toBe('working')
    expect(PROGRAM.signal('AskUser')).toBe('needs-you')
    expect(PROGRAM.signal('Confirm')).toBe('needs-you')
    expect(PROGRAM.signal('Stop')).toBe('finished')
    expect(PROGRAM.signal('SessionStart')).toBeNull()
    expect(PROGRAM.signal('constructor')).toBeNull()
  })
})

describe('OSC 7501, the terminal status the CLI writes', () => {
  test('working, blocked and done are the session’s states; idle, clear and a child record are not', () => {
    expect(oscEvent('state=working:app=agy')).toBe('OscWorking')
    expect(oscEvent('state=blocked:kind=permission')).toBe('OscBlocked')
    expect(oscEvent('state=blocked:kind=question:msg=SGk=')).toBe('OscBlocked')
    expect(oscEvent('state=done')).toBe('OscDone')
    expect(oscEvent('state=error')).toBe('OscDone')
    expect(oscEvent('state=idle')).toBeNull()
    expect(oscEvent('state=clear')).toBeNull()
    expect(oscEvent('state=working:id=sub/1')).toBeNull()
    expect(PROGRAM.signal('OscBlocked')).toBe('needs-you')
  })

  test('read off the output with either terminator, in order, and a report split across chunks is read when it ends', () => {
    expect(oscEvents('hello\x1b]7501;state=working\x07 there\x1b]7501;state=done\x1b\\').events).toEqual(['OscWorking', 'OscDone'])
    const first = oscEvents('text\x1b]7501;state=blo')
    expect(first.events).toEqual([])
    expect(first.carry).toBe('\x1b]7501;state=blo')
    expect(oscEvents('cked:kind=permission\x07more', first.carry).events).toEqual(['OscBlocked'])
    expect(oscEvents('\x1b]0;a title\x07plain').events).toEqual([])
    expect(oscEvents('ends with \x1b]75').carry).toBe('\x1b]75')
  })
})

describe('its records', () => {
  test('a conversation’s folder is under brain/, and only its transcript’s existence and time are read', async () => {
    expect(brainDir(A)).toBe(join(CONFIG, 'brain', A))
    expect(await recordFile('', A)).toBeNull()
    const file = writeConversation(A, ['{"anything":"at all"}'])
    expect(await recordFile('', A)).toBe(file)
    expect(await recordFile('', '../etc')).toBeNull()
  })

  test('a new session is named by its own reports; it exists once this computer has it, or a session of this module’s vouched for it', async () => {
    const project = scratch('settled')
    const opened = PROGRAM.newId()
    expect(await PROGRAM.settled(project, opened, 0)).toBeNull()
    learnSession(opened, B)
    expect(await PROGRAM.settled(project, opened, 0)).toBe(B)
    vouch(C)
    expect(await PROGRAM.settled(project, C, 0)).toBe(C)
  })

  test('a project’s sessions are the ones its record holds and this computer has, titled as their status line said', async () => {
    const project = scratch('sessions')
    const other = '01a175cf-0000-4000-8000-00000000000f'
    writeConversation(A, [], Date.parse('2026-10-26T10:00:00Z'))
    expect(assign(project, { epic: 'thesis', parts: [], kehikko: null }, A, { label: 'tighten the methods' }).ok).toBe(true)
    let listed = await PROGRAM.sessions(project)
    expect(listed.map((one) => one.id)).toEqual([A])
    expect(listed[0]!.label).toBe('tighten the methods')
    expect(listed[0]!.lastActive).toBe(Date.parse('2026-10-26T10:00:00Z'))
    expect(learnTitle(A, 'Tightening\nthe methods')).toBe(true)
    expect(titleOf(A)).toBe('Tightening')
    listed = await PROGRAM.sessions(project, [other])
    expect(listed.map((one) => one.label)).toEqual(['Tightening'])
  })

  test('a conversation keeps one id: where it is now is that id', () => {
    expect(headOf(A)).toBe(A)
  })

  test('a place’s name is one line, never a flag', () => {
    expect(sessionName(['--yolo', 'thesis\nmethods'])).toBe('yolo · thesis methods')
  })
})

describe('which process holds which conversation', () => {
  test('ps: the agy processes started on a conversation by id, and nothing else', () => {
    const said = readPs([
      `  501 /Users/x/.local/bin/agy --conversation ${A} --add-dir /tmp/k`,
      `  502 agy --conversation=${B}`,
      `  503 /usr/bin/vim --conversation ${C}`,
      '  504 agy -c',
      `    1 agy --conversation ${C}`,
    ].join('\n'))
    expect([...said]).toEqual([[501, A], [502, B]])
  })

  test('lsof’s cwd field is each process’s folder', () => {
    expect([...readCwds('p501\nfcwd\nn/Users/x/thesis\np502\nfcwd\nn/tmp\n')]).toEqual([[501, '/Users/x/thesis'], [502, '/tmp']])
  })

  test('asking this machine reads ps and answers, never fails silently into an empty list', async () => {
    const running = await PROGRAM.active('agy')
    expect(running.known).toBe(true)
  })
})

describe('installing', () => {
  test('the vendor’s own line, into ~/.local/bin, without admin rights', () => {
    const install = installFor()
    expect(install.line).toBe('curl -fsSL https://antigravity.google/cli/install.sh | bash')
    expect(install.lands).toBe('~/.local/bin')
    expect(install.line).not.toContain('sudo')
    expect(install.source).toContain('antigravity.google')
  })

  test('a stand-in can be named by whoever started the server', () => {
    expect(PROGRAM.install({ KEHIKOT_ANTIGRAVITY_INSTALL_LINE: '/bin/true' }).line).toBe('/bin/true')
  })

  test('is run with the usual places on its PATH', () => {
    expect(PROGRAM.installEnvironment({ HOME, PATH: '/x' }).PATH?.split(delimiter)).toEqual(['/x', join(HOME, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(HOME, '.bun', 'bin'), '/usr/bin', '/bin'])
  })

  test('when it did not finish, said in a sentence with the next step', () => {
    expect(deniedWrite('\x1b[31mmkdir: /Users/x/.local/bin: Permission denied\x1b[0m')).toBe(true)
    expect(PROGRAM.explain('', 0, 'x')).toContain('not found afterwards')
    expect(PROGRAM.explain('Permission denied', 1, 'x')).toContain('~/.local/bin')
    expect(PROGRAM.explain('curl: (6) Could not resolve host: antigravity.google', 6, 'the line')).toContain('could not be downloaded')
    expect(PROGRAM.explain('', 127, 'x')).toContain('curl or bash')
    expect(PROGRAM.explain('boom', 2, 'the line')).toBe('The installer exited with 2. See the log, or run the line in a terminal.')
  })
})
