import { expect, test } from 'vitest'
import { commentCountByTask, parseComments } from '../src/sheets.js'

// Comments tab header (A–E). Intentionally whitespace-y / mixed-case to prove
// the tolerant colIndex mapping (mirrors the real tracker header quirks).
const HEADER = ['Timestamp', ' Task # ', 'Author', 'Comment', 'Seen']

test('parseComments maps the A–E schema, tolerant headers, drops empty Task #', () => {
  const rows = [
    HEADER,
    ['2026-07-05T10:00:00Z', '41', 'derek', 'Start outreach', ''],
    ['2026-07-05T11:00:00Z', '41', 'claudio', 'On it', 'cc-w2'],
    ['2026-07-05T12:00:00Z', '13', 'derek', 'Pick the price', ''],
    ['2026-07-05T13:00:00Z', '', 'ghost', 'no task -> dropped', ''],
  ]
  const comments = parseComments(rows)
  expect(comments).toHaveLength(3)
  expect(comments[0]).toEqual({
    timestamp: '2026-07-05T10:00:00Z',
    taskNum: '41',
    author: 'derek',
    text: 'Start outreach',
    seen: '',
  })
  expect(comments[1].seen).toBe('cc-w2')
})

test('parseComments returns [] for header-only or empty input', () => {
  expect(parseComments([])).toEqual([])
  expect(parseComments([HEADER])).toEqual([])
})

test('commentCountByTask counts per Task #', () => {
  const rows = [
    HEADER,
    ['t1', '41', 'a', 'one', ''],
    ['t2', '41', 'b', 'two', ''],
    ['t3', '13', 'c', 'three', ''],
  ]
  const counts = commentCountByTask(parseComments(rows))
  expect(counts.get('41')).toBe(2)
  expect(counts.get('13')).toBe(1)
  expect(counts.get('99')).toBeUndefined()
})
