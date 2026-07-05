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
import { companyHealth, normalizeActor, rollupCounts, type Actor } from '../normalize.js'
import { clamp, countLine } from '../text.js'

// App Home hard-caps at ~100 blocks. Budget (worst case):
//   chrome 4 + 3 actor groups × (header + 5 rows + context) = 21
//   + Portfolio divider/header 2 + 30×2 companies + overflow context 1 + footer 2
//   = 90 blocks. Overflow is summarized + reachable via the All-tasks board.
// (Was 40 companies when Needs-You was a single 7-block group; the actor split
// added up to 14 blocks, so the company cap drops to 30 to stay safely under.)
const PORTFOLIO_CAP = 30
const GROUP_CAP = 5 // max hero rows per actor group

const HEALTH_DOT = { on_track: '🟢', at_risk: '🟡', blocked: '🔴' } as const
const HEALTH_WORD = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' } as const
const NEEDS_ORDER: Record<string, number> = { needs_you: 0, changes_requested: 1, delivered_awaiting: 2 }

// Shared (not per-viewer) on purpose: transparency is the point — Derek sees
// what's on Claudio, Claudio sees what's on Derek. "Needs the team" renders
// only when non-empty; Derek/Claudio headers always render.
const NEEDS_GROUPS: { actor: Actor; title: string; empty: string }[] = [
  { actor: 'derek', title: '🔴 Needs Derek', empty: 'Nothing waiting on Derek right now.' },
  { actor: 'claudio', title: '🟠 Needs Claudio', empty: 'Nothing waiting on Claudio right now.' },
  { actor: 'team', title: '⚪ Needs the team', empty: '' },
]

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
  ]

  // Group the act-needed heroes by whose move it is (Derek's Owner-next column).
  const byActor = new Map<Actor, Task[]>()
  for (const t of needsYou) {
    const actor = normalizeActor(t.ownerNext)
    byActor.set(actor, [...(byActor.get(actor) ?? []), t])
  }
  for (const g of NEEDS_GROUPS) {
    const items = byActor.get(g.actor) ?? []
    if (g.actor === 'team' && items.length === 0) continue
    blocks.push(header(g.title))
    if (items.length === 0) {
      blocks.push(context(g.empty))
    } else {
      for (const t of items.slice(0, GROUP_CAP)) blocks.push(needsYouRow(t, opts.commentCounts))
      blocks.push(context(`Showing ${Math.min(items.length, GROUP_CAP)} of ${items.length}`))
    }
  }

  blocks.push(divider(), header('📊 Portfolio Health'))
  const shownCompanies = companies.slice(0, PORTFOLIO_CAP)
  for (const company of shownCompanies) {
    const ct = tasks.filter((t) => t.company === company)
    const health = companyHealth(ct)
    blocks.push(
      section(`${HEALTH_DOT[health]} *${company}* · ${HEALTH_WORD[health]}`, button('View →', `open_company:${company}`)),
      context(countLine(rollupCounts(ct))),
    )
  }
  if (companies.length > shownCompanies.length) {
    blocks.push(
      context(`…and ${companies.length - shownCompanies.length} more companies — open 📋 All tasks to see everything.`),
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
