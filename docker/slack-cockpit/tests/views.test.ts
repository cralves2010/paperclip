import { expect, test } from 'vitest'
import { countLine, truncateTitle } from '../src/text.js'
import { buildHomeView } from '../src/views/home.js'
import { buildTaskModal } from '../src/views/taskModal.js'
import type { Task } from '../src/model.js'

const t = (o: Partial<Task>): Task => ({
  taskNum: '1',
  company: 'JRS',
  title: 'x',
  owner: 'a',
  status: 'in_progress',
  rawStatus: '',
  ...o,
})

test('countLine uses single spaces + middot (Slack collapses multi-space)', () => {
  const line = countLine({ inProgress: 4, awaiting: 2, blocked: 0 })
  expect(line).not.toMatch(/ {2,}/)
  expect(line).toContain('·')
})

test('truncateTitle caps at 24 chars', () => {
  expect(truncateTitle('School contacts — 62 Tucson principals').length).toBeLessThanOrEqual(24)
})

test('home view pins the actor groups above Portfolio Health (shared for both viewers)', () => {
  const tasks = [
    t({ status: 'in_progress' }),
    t({ taskNum: '2', status: 'delivered_awaiting', title: 'ready', ownerNext: 'Derek' }),
  ]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  // Derek + Claudio headers ALWAYS render (Claudio's is empty here); team only when non-empty.
  expect(json.indexOf('Needs Derek')).toBeGreaterThan(-1)
  expect(json.indexOf('Needs Claudio')).toBeGreaterThan(-1)
  expect(json).not.toContain('Needs the team')
  expect(json.indexOf('Needs Derek')).toBeLessThan(json.indexOf('Needs Claudio'))
  expect(json.indexOf('Needs Claudio')).toBeLessThan(json.indexOf('Portfolio Health'))
})

test('home view groups act-needed tasks by Owner-next actor, capped at 5 per group', () => {
  const tasks: Task[] = []
  for (let i = 0; i < 7; i++) tasks.push(t({ taskNum: `d${i}`, status: 'needs_you', ownerNext: 'Derek' }))
  tasks.push(t({ taskNum: 'c1', status: 'needs_you', ownerNext: 'Claudio' }))
  tasks.push(t({ taskNum: 'x1', status: 'needs_you', ownerNext: '' })) // empty -> team
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json).toContain('Needs the team')
  expect(json).toContain('Showing 5 of 7') // Derek group capped
  expect(json).toContain('Showing 1 of 1')
})

test('home view stays under the ~100-block App Home ceiling with many companies', () => {
  // One task per company across 120 companies + all THREE actor groups overflowing.
  const tasks: Task[] = Array.from({ length: 120 }, (_, i) =>
    t({ taskNum: String(i + 1), company: `Co${i + 1}`, status: 'in_progress' }),
  )
  for (let i = 0; i < 8; i++) {
    tasks.push(t({ taskNum: `d${i}`, company: `Co${i + 1}`, status: 'needs_you', ownerNext: 'Derek' }))
    tasks.push(t({ taskNum: `c${i}`, company: `Co${i + 1}`, status: 'needs_you', ownerNext: 'Claudio' }))
    tasks.push(t({ taskNum: `t${i}`, company: `Co${i + 1}`, status: 'needs_you' }))
  }
  const view = buildHomeView(tasks, { kind: 'portfolio' })
  expect(view.blocks.length).toBeLessThan(100)
  // Overflow beyond the cap is summarized, not dropped silently.
  expect(JSON.stringify(view)).toContain('more companies')
})

test('task modal clamps description and never emits a URL button without a URL', () => {
  const json = JSON.stringify(buildTaskModal(t({ description: 'x'.repeat(5000), deliverableDriveUrl: undefined })))
  expect(json).not.toContain('"url"')
  expect(json.length).toBeLessThan(20000)
})
