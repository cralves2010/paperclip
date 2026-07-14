// The flat, Linear-like board: filter selects + sort menu + one-block cards +
// pagination. Card details hide behind an overflow menu to preserve exactly one
// block per card (App Home ~100-block ceiling). Also exports taskCardRow, which
// the search results view reuses.

import {
  actions,
  button,
  context,
  divider,
  header,
  overflow,
  section,
  staticSelect,
  type Block,
  type HomeView,
} from '../blocks.js'
import {
  STATUS_EMOJI,
  STATUS_LABEL,
  isDeliveredWithoutLink,
  type BoardSort,
  type StatusFilter,
  type Task,
  type ViewState,
} from '../model.js'
import {
  distinctBusinesses,
  distinctPriorities,
  filterTasks,
  paginate,
  sortTasks,
  type Page,
} from '../filters.js'
import { clamp, liveProvenance, taskRef } from '../text.js'

export interface BoardOpts {
  demo?: boolean
  commentCounts?: Map<string, number>
  /** All tasks (unfiltered) so the filter selects can offer every option. */
  allTasks?: Task[]
  /** Epoch ms of the last successful tracker sync — drives the freshness dot. */
  syncedAtMs?: number
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number
}

const STATUS_ORDER: StatusFilter[] = [
  'needs_you',
  'delivered_awaiting',
  'changes_requested',
  'in_progress',
  'blocked',
  'queued',
  'done',
]

const SORT_LABEL: Record<BoardSort, string> = {
  updated: 'Last updated',
  priority: 'Priority',
  task_num: 'Task #',
}

function deliverableUrl(t: Task): string | undefined {
  return t.deliverableDriveUrl || t.deliverableSlackUrl || t.deliverableOtherUrl
}

/** EXACTLY ONE section block per card, with an overflow accessory. */
export function taskCardRow(t: Task, opts: BoardOpts = {}): Block {
  const count = opts.commentCounts?.get(t.taskNum) ?? 0
  const url = deliverableUrl(t)
  const parts = [
    `\`${taskRef(t)}\``,
    `${STATUS_EMOJI[t.status]} ${STATUS_LABEL[t.status]}`,
  ]
  if (count > 0) parts.push(`💬 ${count}`)
  if (url) parts.push('📎')
  else if (isDeliveredWithoutLink(t)) parts.push('⚠️ no link')
  if (t.lastUpdated) parts.push(`⏱ ${t.lastUpdated}`)
  const meta = parts.join(' · ')

  const options: { text: string; value: string; url?: string }[] = [
    { text: '🔍 Open details', value: `open:${t.taskNum}` },
    { text: '💬 Comment', value: `comment:${t.taskNum}` },
  ]
  if (url) options.push({ text: '📎 Open deliverable', value: `deliverable:${t.taskNum}`, url })

  return section(`*${clamp(t.title, 200)}*\n${meta}`, overflow(`card_menu:${t.taskNum}`, options))
}

function pager(page: Page<Task>): Block[] {
  const controls: Block[] = []
  if (page.page > 0) controls.push(button('◀ Prev', 'page_prev'))
  if (page.page < page.pageCount - 1) controls.push(button('Next ▶', 'page_next'))
  const line = context(`Page ${page.page + 1} of ${page.pageCount} · showing ${page.from}–${page.to} of ${page.total}`)
  return controls.length > 0 ? [line, actions(controls)] : [line]
}

/** Shared pager used by the board and search results. */
export function buildPager(page: Page<Task>): Block[] {
  return pager(page)
}

export function buildBoardView(tasks: Task[], state: Extract<ViewState, { kind: 'board' }>, opts: BoardOpts = {}): HomeView {
  const source = opts.allTasks ?? tasks
  const filtered = filterTasks(tasks, state.filters)
  const sorted = sortTasks(filtered, state.sort)
  const page = paginate(sorted, state.page)

  const provenance = opts.demo
    ? '🧪 DEMO FIXTURE · sample data (not live)'
    : liveProvenance(opts.syncedAtMs, opts.now)

  const bizOptions = [{ text: 'All businesses', value: '__all__' }, ...distinctBusinesses(source).map((b) => ({ text: b, value: b }))]
  const statusOptions = [
    { text: 'All statuses', value: 'all' },
    { text: 'Open (hide Done)', value: 'open' },
    ...STATUS_ORDER.map((s) => ({ text: STATUS_LABEL[s as Exclude<StatusFilter, 'all' | 'open'>], value: s })),
  ]
  const prioOptions = [{ text: 'All priorities', value: '__all__' }, ...distinctPriorities(source).map((p) => ({ text: p, value: p }))]
  const sortOptions = (Object.keys(SORT_LABEL) as BoardSort[]).map((s) => ({ text: `Sort: ${SORT_LABEL[s]}`, value: s }))

  const blocks: Block[] = [
    header('📋 All tasks'),
    context(provenance),
    actions([
      button('← Portfolio', 'back_to_home'),
      staticSelect('Business: All', 'filter_business', bizOptions, state.filters.business ?? '__all__'),
      staticSelect('Status: All', 'filter_status', statusOptions, state.filters.status ?? 'all'),
      staticSelect('Priority: All', 'filter_priority', prioOptions, state.filters.priority ?? '__all__'),
    ]),
    actions([
      staticSelect(`Sort: ${SORT_LABEL[state.sort]}`, 'sort_by', sortOptions, state.sort),
      button('🔍 Search', 'open_search'),
      button('➕ New task', 'open_create_task'),
      button('🔄 Refresh', 'refresh_home'),
    ]),
    context(`${page.total} task${page.total === 1 ? '' : 's'} match`),
    divider(),
  ]

  if (page.total === 0) {
    blocks.push(section('_No tasks match these filters._'))
    blocks.push(actions([button('Clear filters', 'clear_filters')]))
  } else {
    for (const t of page.slice) blocks.push(taskCardRow(t, opts))
    blocks.push(...pager(page))
  }

  blocks.push(divider(), context('Cockpit v1 · overflow menu on each card · ➕ create · filters & search'))
  return { type: 'home', blocks }
}
