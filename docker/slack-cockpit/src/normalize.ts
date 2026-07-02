import type { CanonicalStatus, CompanyRollup, Task } from './model.js'

/**
 * Map a free-text working-status cell into the fixed canonical vocabulary.
 * Priority-ordered: FIRST match wins. Order matters — "waiting on client to
 * approve delivery" must resolve to delivered_awaiting (it is awaiting the
 * human), NOT blocked, so the awaiting/approval check runs before the
 * "waiting on <entity>" blocked check.
 */
export function normalizeStatus(raw: string): CanonicalStatus {
  const s = (raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!·]+$/, '')

  if (/chang|revis|rework/.test(s)) return 'changes_requested'
  if (/(await|for review|review needed|pending approval|to approve|for approval|needs sign|ready for (derek|review)|delivered)/.test(s))
    return 'delivered_awaiting'
  if (/block|stuck|waiting on (legal|client|vendor|3rd|api|access|credential|attorney)|dependency/.test(s))
    return 'blocked'
  if (/need.*(input|decision|you|direction|answer)|your call|question for/.test(s)) return 'needs_you'
  if (/(done|complete|approved|shipped|closed|published)/.test(s)) return 'done'
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
