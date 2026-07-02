import { expect, test } from 'vitest'
import { parseRows } from '../src/sheets.js'

const rows = [
  ['Task#', 'Business', 'Task', 'Owner', 'Dependency/Blocker', 'Working Status', 'Deliverable Link', 'Last Updated'],
  ['41', 'JRS', 'School contacts — 62 Tucson principals', 'Agent M42', '', 'Delivered - awaiting review', 'https://docs.google.com/spreadsheets/d/1-vmz/edit', '2026-06-29'],
  ['13', 'Brightly', 'Confirm website ready', 'Me', 'price decision', 'blocked — waiting on legal', 'https://m42hqworkspace.slack.com/archives/x/p1', '2026-06-24'],
  ['99', 'Acme', 'Ignore me', 'x', '', 'done', '', ''],
]

test('parseRows maps headers, normalizes status, classifies deliverable source, filters to JRS/Brightly', () => {
  const tasks = parseRows(rows)
  expect(tasks).toHaveLength(2)

  const jrs = tasks.find((t) => t.taskNum === '41')!
  expect(jrs.company).toBe('JRS')
  expect(jrs.status).toBe('delivered_awaiting')
  expect(jrs.deliverableDriveUrl).toContain('docs.google.com')
  expect(jrs.deliverableSlackUrl).toBeUndefined()
  expect(jrs.lastUpdatedTs).toBeGreaterThan(0)

  const br = tasks.find((t) => t.taskNum === '13')!
  expect(br.status).toBe('blocked')
  expect(br.deliverableSlackUrl).toContain('slack.com')
  expect(br.deliverableDriveUrl).toBeUndefined()
})

test('parseRows returns empty for header-only or empty input', () => {
  expect(parseRows([])).toEqual([])
  expect(parseRows([['Task#', 'Business']])).toEqual([])
})
