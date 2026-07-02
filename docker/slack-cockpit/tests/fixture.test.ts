import { expect, test } from 'vitest'
import { DEMO_TASKS } from '../src/fixture.js'
import { buildHomeView } from '../src/views/home.js'

test('demo fixture covers JRS + Brightly with valid canonical statuses', () => {
  const companies = new Set(DEMO_TASKS.map((t) => t.company))
  expect(companies).toEqual(new Set(['JRS', 'Brightly']))
  expect(DEMO_TASKS.length).toBeGreaterThanOrEqual(16)
  const valid = new Set(['queued', 'in_progress', 'delivered_awaiting', 'needs_you', 'changes_requested', 'blocked', 'done'])
  for (const t of DEMO_TASKS) expect(valid.has(t.status)).toBe(true)
})

test('home view renders from the demo fixture without throwing', () => {
  const view = buildHomeView(DEMO_TASKS, { kind: 'portfolio' })
  expect(view.type).toBe('home')
  const json = JSON.stringify(view)
  expect(json).toContain('JRS')
  expect(json).toContain('Brightly')
})
