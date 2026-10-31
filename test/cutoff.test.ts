import { describe, expect, test } from 'bun:test'

import { cutOffWords, cutOffs, midTurn, movedOn } from '../cutoff.ts'

describe('a turn cut off', () => {
  test('the transcript is never parsed: its rows are not documented, so the record’s own mark is what says a turn was cut off', () => {
    const rows = [JSON.stringify({ type: 'user', text: 'carry on' }), JSON.stringify({ anything: 'else' })].join('\n')
    expect(midTurn(rows)).toBe(false)
    expect(movedOn(rows, 0)).toBe(false)
    expect(cutOffs(rows)).toEqual([])
  })

  test('a cut-off turn is said in words, with what opening it does', () => {
    const words = cutOffWords([{ at: 1, kind: 'turn', summary: 'Its turn was cut off when Kehikot restarted', tasks: 1 }])
    expect(words.said).toBe('its turn was cut off when Kehikot restarted')
    expect(words.detail).toContain('Open it to carry on')
  })
})
