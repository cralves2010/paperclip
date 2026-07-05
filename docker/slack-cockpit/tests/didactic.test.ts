import { describe, expect, test } from 'vitest'
import {
  DEREK_USER_ID,
  deriveAsk,
  resolveViewer,
  STATUS_EXPLAINER,
  type Ask,
  type ViewerActor,
} from '../src/views/didactic.js'
import type { CanonicalStatus, Task } from '../src/model.js'
import type { Config } from '../src/config.js'

const CLAUDIO_ID = 'U08C8QTNBJ9'
const cfg = { notifyUserId: CLAUDIO_ID } as Config

const task = (o: Partial<Task>): Task => ({
  taskNum: '1',
  company: 'JRS',
  title: 'x',
  owner: 'a',
  status: 'in_progress',
  rawStatus: '',
  ...o,
})

const ALL_STATUSES: CanonicalStatus[] = [
  'queued',
  'in_progress',
  'delivered_awaiting',
  'needs_you',
  'changes_requested',
  'blocked',
  'done',
]

// The full brief table, restated as data so the test fails loudly on any drift.
const YOURS: Record<CanonicalStatus, Ask> = {
  done: { label: '✅ Nothing needed from you', body: 'This task is done.' },
  queued: { label: '⏳ Coming to you', body: 'It’s queued and hasn’t started; the first move will be yours.' },
  in_progress: { label: '⏳ Coming back to you', body: 'The team is working it; the next step will return to you.' },
  delivered_awaiting: { label: '🟡 Your move', body: 'Review what was delivered and approve it, or ask for changes.' },
  needs_you: { label: '🟠 Your move', body: 'A decision or input is needed from you to unblock this.' },
  changes_requested: { label: '🟣 Your move', body: 'Changes were requested — take a look and revise.' },
  blocked: { label: '🔴 Your move', body: 'Blocked, and the next step is yours to clear.' },
}

const OTHER = (n: string): Record<CanonicalStatus, Ask> => ({
  done: { label: '✅ Nothing needed from you', body: 'This task is done.' },
  queued: { label: '✅ Nothing needed from you', body: 'Queued — not started yet.' },
  in_progress: { label: '✅ Nothing needed from you', body: 'In progress — the team has it.' },
  delivered_awaiting: {
    label: `⏳ Waiting on ${n}`,
    body: `Delivered — waiting on ${n} to review. Nothing needed from you yet.`,
  },
  needs_you: {
    label: `⏳ Waiting on ${n}`,
    body: `Waiting on ${n} to weigh in. Nothing needed from you right now.`,
  },
  changes_requested: { label: `⏳ Waiting on ${n}`, body: `Changes were requested — ${n} is revising.` },
  blocked: {
    label: '🔴 Blocked (not on you)',
    body: 'Held by an outside dependency — nothing to do until it clears.',
  },
})

describe('deriveAsk — 7 statuses × {viewer-is-next, viewer-is-other, observer}', () => {
  for (const status of ALL_STATUSES) {
    test(`${status}: viewer IS the actor whose move it is (Derek + Claudio sides)`, () => {
      expect(deriveAsk(task({ status, ownerNext: 'Derek' }), 'derek')).toEqual(YOURS[status])
      expect(deriveAsk(task({ status, ownerNext: 'Claudio' }), 'claudio')).toEqual(YOURS[status])
    })

    test(`${status}: viewer is the OTHER person (waiting on the named actor)`, () => {
      // Next is Derek, viewer is Claudio -> not yours, otherName "Derek".
      expect(deriveAsk(task({ status, ownerNext: 'Derek' }), 'claudio')).toEqual(OTHER('Derek')[status])
    })

    test(`${status}: observer is never "yours" (resolves the real next actor + team)`, () => {
      expect(deriveAsk(task({ status, ownerNext: 'Claudio' }), 'observer')).toEqual(OTHER('Claudio')[status])
      // Empty Owner-next -> "the team".
      expect(deriveAsk(task({ status, ownerNext: '' }), 'observer')).toEqual(OTHER('the team')[status])
    })
  }

  test('done ignores whose move it is (always "nothing needed")', () => {
    expect(deriveAsk(task({ status: 'done', ownerNext: 'Derek' }), 'derek')).toEqual(YOURS.done)
    expect(deriveAsk(task({ status: 'done', ownerNext: '' }), 'observer')).toEqual(YOURS.done)
  })
})

describe('STATUS_EXPLAINER', () => {
  test('is exhaustive: one non-empty gloss per canonical status, no extras', () => {
    for (const s of ALL_STATUSES) expect(STATUS_EXPLAINER[s]).toBeTruthy()
    expect(Object.keys(STATUS_EXPLAINER).sort()).toEqual([...ALL_STATUSES].sort())
  })
})

describe('resolveViewer', () => {
  test('Derek id -> derek', () => {
    expect(resolveViewer(DEREK_USER_ID, cfg)).toBe<ViewerActor>('derek')
  })
  test('Claudio (notifyUserId) -> claudio', () => {
    expect(resolveViewer(CLAUDIO_ID, cfg)).toBe<ViewerActor>('claudio')
  })
  test('anyone else -> observer; a non-Claudio id is NEVER claudio', () => {
    expect(resolveViewer('U_RANDOM_123', cfg)).toBe<ViewerActor>('observer')
    expect(resolveViewer(DEREK_USER_ID, cfg)).not.toBe('claudio')
    expect(resolveViewer('U_RANDOM_123', cfg)).not.toBe('claudio')
  })
})
