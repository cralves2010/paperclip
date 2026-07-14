// Viewer-aware "what's being asked of me" layer for the task modal. NO fact
// invention: every derived phrase is a structural restatement of (status) +
// (whose move it is per Derek's Owner-next column) + (whether the viewer has
// verdict buttons). The task's own specifics (description, dependency) stay
// verbatim in blockquotes elsewhere in the modal.

import type { Config } from '../config.js'
import { isDeliveredWithoutLink, type CanonicalStatus, type Task } from '../model.js'
import { normalizeActor } from '../normalize.js'

/** Derek's Slack user id — the one viewer whose "your move" differs from Claudio's. */
export const DEREK_USER_ID = 'U08APFXGJ4U'

/** Who is looking at the modal (drives the "is this on ME?" framing). */
export type ViewerActor = 'derek' | 'claudio' | 'observer'

/**
 * Resolve the viewing user to an actor. Derek + Claudio get first-person
 * framing; everyone else is an 'observer' (neutral third-person copy).
 */
export function resolveViewer(userId: string, cfg: Config): ViewerActor {
  if (userId === DEREK_USER_ID) return 'derek'
  if (userId === cfg.notifyUserId) return 'claudio'
  return 'observer'
}

/** Verb clause for the states that carry buttons — always ends in "below" so it
 * points straight at the verdict row rendered beneath it. */
const ACTION_BODY: Partial<Record<CanonicalStatus, string>> = {
  delivered_awaiting: 'Review the delivery, then approve or request changes below.',
  needs_you: 'Mark it done, or answer & release below.',
  blocked: 'Answer & release below to clear it.',
}

const line = (lead: string, body: string, prefix = ''): string => `${prefix}*${lead}*\n${body}`

/**
 * The single "what's being asked of YOU" line (old hero + "Where it stands"
 * merged into one — status itself is stated once, in the kicker above).
 *
 * INVARIANT — the anti-contradiction guarantee (the JRS-42 fix):
 *   hasVerdicts === true  → the line ends in an action clause ("below") and NEVER says "nothing".
 *   hasVerdicts === false → the line carries no action affordance ("below").
 * `hasVerdicts` is passed in by the caller from the SAME verdictsFor() call that
 * renders the buttons, so prose and buttons can never disagree. Ownership ("whose
 * call") and capability ("you can act") are separate clauses that coexist without
 * contradiction — the exact defect the old deriveAsk exposed for Claudio on a
 * Derek-owned delivered task.
 */
export function deriveActionLine(task: Task, viewer: ViewerActor, hasVerdicts: boolean): string {
  const owner = normalizeActor(task.ownerNext)
  const isPrincipal = viewer === 'derek' || viewer === 'claudio'
  const viewerIsOwner =
    (viewer === 'derek' && owner === 'derek') || (viewer === 'claudio' && owner === 'claudio')
  const ownerName = owner === 'derek' ? 'Derek' : owner === 'claudio' ? 'Claudio' : 'the team'

  // ── BUTTON CASE: must point at the buttons, must never say "nothing". ──
  if (hasVerdicts) {
    if (task.status === 'done') return line('Complete.', 'Reopen below if something needs to change.')
    const body = ACTION_BODY[task.status] ?? 'Act below.'
    const lead = viewerIsOwner
      ? 'Your move.'
      : owner === 'team'
        ? task.status === 'blocked'
          ? 'Yours to clear — either principal can take it.'
          : 'Your call — either principal can take it.'
        : task.status === 'blocked'
          ? `${ownerName}’s to clear — you can act on it.`
          : `${ownerName}’s call — you can act on it.`
    return line(lead, body)
  }

  // ── NO-BUTTON CASE: never an action affordance ("below"). ──
  if (isDeliveredWithoutLink(task)) {
    if (!isPrincipal)
      return line(
        'Delivered, but no link is attached.',
        'Nothing to review yet — waiting on the team to add the deliverable link. You’re read-only.',
        '⚠️ ',
      )
    const who = viewerIsOwner ? 'yours to review' : owner === 'team' ? 'a principal to review' : `${ownerName}’s to review`
    return line(
      'Delivered, but no link is attached.',
      `Nothing to review yet — it’s ${who} once the team adds the deliverable link. Approvals stay disabled until then.`,
      '⚠️ ',
    )
  }

  switch (task.status) {
    case 'changes_requested':
      return isPrincipal
        ? line('With the team.', 'Changes were requested — the team is revising. It comes back to a principal when it’s re-delivered.')
        : line('With the team.', 'Changes were requested — the team is revising. You’re read-only; comment if you have input.')
    case 'queued':
      if (!isPrincipal) return line('Not started.', 'Queued — not started yet. You’re read-only.')
      return viewerIsOwner
        ? line('Coming to you.', 'Not started yet; the first move will be yours. Nothing to do until it starts.')
        : line('Not started.', `Queued — the first move is ${ownerName}’s. Nothing needed from either principal yet.`)
    case 'in_progress':
      if (!isPrincipal) return line('With the team.', 'The team is working it. You’re read-only.')
      return viewerIsOwner
        ? line('Coming back to you.', 'The team is working it; the next step returns to you. Nothing to do yet.')
        : line('With the team.', 'The team is working it; it returns to a principal when there’s something to review. Nothing needed from either principal yet.')
    case 'delivered_awaiting': // WITH link, observer only (principals took the hasVerdicts branch above)
      return line(`Waiting on ${ownerName}.`, `Delivered — ${ownerName} needs to review and approve or request changes. You’re read-only; comment if you have input.`)
    case 'needs_you':
      return line(`Waiting on ${ownerName}.`, `${ownerName} needs to weigh in before this can move. You’re read-only; comment if you can help.`)
    case 'blocked':
      return line('Held up.', `Held by an outside dependency, on ${ownerName} to clear. You’re read-only.`)
    case 'done':
      return line('Complete.', 'This task is complete. You’re read-only.')
  }
}
