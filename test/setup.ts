import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * A document, for the tests that render one — and a machine of their own.
 *
 * Everything this module reads outside a project is pointed at a scratch
 * folder HERE, before any test file is imported, so that no test can read
 * somebody's real Antigravity conversations (`~/.gemini`), find their real
 * `agy`, or write a registration into their real host: the home folder, the
 * module registry and PATH are all the test's own. A test that wants an `agy`
 * puts the stand-in (`test/stand-in/agy`) on its PATH; the real CLI is never run.
 */
export const SCRATCH = mkdtempSync(join(tmpdir(), 'kehikko-antigravity-test-'))
export const HOME = join(SCRATCH, 'home')
/** Where the CLI would keep its conversations in this scratch home. */
export const CONFIG = join(HOME, '.gemini', 'antigravity-cli')
mkdirSync(CONFIG, { recursive: true })
process.env.HOME = HOME
/* The Bun these tests run on, for the stand-in `agy` (test/stand-in/agy runs agy.ts with it). */
process.env.KEHIKOT_TEST_BUN = process.execPath
process.env.KEHIKOT_MODULES_DIR = join(SCRATCH, 'modules')
process.env.PATH = '/usr/bin:/bin'
/* No host: a test that wants one stands one in. Port 9 refuses at once. */
process.env.KEHIKOT_ORIGINS = 'http://127.0.0.1:9'
delete process.env.KEHIKOT_ANTIGRAVITY_INSTALL_LINE
delete process.env.KEHIKOT_ANTIGRAVITY_QUIET_MS
for (const name of ['ANTIGRAVITY_CONVERSATION_ID', 'ANTIGRAVITY_PROJECT_ID']) delete process.env[name]

GlobalRegistrator.register()
