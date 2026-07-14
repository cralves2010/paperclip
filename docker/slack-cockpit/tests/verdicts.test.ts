import { expect, test } from 'vitest'
import { verdictsFor, rawStatusFor } from '../src/verdicts.js'
import { normalizeStatus } from '../src/normalize.js'
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

test('verdictsFor: observers get nothing; a principal gets status-keyed buttons', () => {
  const task = t({ status: 'delivered_awaiting', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/1' })
  expect(verdictsFor(task, false)).toEqual([]) // observer (random allowlisted) never gets a live verdict
  expect(verdictsFor(task, true).map((v) => v.id)).toEqual(['approve', 'request_changes'])
})

test('verdictsFor: delivered_awaiting → Approve+Request WITH a link, none without (parity, any owner)', () => {
  const withLink = t({ status: 'delivered_awaiting', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/1' })
  expect(verdictsFor(withLink, true).map((v) => v.id)).toEqual(['approve', 'request_changes'])
  const noLink = t({ status: 'delivered_awaiting', ownerNext: 'Derek' })
  expect(verdictsFor(noLink, true)).toEqual([]) // linkless delivery = the ⚠️ defect, no Approve
  // Parity: a principal gets the buttons even when the task nominally awaits the OTHER principal.
  const awaitingClaudio = t({ status: 'delivered_awaiting', ownerNext: 'Claudio', deliverableDriveUrl: 'https://d/1' })
  expect(verdictsFor(awaitingClaudio, true).map((v) => v.id)).toEqual(['approve', 'request_changes'])
})

test('verdictsFor: needs_you → Mark done + Answer; blocked → Answer; done → Reopen; in_progress → none', () => {
  expect(verdictsFor(t({ status: 'needs_you', ownerNext: 'Derek' }), true).map((v) => v.id)).toEqual(['mark_done', 'answer_release'])
  expect(verdictsFor(t({ status: 'blocked', ownerNext: 'Derek' }), true).map((v) => v.id)).toEqual(['answer_release'])
  expect(verdictsFor(t({ status: 'done' }), true).map((v) => v.id)).toEqual(['reopen'])
  expect(verdictsFor(t({ status: 'in_progress', ownerNext: 'Derek' }), true)).toEqual([])
})

test('rawStatusFor maps each verdict to its raw Status string', () => {
  expect(rawStatusFor('approve')).toBe('Done')
  expect(rawStatusFor('mark_done')).toBe('Done')
  expect(rawStatusFor('reopen')).toBe('In Progress')
  expect(rawStatusFor('answer_release')).toBe('In Progress')
  expect(rawStatusFor('request_changes', 'fix the CTA')).toBe('Changes requested — fix the CTA')
  expect(rawStatusFor('request_changes', '   ')).toBe('Changes requested — see comment') // empty reason fallback
})

test('GUARDRAIL: every raw Status a verdict writes normalizes back to the intended canonical status', () => {
  // If a written raw string does not normalize to the right canonical status, the
  // board would mislabel the task — this is the round-trip that prevents that.
  expect(normalizeStatus(rawStatusFor('approve'))).toBe('done')
  expect(normalizeStatus(rawStatusFor('mark_done'))).toBe('done')
  expect(normalizeStatus(rawStatusFor('reopen'))).toBe('in_progress')
  expect(normalizeStatus(rawStatusFor('answer_release'))).toBe('in_progress')
  expect(normalizeStatus(rawStatusFor('request_changes', 'punch up copy'))).toBe('changes_requested')
})
