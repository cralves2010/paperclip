import type { CanonicalStatus, CompanyRollup, Task } from './model.js'

/**
 * Map a free-text status cell into the fixed canonical vocabulary.
 * Priority-ordered: FIRST match wins. Order is load-bearing:
 *  - specific "awaiting/approve/deliver" beats "waiting on <entity>" (blocked)
 *    so "waiting on client to approve delivery" -> delivered_awaiting;
 *  - bare "Waiting" is checked AFTER blocked so "blocked — waiting on legal"
 *    stays blocked, while a lone "Waiting" -> delivered_awaiting.
 * Real live values seen: In Progress, Not Started, Blocked, Waiting, Done.
 */
export function normalizeStatus(raw: string): CanonicalStatus {
  const s = (raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!·]+$/, '')

  if (/\bchang|\brevis|rework/.test(s)) return 'changes_requested'
  if (/await|for review|in review|review needed|pending approval|to approve|for approval|needs sign|ready for (derek|review)|delivered/.test(s))
    return 'delivered_awaiting'
  // A gate on Derek's own side (Derek/Jason/Eric) is "Needs you" on HIS
  // cockpit, not an external block — must beat the generic block/waiting
  // matchers below ("Blocked — waiting on Derek", "Waiting on Jason").
  if (/\b(derek|jason|eric)\b/.test(s)) return 'needs_you'
  if (/\bblock|stuck|waiting on (legal|client|vendor|3rd|api|access|credential|attorney|carrier)|dependency/.test(s))
    return 'blocked'
  if (/need.*(input|decision|you|direction|answer)|your call|question for/.test(s)) return 'needs_you'
  if (/\bdone\b|complete|approved|shipped|closed|published/.test(s)) return 'done'
  if (/\bwaiting\b/.test(s)) return 'delivered_awaiting'
  if (/not started|backlog|queued|todo|planned/.test(s)) return 'queued'
  if (/in progress|wip|working|drafting|building|underway/.test(s)) return 'in_progress'
  return 'in_progress' // fallback (caller may flag for the Claudio-only tuning log)
}

export function companyHealth(tasks: Task[]): CompanyRollup['health'] {
  if (tasks.some((t) => t.status === 'blocked' || t.status === 'needs_you')) return 'blocked'
  if (tasks.some((t) => t.status === 'delivered_awaiting' || t.status === 'changes_requested'))
    return 'at_risk'
  return 'on_track'
}

export function rollupCounts(tasks: Task[]): CompanyRollup['counts'] {
  return {
    inProgress: tasks.filter((t) => t.status === 'in_progress' || t.status === 'queued').length,
    awaiting: tasks.filter((t) => t.status === 'delivered_awaiting' || t.status === 'needs_you').length,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
  }
}
