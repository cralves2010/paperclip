// Domain types for the Agent M42 Slack cockpit.

export type CanonicalStatus =
  | 'queued'
  | 'in_progress'
  | 'delivered_awaiting'
  | 'needs_you'
  | 'changes_requested'
  | 'blocked'
  | 'done'

/** The ONLY status strings ever shown to a human (English, fork rule). */
export const STATUS_LABEL: Record<CanonicalStatus, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  delivered_awaiting: 'Delivered – awaiting you',
  needs_you: 'Needs you',
  changes_requested: 'Changes requested',
  blocked: 'Blocked',
  done: 'Done',
}

/** Redundant, colorblind-safe second channel — never the only cue. */
export const STATUS_EMOJI: Record<CanonicalStatus, string> = {
  queued: '⚪',
  in_progress: '🔵',
  delivered_awaiting: '🟡',
  needs_you: '🟠',
  changes_requested: '🟣',
  blocked: '🔴',
  done: '🟢',
}

/** Statuses that require the human viewer to act (pinned "Needs You"). */
export const NEEDS_YOU_STATUSES: CanonicalStatus[] = [
  'needs_you',
  'changes_requested',
  'delivered_awaiting',
]

export interface Task {
  taskNum: string
  company: string
  title: string
  owner: string
  status: CanonicalStatus
  rawStatus: string
  priority?: string
  deliverableTitle?: string
  deliverableDriveUrl?: string
  deliverableSlackUrl?: string
  deliverableOtherUrl?: string
  description?: string
  dependency?: string
  lastUpdated?: string
  lastUpdatedTs?: number
}

/** A comment on a task, stored in the Sheet's "Comments" tab (A–E schema). */
export interface Comment {
  timestamp: string
  taskNum: string
  author: string
  text: string
  seen: string
}

export interface CompanyRollup {
  company: string
  health: 'on_track' | 'at_risk' | 'blocked'
  counts: { inProgress: number; awaiting: number; blocked: number }
}

export type StatusFilter = CanonicalStatus | 'all' | 'open'
export type BoardSort = 'updated' | 'priority' | 'task_num'

export interface BoardFilters {
  business?: string
  status?: StatusFilter
  priority?: string
}

export type ViewState =
  | { kind: 'portfolio' }
  | { kind: 'board'; filters: BoardFilters; sort: BoardSort; page: number }
  | { kind: 'search'; query: string; page: number }
