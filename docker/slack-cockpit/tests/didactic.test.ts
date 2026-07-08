import { describe, expect, test } from 'vitest'
import { DEREK_USER_ID, deriveActionLine, resolveViewer, type ViewerActor } from '../src/views/didactic.js'
import { STATUS_EMOJI, type CanonicalStatus, type Task } from '../src/model.js'
import { verdictsFor } from '../src/verdicts.js'
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
const LINK = 'https://docs.google.com/x' // a deliverable link → delivered_awaiting carries buttons

const ALL_STATUSES: CanonicalStatus[] = [
  'queued',
  'in_progress',
  'delivered_awaiting',
  'needs_you',
  'changes_requested',
  'blocked',
  'done',
]

// Same shape as the SUT's line(): the expected copy is pinned by (lead, body[, prefix]).
const L = (lead: string, body: string, prefix = ''): string => `${prefix}*${lead}*\n${body}`
// Faithful call: hasVerdicts is derived from the SAME verdictsFor() the modal uses,
// so these goldens exercise the exact coupling that guarantees no contradiction.
const al = (t: Task, v: ViewerActor): string => deriveActionLine(t, v, verdictsFor(t, v !== 'observer').length > 0)

describe('deriveActionLine — golden copy per status × viewer', () => {
  test('delivered_awaiting WITH link (has buttons for principals)', () => {
    const base = { status: 'delivered_awaiting' as const, deliverableDriveUrl: LINK }
    expect(al(task({ ...base, ownerNext: 'Derek' }), 'derek')).toBe(
      L('Your move.', 'Review the delivery, then approve or request changes below.'),
    )
    // THE JRS-42 CASE: Claudio viewing a Derek-owned delivered task. Ownership + capability
    // coexist in one line; the old "Nothing needed from you yet" (above live buttons) is gone.
    expect(al(task({ ...base, ownerNext: 'Derek' }), 'claudio')).toBe(
      L('Derek’s call — you can act on it.', 'Review the delivery, then approve or request changes below.'),
    )
    expect(al(task({ ...base, ownerNext: '' }), 'derek')).toBe(
      L('Your call — either principal can take it.', 'Review the delivery, then approve or request changes below.'),
    )
    expect(al(task({ ...base, ownerNext: 'Derek' }), 'observer')).toBe(
      L('Waiting on Derek.', 'Delivered — Derek needs to review and approve or request changes. You’re read-only; comment if you have input.'),
    )
  })

  test('delivered_awaiting LINKLESS (defect — no buttons, ownership still named)', () => {
    const base = { status: 'delivered_awaiting' as const } // no link
    expect(al(task({ ...base, ownerNext: 'Derek' }), 'claudio')).toBe(
      L('Delivered, but no link is attached.', 'Nothing to review yet — it’s Derek’s to review once the team adds the deliverable link. Approvals stay disabled until then.', '⚠️ '),
    )
    expect(al(task({ ...base, ownerNext: 'Derek' }), 'observer')).toBe(
      L('Delivered, but no link is attached.', 'Nothing to review yet — waiting on the team to add the deliverable link. You’re read-only.', '⚠️ '),
    )
  })

  test('needs_you', () => {
    expect(al(task({ status: 'needs_you', ownerNext: 'Derek' }), 'derek')).toBe(L('Your move.', 'Mark it done, or answer & release below.'))
    expect(al(task({ status: 'needs_you', ownerNext: 'Derek' }), 'claudio')).toBe(L('Derek’s call — you can act on it.', 'Mark it done, or answer & release below.'))
    expect(al(task({ status: 'needs_you', ownerNext: 'Derek' }), 'observer')).toBe(L('Waiting on Derek.', 'Derek needs to weigh in before this can move. You’re read-only; comment if you can help.'))
  })

  test('blocked', () => {
    expect(al(task({ status: 'blocked', ownerNext: 'Derek' }), 'derek')).toBe(L('Your move.', 'Answer & release below to clear it.'))
    expect(al(task({ status: 'blocked', ownerNext: 'Derek' }), 'claudio')).toBe(L('Derek’s to clear — you can act on it.', 'Answer & release below to clear it.'))
    expect(al(task({ status: 'blocked', ownerNext: '' }), 'derek')).toBe(L('Yours to clear — either principal can take it.', 'Answer & release below to clear it.'))
    expect(al(task({ status: 'blocked', ownerNext: 'Derek' }), 'observer')).toBe(L('Held up.', 'Held by an outside dependency, on Derek to clear. You’re read-only.'))
  })

  test('changes_requested (no buttons for anyone — team is the mover)', () => {
    expect(al(task({ status: 'changes_requested', ownerNext: 'Derek' }), 'claudio')).toBe(L('With the team.', 'Changes were requested — the team is revising. It comes back to a principal when it’s re-delivered.'))
    expect(al(task({ status: 'changes_requested', ownerNext: 'Derek' }), 'observer')).toBe(L('With the team.', 'Changes were requested — the team is revising. You’re read-only; comment if you have input.'))
  })

  test('queued', () => {
    expect(al(task({ status: 'queued', ownerNext: 'Derek' }), 'derek')).toBe(L('Coming to you.', 'Not started yet; the first move will be yours. Nothing to do until it starts.'))
    expect(al(task({ status: 'queued', ownerNext: 'Derek' }), 'claudio')).toBe(L('Not started.', 'Queued — the first move is Derek’s. Nothing needed from either principal yet.'))
    expect(al(task({ status: 'queued', ownerNext: 'Derek' }), 'observer')).toBe(L('Not started.', 'Queued — not started yet. You’re read-only.'))
  })

  test('in_progress', () => {
    expect(al(task({ status: 'in_progress', ownerNext: 'Claudio' }), 'claudio')).toBe(L('Coming back to you.', 'The team is working it; the next step returns to you. Nothing to do yet.'))
    expect(al(task({ status: 'in_progress', ownerNext: 'Derek' }), 'claudio')).toBe(L('With the team.', 'The team is working it; it returns to a principal when there’s something to review. Nothing needed from either principal yet.'))
    expect(al(task({ status: 'in_progress', ownerNext: 'Derek' }), 'observer')).toBe(L('With the team.', 'The team is working it. You’re read-only.'))
  })

  test('done', () => {
    expect(al(task({ status: 'done', ownerNext: 'Derek' }), 'derek')).toBe(L('Complete.', 'Reopen below if something needs to change.'))
    expect(al(task({ status: 'done', ownerNext: 'Derek' }), 'observer')).toBe(L('Complete.', 'This task is complete. You’re read-only.'))
  })
})

describe('deriveActionLine — the anti-contradiction invariant (permanent JRS-42 guard)', () => {
  const viewers: ViewerActor[] = ['derek', 'claudio', 'observer']
  test('hasVerdicts ⇒ points at the buttons ("below") and NEVER says "nothing"; no buttons ⇒ no action affordance', () => {
    for (const status of ALL_STATUSES) {
      for (const viewer of viewers) {
        for (const withLink of [true, false]) {
          for (const ownerNext of ['Derek', 'Claudio', '']) {
            const t = task({ status, ownerNext, ...(withLink ? { deliverableDriveUrl: LINK } : {}) })
            const hv = verdictsFor(t, viewer !== 'observer').length > 0
            const out = deriveActionLine(t, viewer, hv)
            if (hv) {
              expect(out, `${status}/${viewer}/link=${withLink}/${ownerNext} must point at buttons`).toMatch(/below/)
              expect(out, `${status}/${viewer}/link=${withLink}/${ownerNext} must not say "nothing" above buttons`).not.toMatch(/nothing/i)
            } else {
              expect(out, `${status}/${viewer}/link=${withLink}/${ownerNext} must carry no affordance`).not.toMatch(/\bbelow\b/)
            }
          }
        }
      }
    }
  })
})

describe('deriveActionLine — status stated ONCE (never re-chipped in the action line)', () => {
  // The status EMOJI is the chip; it must live only in the kicker. Status WORDS
  // ("Queued", "Complete") may appear in natural-language prose — that is not a chip.
  test('never contains a status emoji, for every status × viewer × link', () => {
    const viewers: ViewerActor[] = ['derek', 'claudio', 'observer']
    for (const status of ALL_STATUSES) {
      for (const viewer of viewers) {
        for (const withLink of [true, false]) {
          const t = task({ status, ownerNext: 'Derek', ...(withLink ? { deliverableDriveUrl: LINK } : {}) })
          const out = deriveActionLine(t, viewer, verdictsFor(t, viewer !== 'observer').length > 0)
          expect(out, `${status}/${viewer}/link=${withLink}`).not.toContain(STATUS_EMOJI[status])
        }
      }
    }
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
