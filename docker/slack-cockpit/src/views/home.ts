import {
  actions,
  button,
  context,
  divider,
  header,
  section,
  type Block,
  type HomeView,
} from '../blocks.js'
import {
  NEEDS_YOU_STATUSES,
  STATUS_EMOJI,
  STATUS_LABEL,
  type Task,
  type ViewState,
} from '../model.js'
import { companyHealth, rollupCounts } from '../normalize.js'
import { clamp, countLine } from '../text.js'

const HEALTH_DOT = { on_track: '🟢', at_risk: '🟡', blocked: '🔴' } as const
const HEALTH_WORD = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' } as const
const NEEDS_ORDER: Record<string, number> = { needs_you: 0, changes_requested: 1, delivered_awaiting: 2 }

export interface HomeOpts {
  demo?: boolean
  syncedAt?: string
  commentCounts?: Map<string, number>
}

function needsYouRow(t: Task, counts?: Map<string, number>): Block {
  const n = counts?.get(t.taskNum) ?? 0
  const badge = n > 0 ? ` · 💬 ${n}` : ''
  return section(
    `*${clamp(t.title, 200)}*\n\`${t.company}\` · ${STATUS_EMOJI[t.status]} ${STATUS_LABEL[t.status]}${badge}`,
    button('Open', `open_task:${t.taskNum}`, { primary: true }),
  )
}

export function buildHomeView(tasks: Task[], _state: ViewState, opts: HomeOpts = {}): HomeView {
  const companies = [...new Set(tasks.map((t) => t.company))].sort()
  const needsYou = tasks
    .filter((t) => NEEDS_YOU_STATUSES.includes(t.status))
    .sort((a, b) => (NEEDS_ORDER[a.status] ?? 9) - (NEEDS_ORDER[b.status] ?? 9))

  const provenance = opts.demo
    ? '🧪 *DEMO FIXTURE* · sample JRS+Brightly data (not live)'
    : `🟢 *LIVE* · synced ${opts.syncedAt ?? 'just now'} · from M42 Central Task Tracker`

  const blocks: Block[] = [
    header('Agent M42 · Portfolio Cockpit'),
    context(`${provenance} · Legend: 🟢 On track · 🟡 At risk · 🔴 Blocked`),
    actions([
      button('🔄 Refresh', 'refresh_home'),
      button('📋 All tasks', 'open_board'),
      button('🔍 Search', 'open_search'),
      button('➕ New task', 'open_create_task'),
    ]),
    divider(),
    header('🔔 Needs You'),
  ]

  if (needsYou.length === 0) {
    blocks.push(section('🎉 *Nothing needs you right now.*'))
    blocks.push(context("Everything's in progress or done — check Portfolio Health below."))
  } else {
    for (const t of needsYou.slice(0, 5)) blocks.push(needsYouRow(t, opts.commentCounts))
    blocks.push(context(`Showing ${Math.min(needsYou.length, 5)} of ${needsYou.length}`))
  }

  blocks.push(divider(), header('📊 Portfolio Health'))
  for (const company of companies) {
    const ct = tasks.filter((t) => t.company === company)
    const health = companyHealth(ct)
    blocks.push(
      section(`${HEALTH_DOT[health]} *${company}* · ${HEALTH_WORD[health]}`, button('View →', `open_company:${company}`)),
      context(countLine(rollupCounts(ct))),
    )
  }

  blocks.push(
    divider(),
    context('Cockpit v1 · comment on any task · ➕ create tasks · filters & search — data: M42 Central Task Tracker'),
  )
  return { type: 'home', blocks }
}

/** Shown when the tracker can't be loaded, so the Home is never a silent blank. */
export function buildErrorView(message = "Couldn't load the tracker right now"): HomeView {
  return {
    type: 'home',
    blocks: [
      header('Agent M42 · Portfolio Cockpit'),
      section(`⚠️ *${message}.*\nThe Google Sheet connection may need attention (auth or sharing).`),
      actions([button('🔄 Retry', 'refresh_home')]),
      context('If this persists, ping Claudio.'),
    ],
  }
}
