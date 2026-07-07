// Derek's decision layer: the verdict buttons he can take on a task from the app
// (Approve / Request changes / Mark done / Answer & release / Reopen), and the
// pure rules for which buttons a task+viewer gets and what raw Status each writes.
//
// Kept as a pure module (no I/O) so the catalog + gating is unit-tested on
// literals. The actual write is writeStatus() in sheets-write.ts; the handlers in
// handlers.ts wire the buttons to it.

import { hasDeliverableLink, type CanonicalStatus, type Task } from './model.js'

/**
 * Raw Status strings the cockpit writes back to Derek's Sheet. Each MUST
 * normalize (normalize.ts normalizeStatus) back to the intended canonical
 * status, or the board would mislabel it. Centralized here so writers never drift.
 */
export const RAW_STATUS = {
  done: 'Done',
  inProgress: 'In Progress',
  changesRequested: (reason: string) => `Changes requested — ${reason}`,
} as const

export type VerdictId = 'approve' | 'mark_done' | 'request_changes' | 'answer_release' | 'reopen'

export interface Verdict {
  id: VerdictId
  label: string
  /** Canonical status the task MUST still be in for the write to apply (CAS precondition). */
  expect: CanonicalStatus[]
  primary?: boolean
  /** Opens a required-reason modal before writing (Request changes / Answer). */
  needsReason?: boolean
  /** Native Slack confirm copy for the direct-write buttons (mis-tap guard). */
  confirm?: { title: string; text: string; ok: string }
}

const APPROVE: Verdict = {
  id: 'approve',
  label: '✅ Approve & close',
  expect: ['delivered_awaiting'],
  primary: true,
  confirm: { title: 'Approve & close?', text: 'Marks it *Done* and lets the team wrap up. You can Reopen it anytime.', ok: 'Yes, approve' },
}
const MARK_DONE: Verdict = {
  id: 'mark_done',
  label: '✅ Mark done',
  expect: ['needs_you'],
  primary: true,
  confirm: { title: 'Mark done?', text: 'Closes this task. You can Reopen it anytime.', ok: 'Yes, mark done' },
}
const REQUEST_CHANGES: Verdict = {
  id: 'request_changes',
  label: '↩︎ Request changes',
  expect: ['delivered_awaiting'],
  needsReason: true,
}
const ANSWER_RELEASE: Verdict = {
  id: 'answer_release',
  label: '🔓 Answer & release',
  expect: ['needs_you', 'blocked'],
  needsReason: true,
}
const REOPEN: Verdict = {
  id: 'reopen',
  label: '↩︎ Reopen',
  expect: ['done'],
  confirm: { title: 'Reopen?', text: 'Sends this back to *In progress* for more work.', ok: 'Yes, reopen' },
}

export const VERDICTS: Record<VerdictId, Verdict> = {
  approve: APPROVE,
  mark_done: MARK_DONE,
  request_changes: REQUEST_CHANGES,
  answer_release: ANSWER_RELEASE,
  reopen: REOPEN,
}

/**
 * The verdict buttons a PRINCIPAL (Derek OR Claudio) gets on a task, keyed to its
 * status. Returns [] for observers (a random allowlisted viewer never gets a live
 * verdict). Both principals see the same buttons on the same tasks — Claudio is the
 * co-operator and must be able to act on, test, and evaluate the board exactly as
 * Derek does (Claudio's request 2026-07-07). Every write is still CAS-guarded,
 * confirmed, and reversible; the modal hero (deriveAsk) still names whose move it
 * is, so context stays honest even though either principal can act.
 */
export function verdictsFor(task: Task, isPrincipal: boolean): Verdict[] {
  if (!isPrincipal) return []
  switch (task.status) {
    case 'delivered_awaiting':
      // No Approve on a linkless delivery (that is the isDeliveredWithoutLink defect).
      return hasDeliverableLink(task) ? [APPROVE, REQUEST_CHANGES] : []
    case 'needs_you':
      return [MARK_DONE, ANSWER_RELEASE]
    case 'blocked':
      return [ANSWER_RELEASE]
    case 'done':
      return [REOPEN]
    default:
      return []
  }
}

/** The raw Status string a verdict writes (reason required only for the needsReason verdicts). */
export function rawStatusFor(id: VerdictId, reason?: string): string {
  switch (id) {
    case 'approve':
    case 'mark_done':
      return RAW_STATUS.done
    case 'request_changes':
      return RAW_STATUS.changesRequested((reason ?? '').trim() || 'see comment')
    case 'answer_release':
    case 'reopen':
      return RAW_STATUS.inProgress
  }
}
