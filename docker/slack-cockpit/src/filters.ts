// Pure, directly-testable filter / sort / paginate core for the flat board.
// No I/O — all functions operate on in-memory Task arrays so they can be
// asserted on literals in tests.

import type { BoardFilters, BoardSort, StatusFilter, Task } from './model.js'

/** Rows per board page. App Home caps at ~100 blocks; 1 block/card + chrome. */
export const PAGE_SIZE = 20

/** Numeric value of a Task # for stable tie-breaking (NaN sorts last). */
function taskNumRank(t: Task): number {
  const n = parseInt((t.taskNum ?? '').replace(/[^\d-]/g, ''), 10)
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n
}

/**
 * First integer found in a priority string, as a rank (lower = higher priority).
 * Handles 'P0'/'P1' AND 'Tier 1'/'Tier 2'. Undefined / no-digit ranks LAST.
 */
export function parsePriorityRank(priority?: string): number {
  if (!priority) return Number.POSITIVE_INFINITY
  const m = priority.match(/\d+/)
  return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY
}

function statusMatches(t: Task, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return t.status !== 'done'
  return t.status === filter
}

/** Filter by business (exact), status (all/open/canonical), priority (exact). */
export function filterTasks(tasks: Task[], filters: BoardFilters): Task[] {
  return tasks.filter((t) => {
    if (filters.business && t.company !== filters.business) return false
    if (filters.status && !statusMatches(t, filters.status)) return false
    if (filters.priority && (t.priority ?? '') !== filters.priority) return false
    return true
  })
}

/** Sort a COPY of the tasks by the chosen key; ties broken by numeric Task #. */
export function sortTasks(tasks: Task[], sort: BoardSort): Task[] {
  const copy = tasks.slice()
  const byTaskNum = (a: Task, b: Task): number => taskNumRank(a) - taskNumRank(b)
  copy.sort((a, b) => {
    let primary = 0
    if (sort === 'updated') {
      // Most-recent first; undefined timestamps sort LAST.
      const av = a.lastUpdatedTs ?? Number.NEGATIVE_INFINITY
      const bv = b.lastUpdatedTs ?? Number.NEGATIVE_INFINITY
      primary = bv - av
    } else if (sort === 'priority') {
      primary = parsePriorityRank(a.priority) - parsePriorityRank(b.priority)
    } else {
      // task_num
      primary = taskNumRank(a) - taskNumRank(b)
    }
    return primary !== 0 ? primary : byTaskNum(a, b)
  })
  return copy
}

export interface Page<T> {
  slice: T[]
  page: number
  pageCount: number
  from: number // 1-based index of first item on the page (0 when empty)
  to: number // 1-based index of last item on the page (0 when empty)
  total: number
}

/** Paginate with an out-of-range page clamped into [0, pageCount-1]. */
export function paginate<T>(items: T[], page: number, size: number = PAGE_SIZE): Page<T> {
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const clamped = Math.min(Math.max(page, 0), pageCount - 1)
  const start = clamped * size
  const slice = items.slice(start, start + size)
  return {
    slice,
    page: clamped,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + slice.length,
    total,
  }
}

/** Distinct, sorted business names for filter/create option derivation. */
export function distinctBusinesses(tasks: Task[]): string[] {
  return [...new Set(tasks.map((t) => t.company).filter(Boolean))].sort()
}

/** Distinct, sorted priority values for filter/create option derivation. */
export function distinctPriorities(tasks: Task[]): string[] {
  return [...new Set(tasks.map((t) => t.priority ?? '').filter(Boolean))].sort()
}
