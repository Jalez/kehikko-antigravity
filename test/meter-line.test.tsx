import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

import { contextOf, readStatus } from '../meter.ts'
import { CLEAR_ARMED, ContextLine, NO_SPLIT, type Command } from '../src/view/meter.tsx'

/** The line under the session on screen: what it says, its breakdown, and Compact and Clear. */

afterEach(cleanup)

const status = (more: Record<string, string>) => readStatus(new URLSearchParams({ thread: '11111111-1111-4111-8111-111111111111', state: 'idle', used: '87', size: '1048576', input: '900000', cacheRead: '12000', cacheWrite: '0', output: '400', model: 'Gemini 3.8 Flash (High)', cost: '0.42', ...more }), Date.parse('2026-10-24T11:55:51.076Z'))
const near = contextOf(status({}))!
const early = contextOf(status({ used: '12' }))!

function line(props: { ready?: string | null; context?: typeof near | null; armedMs?: number } = {}) {
  const sent: Command[] = []
  const view = render(
    <ContextLine context={props.context === undefined ? near : props.context} ready={props.ready ?? null} armedMs={props.armedMs} onCommand={(which) => (sent.push(which), true)} />,
  )
  const q = (selector: string) => view.container.querySelector(selector) as HTMLElement | null
  return { view, sent, q }
}

describe('the context line', () => {
  test('says the share, the figure and the warning in words — never by colour alone', () => {
    const { q, view } = line()
    expect(q('[data-context-percent]')?.textContent).toContain('87% — filling up')
    expect(view.container.textContent).toContain('912k / 1.0M')
    expect(q('[data-meter-bar]')?.getAttribute('data-meter-bar')).toBe('87')
    expect(q('[data-context-trigger]')?.getAttribute('title')).toContain('compacts by itself, at a point it does not say')
  })

  test('nothing sent yet is said as such', () => {
    const { q } = line({ context: null })
    expect(q('[data-context-percent]')?.textContent).toBe('nothing sent yet')
  })

  test('pressed, it opens a breakdown with the figures it has, and says what is not said; Escape closes it', () => {
    const { q } = line({ context: early })
    fireEvent.click(q('[data-context-trigger]')!)
    const panel = q('[data-breakdown]')!
    expect(panel.textContent).toContain('125,829 of 1,048,576 tokens')
    expect(panel.textContent).toContain('not known')
    expect(panel.textContent).toContain(NO_SPLIT)
    expect(q('[data-context-trigger]')?.getAttribute('aria-expanded')).toBe('true')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(q('[data-breakdown]')).toBeNull()
  })

  test('Compact goes at once; Clear asks first, saying the session starts over and the old one is kept', () => {
    const { q, sent } = line()
    fireEvent.click(q('[data-command="compact"]')!)
    expect(sent).toEqual(['compact'])
    fireEvent.click(q('[data-command="clear"]')!)
    expect(sent).toEqual(['compact'])
    expect(q('[data-context-said]')?.textContent).toBe(CLEAR_ARMED)
    expect(CLEAR_ARMED).toContain('new conversation')
    expect(CLEAR_ARMED).toContain('This one is kept')
    expect(q('[data-command="clear"]')?.textContent).toBe('Clear: sure?')
    fireEvent.click(q('[data-command="clear"]')!)
    expect(sent).toEqual(['compact', 'clear'])
  })

  test('an armed Clear lets go by itself, and on Escape', async () => {
    const { q, sent } = line({ armedMs: 30 })
    fireEvent.click(q('[data-command="clear"]')!)
    await act(() => new Promise((done) => setTimeout(done, 60)))
    expect(q('[data-command="clear"]')?.textContent).toBe('Clear')
    fireEvent.click(q('[data-command="clear"]')!)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    fireEvent.click(q('[data-command="clear"]')!)
    expect(sent).toEqual([])
  })

  test('while Antigravity is working both wait, and a press says why in words', () => {
    const why = 'Antigravity is working. Compact and Clear wait until it is back at its prompt.'
    const { q, sent, view } = line({ ready: why })
    expect(q('[data-command="compact"]')?.getAttribute('aria-disabled')).toBe('true')
    expect(q('[data-command="clear"]')?.getAttribute('title')).toBe(`Clear waits: ${why}`)
    fireEvent.click(q('[data-command="clear"]')!)
    fireEvent.click(q('[data-command="clear"]')!)
    fireEvent.click(q('[data-command="compact"]')!)
    expect(sent).toEqual([])
    expect(q('[data-context-said]')?.textContent).toBe(`Compact waits: ${why}`)
    expect(view.container.querySelector('[data-context-line]')?.getAttribute('data-ready')).toBe('no')
  })
})
