import { expect, test } from 'vitest'
import { parseRows } from '../src/sheets.js'

// Real live header row (14 cols, verified via Drive on 2026-07-02) + an optional
// appended "Deliverable Link" column the cockpit reads when present.
const HEADER = [
  'Task #', 'Priority Tier', 'Business / Section', 'Applies To', 'Task', 'Owner',
  'Human Backup', 'Type', 'Dependency / Blocker', 'Status', 'Next action',
  'Blocked on / waiting for', 'Owner-next', 'Last updated', 'Deliverable Link',
]

const rows = [
  HEADER,
  ['42', 'P0', 'JRS', 'JRS', 'School outreach email sequence', 'Agent M42', 'Jason', 'One-time', 'Task 41', 'Waiting', 'Share the 5-email sequence', 'Jason/Derek approval', 'Jason', '2026-06-30', 'https://docs.google.com/document/d/xyz/edit'],
  ['5', 'P0', 'M42 Umbrella', 'All businesses', 'Set up Google Business Profiles', 'Agent M42', 'Me', 'One-time', 'addresses', 'Blocked', 'Draft GBP', 'Derek input', 'Derek', '2026-06-30', ''],
  ['52', 'P1', 'JRS', 'JRS', 'Schedule 48 posts', 'Agent M42', 'Shantal', 'One-time', 'assets', 'Done', 'Auto-publishing', '', 'Agent M42', '2026-06-30', ''],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], // spacer row -> dropped
]

test('parseRows reads the real 14-col schema, ALL companies, real Status column', () => {
  const tasks = parseRows(rows)
  expect(tasks).toHaveLength(3) // spacer dropped; JRS + M42 Umbrella both kept (no company filter)

  const jrs = tasks.find((t) => t.taskNum === '42')!
  expect(jrs.company).toBe('JRS')
  expect(jrs.status).toBe('delivered_awaiting') // "Waiting"
  expect(jrs.description).toContain('Share the 5-email')
  expect(jrs.dependency).toContain('Jason/Derek approval')
  expect(jrs.deliverableDriveUrl).toContain('docs.google.com')

  const umbrella = tasks.find((t) => t.taskNum === '5')!
  expect(umbrella.company).toBe('M42 Umbrella') // all companies now
  expect(umbrella.status).toBe('blocked')

  expect(tasks.find((t) => t.taskNum === '52')!.status).toBe('done')
})

test('parseRows returns empty for header-only or empty input', () => {
  expect(parseRows([])).toEqual([])
  expect(parseRows([HEADER])).toEqual([])
})
