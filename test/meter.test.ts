import { describe, expect, test } from 'bun:test'

import { contextOf, contextWords, readStatus, thresholds, tokensSaid } from '../meter.ts'

const T = '11111111-1111-4111-8111-111111111111'
const q = (more: Record<string, string>) => new URLSearchParams({ thread: T, ...more })

describe('what a status line said', () => {
  test('is numbers, a state word, a model’s name and a title, each checked; anything else is dropped', () => {
    const said = readStatus(q({ state: 'tool_use', asking: '1', used: '41.5', size: '1048576', input: '400000', cacheRead: '30000', cacheWrite: '0', output: '200', cost: '0.12', model: 'Gemini 3.8 Flash (High)', title: 'Tighten \\"the\\" methods\\nnow', email: 'someone@example.com' }), 5)!
    expect(said).toEqual({ thread: T, state: 'tool_use', asking: true, used: 41.5, window: 1048576, usage: { input: 400000, cacheRead: 30000, cacheWrite: 0, output: 200 }, model: 'Gemini 3.8 Flash (High)', cost: 0.12, title: 'Tighten "the" methods now', at: 5 })
    expect(JSON.stringify(said)).not.toContain('example.com')
    expect(readStatus(q({ state: 'rm -rf', used: 'lots', size: '-4' }), 0)).toMatchObject({ state: '', used: null, window: null, usage: null })
    expect(readStatus(new URLSearchParams({ thread: '../x' }), 0)).toBeNull()
  })

  test('the context from it: the share the CLI said of the window it said; nothing until it says either', () => {
    const context = contextOf(readStatus(q({ used: '41.5', size: '1000000', model: 'Gemini 3.8 Flash (High)' }), 9))!
    expect(context).toMatchObject({ tokens: 415000, window: 1000000, windowSure: true, percent: 42, soon: false, from: 'status', at: 9, compacted: null })
    expect(contextOf(readStatus(q({ used: '85', size: '1000000' }), 0))!.soon).toBe(true)
    expect(contextOf(readStatus(q({}), 0))).toBeNull()
    expect(contextOf(null)).toBeNull()
    expect(contextOf(readStatus(q({ input: '1000', cacheRead: '500' }), 0))!.tokens).toBe(1500)
  })

  test('in words, the warning never by colour alone, and no compaction point is made up', () => {
    const words = contextWords(contextOf(readStatus(q({ used: '85', size: '1000000' }), 0))!)
    expect(words.line).toBe('850k of 1.0M · 85%')
    expect(words.warning).toBe('85% — filling up; it compacts by itself')
    expect(words.title).toContain('at a point it does not say')
    expect(thresholds(1000)).toEqual({ compactAt: 1000, warnAt: 800, effective: 1000 })
    expect(tokensSaid(823)).toBe('823')
  })
})
