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
  STATUS_EMOJI,
  STATUS_LABEL,
  hasDeliverableLink,
  isDeliveredWithoutLink,
  type CanonicalStatus,
  type Task,
  type ViewState,
} from '../model.js'
import { companyHealth, normalizeActor, rollupCounts, type Actor } from '../normalize.js'
import { clamp, coarseAge, countLine, liveProvenance, taskRef } from '../text.js'

// App Home hard-caps at ~100 blocks. Worst case with this 6-section layout ≈ 86
// (14-block margin — asserted in tests/views.test.ts). Top to bottom: chrome →
// 📬 Ready for review → 🚧 Preview ready (parked) → 🎉 Recently shipped → the
// Needs-a-decision actor groups → ⚠️ Delivered—link missing → 📊 Portfolio
// Health → footer. The positive/preview sections are funded by dropping
// PORTFOLIO_CAP 30→18→12 (real portfolio ≈10 companies, so 12 never truncates in
// practice — pure headroom; any growth folds into "…and N more companies").
const PORTFOLIO_CAP = 12
const GROUP_CAP = 5 // max rows per Needs-a-decision actor group
const REVIEW_CAP = 6 // max rows in "Ready for review"
const PARKED_CAP = 5 // max rows in "Preview ready — waiting on an input"
const SHIP_CAP = 3 // max spot-check rows in "Recently shipped"
const LINK_CAP = 4 // max rows in "Delivered — link missing"

// "Needs a decision" = ONLY genuine decisions / change-requests. delivered_awaiting
// has moved OUT of this zone: linked → "📬 Ready for review", linkless →
// "⚠️ Delivered — link missing". So "Needs Derek" now means a real decision.
const DECISION_STATUSES: CanonicalStatus[] = ['needs_you', 'changes_requested']

// "🚧 Preview ready — waiting on an input" = a finished deliverable EXISTS but the
// task is still in flight, so it is NOT a clean hand-off. Requires a link (so it
// never overlaps ⚠️ link-missing) and claims ONLY these two statuses —
// needs_you / changes_requested stay genuine decisions, delivered_awaiting stays
// a clean hand-off — so every task lands in exactly one hero by construction.
const PARKED_STATUSES: CanonicalStatus[] = ['in_progress', 'blocked']

const HEALTH_DOT = { on_track: '🟢', at_risk: '🟡', blocked: '🔴' } as const
const HEALTH_WORD = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' } as const

// Explicit actor tag — the Home is one shared view published identically to
// Derek AND Claudio, so a row NEVER means "yours" by omission; it always names
// whose move it is. (Same reason section titles stay actor-neutral: "Ready for
// review", never "YOUR review".)
const ACTOR_LABEL: Record<Actor, string> = { derek: '👤 Derek', claudio: '👤 Claudio', team: '👤 Team' }
const ACTOR_TIER: Record<Actor, number> = { derek: 0, claudio: 1, team: 2 }
const DECISION_ORDER: Record<string, number> = { needs_you: 0, changes_requested: 1 }

const NEEDS_GROUPS: { actor: Actor; title: string; empty: string }[] = [
  { actor: 'derek', title: '🔴 Needs Derek', empty: 'Nothing waiting on Derek right now.' },
  { actor: 'claudio', title: '🟠 Needs Claudio', empty: 'Nothing waiting on Claudio right now.' },
  { actor: 'team', title: '⚪ Needs the team', empty: '' },
]

export interface HomeOpts {
  demo?: boolean
  /** Epoch ms of the last successful tracker sync — drives the freshness dot. */
  syncedAtMs?: number
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number
  commentCounts?: Map<string, number>
}

// ── sort / format helpers ───────────────────────────────────────────────────
function numRank(t: Task): number {
  const n = parseInt((t.taskNum ?? '').replace(/[^\d-]/g, ''), 10)
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n
}
function tsOf(t: Task): number {
  return t.lastUpdatedTs ?? Number.NEGATIVE_INFINITY
}
/** Most-recently-updated first; undated last; Task# as the final tiebreak. */
function byRecent(a: Task, b: Task): number {
  return tsOf(b) - tsOf(a) || numRank(a) - numRank(b)
}
function deliverableUrl(t: Task): string | undefined {
  return t.deliverableDriveUrl || t.deliverableSlackUrl || t.deliverableOtherUrl
}
/** Inline deliverable link label = the NOUN of the destination (a Doc/Thread/Link),
 * so it never collides with the row's button VERB (Review / Open the modal). */
function linkLabel(t: Task): string {
  return t.deliverableDriveUrl ? '📄 Doc' : t.deliverableSlackUrl ? '💬 Thread' : '🔗 Link'
}
function commentBadge(counts: Map<string, number> | undefined, t: Task): string {
  const n = counts?.get(t.taskNum) ?? 0
  return n > 0 ? ` · 💬 ${n}` : ''
}

// What a parked task is waiting on: prefer the explicit dependency field, else a
// status cell that actually reads like a blocker, else a safe generic. Never invents.
const PARKED_NEED_RE = /need|await|wait|gate|block|pending|depend/i
function parkedWaitingText(t: Task): string {
  const dep = t.dependency?.trim()
  if (dep) return clamp(dep, 90)
  const raw = t.rawStatus?.trim()
  if (raw && PARKED_NEED_RE.test(raw)) return clamp(raw, 90)
  return 'an input — open for details'
}

/** 📬 Ready-for-review row: inline deliverable link (zero handler) + a primary
 * "Review" verb. The status token is omitted — the section header already says
 * "Delivered / awaiting", and dropping it keeps the meta line off a phone's 2nd row. */
function reviewRow(t: Task, counts?: Map<string, number>): Block {
  const actor = ACTOR_LABEL[normalizeActor(t.ownerNext)]
  const url = deliverableUrl(t)!
  return section(
    `*${clamp(t.title, 200)}*\n\`${taskRef(t)}\` · ${actor}${commentBadge(counts, t)} · <${url}|${linkLabel(t)}>`,
    button('Review', `open_task:${t.taskNum}`, { primary: true }),
  )
}

/** 🚧 Preview-ready row: a finished preview to peek at, PLUS what it waits on + who.
 * Grey "Open" (a peek/nudge, not the primary "Review" verdict of a clean hand-off);
 * the inline link is "👀 Preview" (a draft), deliberately not "📄 Doc". */
function parkedRow(t: Task, counts?: Map<string, number>): Block {
  const url = deliverableUrl(t)!
  const actor = ACTOR_LABEL[normalizeActor(t.ownerNext)]
  return section(
    `*${clamp(t.title, 200)}*\n\`${taskRef(t)}\`${commentBadge(counts, t)} · <${url}|👀 Preview>\n⏳ ${actor} · ${parkedWaitingText(t)}`,
    button('Open', `open_task:${t.taskNum}`),
  )
}

/** 🎉 Recently-shipped spot-check row: grey (settled) "Open" + inline destination
 * link. Status token omitted (the "Recently shipped" header already says Done);
 * the link uses linkLabel() so a Slack-thread win shows 💬 Thread, not a false 📄. */
function shippedRow(t: Task, counts?: Map<string, number>): Block {
  const url = deliverableUrl(t)!
  return section(
    `*${clamp(t.title, 200)}*\n\`${taskRef(t)}\`${commentBadge(counts, t)} · <${url}|${linkLabel(t)}>`,
    button('Open', `open_task:${t.taskNum}`),
  )
}

/** Needs-a-decision hero row (unchanged format): primary "Open". */
function decisionRow(t: Task, counts?: Map<string, number>): Block {
  return section(
    `*${clamp(t.title, 200)}*\n\`${taskRef(t)}\` · ${STATUS_EMOJI[t.status]} ${STATUS_LABEL[t.status]}${commentBadge(counts, t)}`,
    button('Open', `open_task:${t.taskNum}`, { primary: true }),
  )
}

/** ⚠️ Delivered-but-linkless defect row — bold + individually openable, never a folded count. */
function missingRow(t: Task, counts?: Map<string, number>): Block {
  const actor = ACTOR_LABEL[normalizeActor(t.ownerNext)]
  return section(
    `*${clamp(t.title, 200)}*\n\`${taskRef(t)}\` · ${STATUS_EMOJI[t.status]} ${STATUS_LABEL[t.status]} · ⚠️ no link · ${actor}${commentBadge(counts, t)}`,
    button('Open', `open_task:${t.taskNum}`, { primary: true }),
  )
}

export function buildHomeView(tasks: Task[], _state: ViewState, opts: HomeOpts = {}): HomeView {
  const companies = [...new Set(tasks.map((t) => t.company))].sort()
  const counts = opts.commentCounts
  const now = opts.now ?? Date.now()

  const provenance = opts.demo
    ? '🧪 *DEMO FIXTURE* · sample JRS+Brightly data (not live)'
    : liveProvenance(opts.syncedAtMs, opts.now)

  const blocks: Block[] = [
    header('Agent M42 · Portfolio Cockpit'),
    context(provenance),
    actions([
      button('🔄 Refresh', 'refresh_home'),
      button('📋 All tasks', 'open_board'),
      button('🔍 Search', 'open_search'),
      button('➕ New task', 'open_create_task'),
    ]),
    divider(),
  ]

  // ── 📬 Ready for review — finished deliverables Derek can open right now.
  // Derek's own items float first, then most-recent. Hidden entirely when empty
  // (an empty review inbox is noise on a CEO board; its absence IS the signal).
  const ready = tasks
    .filter((t) => t.status === 'delivered_awaiting' && hasDeliverableLink(t))
    .sort(
      (a, b) =>
        ACTOR_TIER[normalizeActor(a.ownerNext)] - ACTOR_TIER[normalizeActor(b.ownerNext)] || byRecent(a, b),
    )
  if (ready.length > 0) {
    blocks.push(header('📬 Ready for review'))
    for (const t of ready.slice(0, REVIEW_CAP)) blocks.push(reviewRow(t, counts))
    if (ready.length > REVIEW_CAP) {
      blocks.push(actions([button(`📋 See all ${ready.length} ready`, 'open_board_status:delivered_awaiting')]))
    }
  }

  // ── 🚧 Preview ready — waiting on an input — a finished preview EXISTS but the
  // task is still in-flight/blocked on an input, so it's not a clean hand-off yet.
  // Invisible today (feeds only Portfolio counts). Derek's own inputs float first.
  const parked = tasks
    .filter((t) => PARKED_STATUSES.includes(t.status) && hasDeliverableLink(t))
    .sort(
      (a, b) =>
        ACTOR_TIER[normalizeActor(a.ownerNext)] - ACTOR_TIER[normalizeActor(b.ownerNext)] || byRecent(a, b),
    )
  if (parked.length > 0) {
    blocks.push(divider(), header('🚧 Preview ready — waiting on an input'))
    for (const t of parked.slice(0, PARKED_CAP)) blocks.push(parkedRow(t, counts))
    if (parked.length > PARKED_CAP) {
      // UNFILTERED all-tasks — the section spans in_progress+blocked, so a
      // status-filtered deep-link would drop the other half.
      blocks.push(actions([button(`📋 See all ${parked.length} parked`, 'open_board')]))
    }
  }

  // ── 🎉 Recently shipped — the wins. Count is timestamp-INDEPENDENT (honest
  // even when "Last updated" cells are blank); the spot-check rows need a link.
  const done = tasks.filter((t) => t.status === 'done')
  if (done.length > 0) {
    blocks.push(divider(), header('🎉 Recently shipped'))
    const companiesWithDone = new Set(done.map((t) => t.company)).size
    const newest = done.slice().sort(byRecent)[0]
    const tail = newest.lastUpdatedTs != null ? ` · latest \`${taskRef(newest)}\` ${coarseAge(now - newest.lastUpdatedTs)}` : ''
    blocks.push(
      context(`🎉 *${done.length} shipped* · ${companiesWithDone} ${companiesWithDone === 1 ? 'company' : 'companies'}${tail}`),
    )
    for (const t of done.filter(hasDeliverableLink).sort(byRecent).slice(0, SHIP_CAP)) blocks.push(shippedRow(t, counts))
    blocks.push(actions([button(`📋 See all ${done.length} shipped`, 'open_board_status:done')]))
  }

  // ── Needs a decision — genuine decisions / change-requests, grouped by whose
  // move it is. delivered_awaiting no longer lives here (see DECISION_STATUSES).
  const decisions = tasks.filter((t) => DECISION_STATUSES.includes(t.status))
  const byActor = new Map<Actor, Task[]>()
  for (const t of decisions) {
    // A change-request is by definition the TEAM's move (rework), regardless of
    // the Owner-next column (which the cockpit can't rewrite) — otherwise a task
    // Derek just bounced back would re-render parked under "🔴 Needs Derek".
    const actor = t.status === 'changes_requested' ? 'team' : normalizeActor(t.ownerNext)
    byActor.set(actor, [...(byActor.get(actor) ?? []), t])
  }
  blocks.push(divider())
  for (const g of NEEDS_GROUPS) {
    const items = (byActor.get(g.actor) ?? []).sort(
      (a, b) => (DECISION_ORDER[a.status] ?? 9) - (DECISION_ORDER[b.status] ?? 9) || byRecent(a, b),
    )
    if (g.actor === 'team' && items.length === 0) continue
    blocks.push(header(g.title))
    if (items.length === 0) {
      blocks.push(context(g.empty))
    } else {
      for (const t of items.slice(0, GROUP_CAP)) blocks.push(decisionRow(t, counts))
      // Only show the counter when rows were actually hidden — "Showing 1 of 1"
      // under a one-row group is pure noise (the row is right there).
      if (items.length > GROUP_CAP) blocks.push(context(`Showing ${GROUP_CAP} of ${items.length} · more in 📋 All tasks`))
    }
  }

  // ── ⚠️ Delivered — link missing — the defect: claimed delivered/done with no
  // openable link. Placed below decisions (the fix is Claudio/team's move) but
  // individually visible & openable — never a buried grey count. Both people
  // open this shared Home, so nothing linkless is ever faked as "ready".
  const missing = tasks
    .filter(isDeliveredWithoutLink)
    .sort(
      (a, b) =>
        (a.status === 'delivered_awaiting' ? 0 : 1) - (b.status === 'delivered_awaiting' ? 0 : 1) || numRank(a) - numRank(b),
    )
  if (missing.length > 0) {
    blocks.push(divider(), header('⚠️ Delivered — link missing'))
    for (const t of missing.slice(0, LINK_CAP)) blocks.push(missingRow(t, counts))
    if (missing.length > LINK_CAP) {
      blocks.push(context(`Showing ${LINK_CAP} of ${missing.length} · Claudio to attach links`))
    }
  }

  // ── 📊 Portfolio Health. The color Legend lives here, next to the 🟢🟡🔴 dots
  // it explains (moved off the top freshness line, which now scans as pure "when synced").
  blocks.push(divider(), header('📊 Portfolio Health'), context('Legend: 🟢 On track · 🟡 At risk · 🔴 Blocked'))
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
