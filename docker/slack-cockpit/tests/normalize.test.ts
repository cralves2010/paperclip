import { describe, expect, test } from 'vitest'
import { companyHealth, normalizeStatus, rollupCounts } from '../src/normalize.js'
import type { Task } from '../src/model.js'

describe('normalizeStatus (priority-ordered, first match wins)', () => {
  test.each([
    ['waiting on client to approve delivery', 'delivered_awaiting'],
    ['changes requested by Derek', 'changes_requested'],
    ['blocked — waiting on legal', 'blocked'],
    ['needs your decision on price', 'needs_you'],
    ['done / published', 'done'],
    ['Not Started', 'queued'],
    ['drafting the sequence', 'in_progress'],
    ['some unmapped nonsense', 'in_progress'],
  ] as const)('%s -> %s', (raw, expected) => {
    expect(normalizeStatus(raw)).toBe(expected)
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
