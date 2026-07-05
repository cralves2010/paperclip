import { describe, expect, test } from 'vitest'
import { companyHealth, normalizeActor, normalizeStatus, rollupCounts } from '../src/normalize.js'
import type { Task } from '../src/model.js'

describe('normalizeStatus (priority-ordered, first match wins)', () => {
  test.each([
    ['waiting on client to approve delivery', 'delivered_awaiting'],
    ['changes requested by Derek', 'changes_requested'],
    ['blocked — waiting on legal', 'blocked'],
    ['needs your decision on price', 'needs_you'],
    // Derek-side gates beat generic block/waiting (pivot Day-0 hardening 2026-07-03)
    ['Waiting on Derek', 'needs_you'],
    ['Blocked — waiting on Derek pricing decision', 'needs_you'],
    ['Blocked — Eric must confirm insurance', 'needs_you'],
    ['waiting on Jason for webinar date', 'needs_you'],
    ['done / published', 'done'],
    ['Not Started', 'queued'],
    ['drafting the sequence', 'in_progress'],
    ['some unmapped nonsense', 'in_progress'],
    ['In Progress', 'in_progress'],
    ['Blocked', 'blocked'],
    ['Waiting', 'delivered_awaiting'],
    ['Done', 'done'],
  ] as const)('%s -> %s', (raw, expected) => {
    expect(normalizeStatus(raw)).toBe(expected)
  })
})

describe('normalizeActor (Owner-next -> Needs Derek / Needs Claudio / team)', () => {
  test.each([
    // Derek's side: Derek himself + his people
    ['Derek', 'derek'],
    ['Jason', 'derek'],
    ['Eric', 'derek'],
    ['Shantal', 'derek'],
    ['Sydney', 'derek'],
    // Our side
    ['Claudio', 'claudio'],
    ['Me', 'claudio'],
    ['Agent M42', 'claudio'],
    ['agente', 'claudio'],
    // Ambiguous (both sides named): Derek CORE name (Derek/Jason/Eric) wins…
    ['Claudio (Derek optional sign-off)', 'derek'],
    ['Agent M42 (Jason optional sign-off)', 'derek'],
    // …otherwise it stays on Claudio (Shantal/Sydney are not the tiebreaker)
    ['Claudio (Shantal optional sign-off)', 'claudio'],
    // Empty / unrecognized -> team (never guess a person from noise)
    ['', 'team'],
    ['   ', 'team'],
    ['Outside vendor', 'team'],
  ] as const)('%s -> %s', (raw, expected) => {
    expect(normalizeActor(raw)).toBe(expected)
  })

  test('undefined Owner-next -> team', () => {
    expect(normalizeActor(undefined)).toBe('team')
  })
})

const t = (status: Task['status']): Task => ({
  taskNum: '1',
  company: 'JRS',
  title: 'x',
  owner: 'a',
  status,
  rawStatus: '',
})

test('companyHealth: blocked when any task is blocked or needs_you', () => {
  expect(companyHealth([t('in_progress'), t('blocked')])).toBe('blocked')
  expect(companyHealth([t('in_progress'), t('needs_you')])).toBe('blocked')
  expect(companyHealth([t('in_progress'), t('done')])).toBe('on_track')
  expect(companyHealth([t('in_progress'), t('delivered_awaiting')])).toBe('at_risk')
})

test('rollupCounts buckets in-progress/awaiting/blocked', () => {
  const counts = rollupCounts([t('in_progress'), t('queued'), t('delivered_awaiting'), t('needs_you'), t('blocked')])
  expect(counts).toEqual({ inProgress: 2, awaiting: 2, blocked: 1 })
})
