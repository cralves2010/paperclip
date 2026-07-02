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

test('home view pins Needs You above Portfolio Health', () => {
  const tasks = [t({ status: 'in_progress' }), t({ taskNum: '2', status: 'delivered_awaiting', title: 'ready' })]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json.indexOf('Needs You')).toBeGreaterThan(-1)
  expect(json.indexOf('Needs You')).toBeLessThan(json.indexOf('Portfolio Health'))
})

test('task modal clamps description and never emits a URL button without a URL', () => {
  const json = JSON.stringify(buildTaskModal(t({ description: 'x'.repeat(5000), deliverableDriveUrl: undefined })))
  expect(json).not.toContain('"url"')
  expect(json.length).toBeLessThan(20000)
})
