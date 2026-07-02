import {
  actions,
  button,
  context,
  divider,
  header,
  section,
  staticSelect,
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
import { countLine } from '../text.js'

const HEALTH_DOT = { on_track: '🟢', at_risk: '🟡', blocked: '🔴' } as const
const HEALTH_WORD = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' } as const
const NEEDS_ORDER: Record<string, number> = { needs_you: 0, changes_requested: 1, delivered_awaiting: 2 }

function needsYouRow(t: Task): Block {
  return section(
    `*${t.title}*\n\`${t.company}\` · ${STATUS_EMOJI[t.status]} ${STATUS_LABEL[t.status]}`,
    button('Open', `open_task:${t.taskNum}`, { primary: true }),
  )
}

export function buildHomeView(tasks: Task[], _state: ViewState): HomeView {
  const companies = [...new Set(tasks.map((t) => t.company))].sort()
  const needsYou = tasks
    .filter((t) => NEEDS_YOU_STATUSES.includes(t.status))
    .sort((a, b) => (NEEDS_ORDER[a.status] ?? 9) - (NEEDS_ORDER[b.status] ?? 9))

  const blocks: Block[] = [
    header('Agent M42 · Portfolio Cockpit'),
    context('🔄 Synced from *M42 Central Task Tracker* · Legend: 🟢 On track · 🟡 At risk · 🔴 Blocked'),
    actions([
      button('🔄 Refresh', 'refresh_home'),
      staticSelect('Company: All', 'filter_company', [
        { text: 'All companies', value: 'all' },
        ...companies.map((c) => ({ text: c, value: c })),
      ]),
      staticSelect('Sort: Recent', 'sort', [
        { text: 'Most recent', value: 'recent' },
        { text: 'Status', value: 'status' },
        { text: 'Title', value: 'title' },
      ]),
      button('🔍 Search', 'open_search'),
    ]),
    divider(),
    header('🔔 Needs You'),
  ]

  if (needsYou.length === 0) {
    blocks.push(section('🎉 *Nothing needs you right now.*'))
    blocks.push(context("Everything's in progress or done — check Portfolio Health below."))
  } else {
    for (const t of needsYou.slice(0, 5)) blocks.push(needsYouRow(t))
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
    context('Read-only cockpit (v0) · Actions (approve · request changes · comment) coming in v1 · Data: M42 Central Task Tracker'),
  )
  return { type: 'home', blocks }
}
