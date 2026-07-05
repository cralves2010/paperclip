// Viewer-aware "what does this mean / what's being asked of me" layer for the
// task modal. NO fact invention: every derived phrase is a structural
// restatement of (status) + (whose move it is per Derek's Owner-next column).
// The task's own specifics (description, dependency) stay verbatim in
// blockquotes elsewhere in the modal.

import type { Config } from '../config.js'
import type { CanonicalStatus, Task } from '../model.js'
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

/** Plain-English gloss of each status — the "Where it stands" caption. */
export const STATUS_EXPLAINER: Record<CanonicalStatus, string> = {
  queued: 'Not started yet; it’s in the queue.',
  in_progress: 'The team is actively working on it.',
  delivered_awaiting: 'Delivered and waiting for review/approval.',
  needs_you: 'A person needs to weigh in before it can move.',
  changes_requested: 'A review asked for changes; it’s being revised.',
  blocked: 'Held up by an outside dependency.',
  done: 'Completed.',
}

export interface Ask {
  label: string
  body: string
}

/**
 * The hero "what's being asked of you" line, framed for the viewer. `yours` is
 * true only when the viewer IS the actor whose move it is next.
 */
export function deriveAsk(task: Task, viewer: ViewerActor): Ask {
  const next = normalizeActor(task.ownerNext)
  const yours =
    (viewer === 'derek' && next === 'derek') || (viewer === 'claudio' && next === 'claudio')
  const otherName = next === 'derek' ? 'Derek' : next === 'claudio' ? 'Claudio' : 'the team'

  switch (task.status) {
    case 'done':
      return { label: '✅ Nothing needed from you', body: 'This task is done.' }
    case 'queued':
      return yours
        ? { label: '⏳ Coming to you', body: 'It’s queued and hasn’t started; the first move will be yours.' }
        : { label: '✅ Nothing needed from you', body: 'Queued — not started yet.' }
    case 'in_progress':
      return yours
        ? { label: '⏳ Coming back to you', body: 'The team is working it; the next step will return to you.' }
        : { label: '✅ Nothing needed from you', body: 'In progress — the team has it.' }
    case 'delivered_awaiting':
      return yours
        ? { label: '🟡 Your move', body: 'Review what was delivered and approve it, or ask for changes.' }
        : {
            label: `⏳ Waiting on ${otherName}`,
            body: `Delivered — waiting on ${otherName} to review. Nothing needed from you yet.`,
          }
    case 'needs_you':
      return yours
        ? { label: '🟠 Your move', body: 'A decision or input is needed from you to unblock this.' }
        : {
            label: `⏳ Waiting on ${otherName}`,
            body: `Waiting on ${otherName} to weigh in. Nothing needed from you right now.`,
          }
    case 'changes_requested':
      return yours
        ? { label: '🟣 Your move', body: 'Changes were requested — take a look and revise.' }
        : {
            label: `⏳ Waiting on ${otherName}`,
            body: `Changes were requested — ${otherName} is revising.`,
          }
    case 'blocked':
      return yours
        ? { label: '🔴 Your move', body: 'Blocked, and the next step is yours to clear.' }
        : {
            label: '🔴 Blocked (not on you)',
            body: 'Held by an outside dependency — nothing to do until it clears.',
          }
  }
}
