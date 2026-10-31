import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { settingsDeclarationSchema } from 'kehikot-module-protocol'

import { MANIFEST, TICKET, answer, hostCheck } from '../doors.ts'
import { readSettings, writeSettings } from '../record.ts'
import { DEFAULTS, SETTINGS, extraFolders, folderFlags, folderIssue, sessionFlags, settingIssue, settingsOf } from '../settings.ts'

/**
 * Antigravity's settings at its door for the host (protocol 2.15.0): "Resume conversations cut off by a
 * restart" declared and the person's; a read and a change round trip through the same
 * `.kehikot/antigravity/settings.json` in the same format the page's toggle writes; an agent refused; a
 * person's pass asked only of the origins the host started this module with.
 */

const made: string[] = []
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})
let project: string
const realFetch = globalThis.fetch
const realHas = hostCheck.has
beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-antigravity-settings-')))
  made.push(project)
  hostCheck.has = async (folder) => folder === project
})
afterEach(() => {
  globalThis.fetch = realFetch
  hostCheck.has = realHas
})

const file = () => join(project, '.kehikot', 'antigravity', 'settings.json')
const PASS = 'q'.repeat(30)

async function get(at = project) {
  const reply = await answer('GET', '/api/kehikot/settings', new URLSearchParams({ project: at }), null, null)
  return reply!.body as { values: Record<string, unknown>; file?: string; problem?: string }
}
async function set(body: Record<string, unknown>, ticket: string | null = null) {
  const reply = await answer('POST', '/api/kehikot/settings', new URLSearchParams(), { project, ...body }, ticket)
  return reply!.body as { outcome: string; why: string; values?: Record<string, unknown> }
}
function host(person: boolean) {
  const asked: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input))
    return Response.json({ ok: true, person })
  }) as unknown as typeof fetch
  return asked
}

describe('the declaration', () => {
  test('is in the manifest, parses, is the person’s, and defaults to on as the file does', () => {
    expect(MANIFEST.declares.settings).toEqual(SETTINGS)
    expect(settingsDeclarationSchema.parse(SETTINGS)).toEqual(SETTINGS)
    expect(SETTINGS.map((one) => one.key)).toEqual(['resumeCutOff', 'model', 'effort', 'mode', 'folders', 'wakeOnMessages', 'actOnMessages'])
    expect(SETTINGS[0]).toMatchObject({ key: 'resumeCutOff', type: 'boolean', default: true, scope: 'project', personOnly: true })
    expect(SETTINGS.every((one) => one.personOnly)).toBe(true)
    expect(readSettings(project)).toEqual(DEFAULTS)
  })

  test('none of them is about the sandbox, and the mode never approves commands by itself (no auto)', () => {
    expect(SETTINGS.map((one) => one.key).join(' ')).not.toMatch(/sandbox|permission/i)
    expect(SETTINGS.find((one) => one.key === 'mode')?.choices?.map((one) => one.value)).toEqual(['default', 'accept-edits', 'plan'])
    expect(sessionFlags({ ...DEFAULTS, mode: 'auto' })).toEqual([])
  })
})

describe('what a session started here is given', () => {
  test('nothing for what is left at its default: the person’s own Antigravity config decides', () => {
    expect(sessionFlags(DEFAULTS)).toEqual([])
  })

  test('the model, its effort and the mode, as the CLI’s own one-session flags', () => {
    expect(sessionFlags({ ...DEFAULTS, model: 'Gemini 3.8 Flash (High)', effort: 'high', mode: 'plan' })).toEqual(['--model', 'Gemini 3.8 Flash (High)', '--effort', 'high', '--mode', 'plan'])
  })

  test('a model that is not one word is not a model, and a value a file holds that is not one is the default', () => {
    expect(settingIssue('model', 'gemini" --dangerously-skip-permissions')).toContain('one name')
    expect(settingIssue('model', '--yolo')).toContain('one name')
    expect(settingIssue('effort', 'minimal')).not.toBeNull()
    expect(settingIssue('mode', 'auto')).not.toBeNull()
    expect(settingIssue('sandbox', 'off')).toContain('no setting')
    expect(settingsOf({ model: 'x"y', effort: 'loud', mode: 'plan', resumeCutOff: 'yes' })).toEqual({ ...DEFAULTS, mode: 'plan' })
  })
})

describe('read and change, round trip', () => {
  test('get reads the default with no file, then what the toggle wrote', async () => {
    expect(await get()).toEqual({ ok: true, values: DEFAULTS, file: '.kehikot/antigravity/settings.json' } as never)
    writeSettings(project, { ...DEFAULTS, resumeCutOff: false })
    expect((await get()).values).toEqual({ ...DEFAULTS, resumeCutOff: false })
  })

  test("the page's ticket is the person: saved, in the format the toggle writes", async () => {
    expect((await set({ key: 'resumeCutOff', value: false }, TICKET)).outcome).toBe('saved')
    expect(readFileSync(file(), 'utf8')).toBe(`${JSON.stringify({ ...DEFAULTS, resumeCutOff: false }, null, 2)}\n`)
    expect(readSettings(project).resumeCutOff).toBe(false)
    expect((await set({ key: 'model', value: 'gemini-3.8-flash' }, TICKET)).outcome).toBe('saved')
    expect((await set({ key: 'model', value: '"quoted"' }, TICKET)).outcome).toBe('refused')
    /* And the page's own route still reads it. */
    const page = await answer('GET', '/api/settings', new URLSearchParams({ projectPath: project }), null, TICKET)
    expect((page!.body as { settings: unknown }).settings).toEqual({ ...DEFAULTS, resumeCutOff: false, model: 'gemini-3.8-flash' })
  })

  test('a folder the host does not hold is neither read nor written', async () => {
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-antigravity-settings-other-')))
    made.push(other)
    expect((await get(other)).problem).toContain('not a project open in Kehikot')
    const said = await answer('POST', '/api/kehikot/settings', new URLSearchParams(), { project: other, key: 'resumeCutOff', value: false }, TICKET)
    expect((said!.body as { outcome: string }).outcome).toBe('refused')
    expect(existsSync(join(other, '.kehikot'))).toBe(false)
  })
})

describe('who may change it', () => {
  test('an agent is refused, with or without saying "person", and nothing is written', async () => {
    const asked = host(true)
    for (const body of [{ key: 'resumeCutOff', value: false }, { key: 'resumeCutOff', value: false, by: 'person' }]) {
      const said = await set(body)
      expect(said.outcome).toBe('refused')
      expect(said.why).toContain('An agent cannot change it')
    }
    expect(asked).toEqual([])
    expect(existsSync(file())).toBe(false)
  })

  test("a person's pass is asked only of the host's own origins, never of an address the request names", async () => {
    const asked = host(true)
    const said = await set({ key: 'resumeCutOff', value: false, by: 'person', pass: PASS, host: 'http://evil.example' })
    expect(said.outcome).toBe('saved')
    expect(asked).toHaveLength(1)
    expect(asked[0]!.startsWith(`${process.env.KEHIKOT_ORIGINS}/host/settings-pass?`)).toBe(true)
    expect(asked[0]).toContain('module=kehikot.antigravity')
    expect(asked[0]).toContain('key=resumeCutOff')
  })

  test('a pass the host does not vouch for is refused', async () => {
    host(false)
    expect((await set({ key: 'resumeCutOff', value: false, by: 'person', pass: PASS })).outcome).toBe('refused')
    expect(readSettings(project).resumeCutOff).toBe(true)
  })
})

describe('other folders sessions may work in', () => {
  const HOME = process.env.HOME!
  const folder = (name: string) => {
    const at = join(realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-antigravity-folder-'))), name)
    mkdirSync(at, { recursive: true })
    made.push(at)
    return at
  }

  test('is declared as a list of the person’s, empty by default', () => {
    expect(SETTINGS.find((one) => one.key === 'folders')).toMatchObject({ type: 'list', default: [], scope: 'project', personOnly: true, label: 'Other folders sessions may work in' })
    expect(DEFAULTS.folders).toEqual([])
  })

  test('an existing folder is taken; the disk, the home folder, a folder holding it, system and secret folders are refused with a sentence', () => {
    const ok = folder('repo')
    expect(folderIssue(ok, { exists: true })).toBeNull()
    expect(settingIssue('folders', [ok, ''])).toBeNull()
    expect(folderIssue('/', { exists: true })).toContain('whole disk')
    expect(folderIssue(HOME, { exists: true })).toContain('home folder')
    expect(folderIssue(`${HOME}/`, { exists: true })).toContain('home folder')
    expect(folderIssue(join(HOME, '..'), { exists: true })).toContain('holds your home folder')
    expect(folderIssue('/Users', { exists: true })).not.toBeNull()
    expect(folderIssue('/System/Library', { exists: true })).toContain('system folder')
    expect(folderIssue('/usr/bin', { exists: true })).toContain('system folder')
    expect(folderIssue('/etc', { exists: true })).toContain('system folder')
    expect(folderIssue(join(HOME, '.gemini'), { exists: true })).toContain('sessions are not given it')
    expect(folderIssue(join(HOME, '.ssh', 'keys'), { exists: true })).toContain('sessions are not given it')
    expect(folderIssue('relative/path', { exists: true })).toContain('not an absolute path')
    expect(folderIssue(join(ok, 'not-there'), { exists: true })).toContain('There is no folder')
    const file = join(ok, 'a-file')
    writeFileSync(file, 'x')
    expect(folderIssue(file, { exists: true })).toContain('not a folder')
    expect(settingIssue('folders', [ok, '/'])).toContain('whole disk')
    expect(settingIssue('folders', 'not a list')).not.toBeNull()
  })

  test('a link is judged by where it leads', () => {
    const at = folder('links')
    const link = join(at, 'to-etc')
    symlinkSync('/etc', link)
    expect(folderIssue(link, { exists: true })).toContain('system folder')
  })

  test('a person saves it; it is kept per project, in the same file; an agent is refused; a bad folder is refused and nothing is written', async () => {
    const one = folder('one')
    const two = folder('two')
    expect((await set({ key: 'folders', value: [one, `${two}/`, one] }, TICKET)).outcome).toBe('saved')
    expect(readSettings(project).folders).toEqual([one, two])
    expect(JSON.parse(readFileSync(file(), 'utf8')).folders).toEqual([one, two])
    expect((await get()).values.folders).toEqual([one, two])
    /* Another project has its own. */
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-antigravity-settings-other-')))
    made.push(other)
    expect(readSettings(other).folders).toEqual([])
    const refused = await set({ key: 'folders', value: [HOME] }, TICKET)
    expect(refused.outcome).toBe('refused')
    expect(refused.why).toContain('home folder')
    expect(readSettings(project).folders).toEqual([one, two])
    expect((await set({ key: 'folders', value: [] })).outcome).toBe('refused')
    expect(readSettings(project).folders).toEqual([one, two])
  })

  test('a folder away for now stays in the list, and is not given to a session until it is back', () => {
    const here = folder('here')
    const away = join(here, '..', 'away')
    expect(settingsOf({ folders: [here, away, '/', HOME, 'x', 7] }).folders).toEqual([])
    expect(settingsOf({ folders: [here, away, '/', HOME, 'x'] }).folders).toEqual([here, away])
    expect(extraFolders({ folders: [here, away] }, project)).toEqual([here])
    mkdirSync(away)
    made.push(away)
    expect(extraFolders(settingsOf({ folders: [here, away] }), project)).toEqual([here, away])
  })

  test('the project itself, or a folder inside it, is not added again', () => {
    const inside = join(project, 'sub')
    mkdirSync(inside)
    expect(extraFolders({ folders: [project, inside] }, project)).toEqual([])
  })

  test('each folder is one more --add-dir, and the other settings’ flags are unchanged', () => {
    expect(folderFlags(['/a/one', '/b/two'])).toEqual(['--add-dir', '/a/one', '--add-dir', '/b/two'])
    expect(folderFlags([])).toEqual([])
    expect(sessionFlags({ ...DEFAULTS, folders: ['/a/one'] })).toEqual([])
  })
})
