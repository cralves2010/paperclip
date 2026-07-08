import { expect, test } from 'vitest'
import { countLine, truncateTitle } from '../src/text.js'
import { buildHomeView } from '../src/views/home.js'
import { buildTaskModal } from '../src/views/taskModal.js'
import type { Task } from '../src/model.js'

const t = (o: Partial<Task>): Task => ({
  taskNum: '1',
  company: 'JRS',
  title: 'x',
  owner: 'a',
  status: 'in_progress',
  rawStatus: '',
  ...o,
})

test('countLine uses single spaces + middot (Slack collapses multi-space)', () => {
  const line = countLine({ inProgress: 4, awaiting: 2, blocked: 0 })
  expect(line).not.toMatch(/ {2,}/)
  expect(line).toContain('·')
})

test('truncateTitle caps at 24 chars', () => {
  expect(truncateTitle('School contacts — 62 Tucson principals').length).toBeLessThanOrEqual(24)
})

test('home provenance shows "Last synced <clock>" freshness, not the old "LIVE · synced just now"', () => {
  const now = 1_700_000_000_000
  const fresh = JSON.stringify(buildHomeView([t({})], { kind: 'portfolio' }, { syncedAtMs: now - 60_000, now }))
  expect(fresh).toContain('Last synced')
  expect(fresh).not.toContain('synced just now')
  expect(fresh).not.toContain('*LIVE*')
})

test('home view pins the actor groups above Portfolio Health (shared for both viewers)', () => {
  const tasks = [
    t({ status: 'in_progress' }),
    t({ taskNum: '2', status: 'delivered_awaiting', title: 'ready', ownerNext: 'Derek' }),
  ]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  // Derek + Claudio headers ALWAYS render (Claudio's is empty here); team only when non-empty.
  expect(json.indexOf('Needs Derek')).toBeGreaterThan(-1)
  expect(json.indexOf('Needs Claudio')).toBeGreaterThan(-1)
  expect(json).not.toContain('Needs the team')
  expect(json.indexOf('Needs Derek')).toBeLessThan(json.indexOf('Needs Claudio'))
  expect(json.indexOf('Needs Claudio')).toBeLessThan(json.indexOf('Portfolio Health'))
})

test('home hero row shows the full Task ref (COMPANY-N), not just the company', () => {
  // Regression for the gap: the Needs-You hero meta line must carry the number.
  const tasks = [t({ taskNum: '43', company: 'JRS', status: 'needs_you', ownerNext: 'Derek' })]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json).toContain('JRS-43')
})

test('home view groups act-needed tasks by Owner-next actor, capped at 5 per group', () => {
  const tasks: Task[] = []
  for (let i = 0; i < 7; i++) tasks.push(t({ taskNum: `d${i}`, status: 'needs_you', ownerNext: 'Derek' }))
  tasks.push(t({ taskNum: 'c1', status: 'needs_you', ownerNext: 'Claudio' }))
  tasks.push(t({ taskNum: 'x1', status: 'needs_you', ownerNext: '' })) // empty -> team
  const json = JSON.stringify(
    buildHomeView(tasks, { kind: 'portfolio' }, { commentCounts: new Map([['d0', 4]]) }),
  )
  expect(json).toContain('Needs the team')
  expect(json).toContain('Showing 5 of 7') // Derek group capped
  expect(json).not.toContain('Showing 1 of 1') // 1-row groups no longer print a redundant counter
  // Hero affordances survive the actor-group refactor: primary Open button + 💬 badge.
  expect(json).toContain('open_task:d0')
  expect(json).toContain('"style":"primary"')
  expect(json).toContain('💬 4')
})

test('home view stays under the ~100-block App Home ceiling with many companies', () => {
  // One task per company across 120 companies + all THREE actor groups overflowing.
  const tasks: Task[] = Array.from({ length: 120 }, (_, i) =>
    t({ taskNum: String(i + 1), company: `Co${i + 1}`, status: 'in_progress' }),
  )
  for (let i = 0; i < 8; i++) {
    tasks.push(t({ taskNum: `d${i}`, company: `Co${i + 1}`, status: 'needs_you', ownerNext: 'Derek' }))
    tasks.push(t({ taskNum: `c${i}`, company: `Co${i + 1}`, status: 'needs_you', ownerNext: 'Claudio' }))
    tasks.push(t({ taskNum: `t${i}`, company: `Co${i + 1}`, status: 'needs_you' }))
  }
  const view = buildHomeView(tasks, { kind: 'portfolio' })
  expect(view.blocks.length).toBeLessThan(100)
  // Overflow beyond the cap is summarized, not dropped silently.
  expect(JSON.stringify(view)).toContain('more companies')
})

test('home: delivered_awaiting WITH a link surfaces under "📬 Ready for review", not the decision groups', () => {
  const tasks = [
    t({ taskNum: '42', company: 'JRS', status: 'delivered_awaiting', title: 'ready doc', ownerNext: 'Derek', deliverableDriveUrl: 'https://docs.google.com/x' }),
  ]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json).toContain('Ready for review')
  expect(json.indexOf('Ready for review')).toBeLessThan(json.indexOf('Needs Derek'))
  expect(json).toContain('https://docs.google.com/x') // inline deliverable link
  expect(json).toContain('Review') // the primary verb (button = open the modal)
  expect(json).toContain('📄 Doc') // inline link is the destination NOUN, not a second "Open"
  expect(json).not.toContain('Delivered – awaiting') // status token dropped from Ready rows (header says it)
  expect(json).toContain('👤 Derek') // explicit actor tag (shared view)
  // NOT duplicated into the "Needs Derek" decision group.
  expect(json.slice(json.indexOf('Needs Derek'))).not.toContain('JRS-42')
})

test('home: delivered_awaiting WITHOUT a link surfaces under "⚠️ Delivered — link missing"; a linkless Done does NOT (decision-close)', () => {
  const tasks = [
    t({ taskNum: '5', company: 'JRS', status: 'delivered_awaiting', title: 'no link yet', ownerNext: 'Claudio' }),
    t({ taskNum: '9', company: 'BAM', status: 'done', title: 'done no link' }), // linkless Done = a decision-close, not a defect
  ]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json).toContain('Delivered — link missing')
  expect(json).toContain('no link')
  expect(json).toContain('JRS-5')
  // the linkless Done is NOT flagged as a missing-link defect (it went to 🎉 shipped)
  expect(json.slice(json.indexOf('Delivered — link missing'))).not.toContain('BAM-9')
})

test('home: "🎉 Recently shipped" counts done even when every lastUpdatedTs is undefined', () => {
  const tasks = [
    t({ taskNum: '1', company: 'JRS', status: 'done', deliverableDriveUrl: 'https://d/1' }),
    t({ taskNum: '2', company: 'BAM', status: 'done' }),
  ]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json).toContain('🎉 *2 shipped*')
  expect(json).toContain('open_board_status:done') // one-tap deep-link to the Done-filtered board
})

test('home: section titles stay actor-neutral (never "your review")', () => {
  const tasks = [t({ status: 'delivered_awaiting', deliverableDriveUrl: 'https://d/1', ownerNext: 'Derek' })]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' })).toLowerCase()
  expect(json).toContain('ready for review')
  expect(json).not.toContain('your review')
})

test('home: worst-case fixture (all 6 sections maxed + 30 companies) stays < 100 blocks', () => {
  const tasks: Task[] = []
  for (let i = 0; i < 30; i++) tasks.push(t({ taskNum: `co${i}`, company: `Co${i}`, status: 'in_progress' })) // no link → Portfolio only
  for (let i = 0; i < 7; i++) tasks.push(t({ taskNum: `r${i}`, company: 'JRS', status: 'delivered_awaiting', ownerNext: 'Derek', deliverableDriveUrl: `https://d/${i}` }))
  for (let i = 0; i < 6; i++) tasks.push(t({ taskNum: `p${i}`, company: 'JRS', status: i % 2 ? 'blocked' : 'in_progress', ownerNext: 'Derek', deliverableDriveUrl: `https://p/${i}`, dependency: 'waiting on input' })) // 🚧 parked maxes (5 + overflow)
  for (let i = 0; i < 4; i++) tasks.push(t({ taskNum: `s${i}`, company: 'BAM', status: 'done', deliverableDriveUrl: `https://s/${i}` }))
  for (let i = 0; i < 6; i++) {
    tasks.push(t({ taskNum: `d${i}`, company: 'JRS', status: 'needs_you', ownerNext: 'Derek' }))
    tasks.push(t({ taskNum: `c${i}`, company: 'JRS', status: 'changes_requested', ownerNext: 'Claudio' }))
    tasks.push(t({ taskNum: `x${i}`, company: 'JRS', status: 'needs_you' }))
  }
  for (let i = 0; i < 5; i++) tasks.push(t({ taskNum: `m${i}`, company: 'ENT', status: 'delivered_awaiting' })) // link-missing
  const view = buildHomeView(tasks, { kind: 'portfolio' })
  expect(view.blocks.length).toBeLessThan(100) // ≈86 with all 6 sections maxed + PORTFOLIO_CAP=12
  const j = JSON.stringify(view)
  expect(j).toContain('📬 Ready for review')
  expect(j).toContain('🚧 Preview ready')
  expect(j).toContain('🎉 Recently shipped')
  expect(j).toContain('⚠️ Delivered — link missing')
})

test('home: in_progress/blocked WITH a link surfaces under "🚧 Preview ready", between Ready and Shipped', () => {
  const tasks = [
    t({ taskNum: '30', company: 'Brightly', status: 'in_progress', title: 'referral outreach', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/30', dependency: 'Your referral pricing' }),
    t({ taskNum: '42', company: 'JRS', status: 'delivered_awaiting', title: 'ready', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/42' }),
    t({ taskNum: '9', company: 'BAM', status: 'done', title: 'shipped', deliverableDriveUrl: 'https://d/9' }),
  ]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json).toContain('🚧 Preview ready')
  // placement: after Ready for review, before Recently shipped
  expect(json.indexOf('Ready for review')).toBeLessThan(json.indexOf('🚧 Preview ready'))
  expect(json.indexOf('🚧 Preview ready')).toBeLessThan(json.indexOf('Recently shipped'))
  // content: a "👀 Preview" link + a ⏳ waiting line (actor + what it waits on)
  expect(json).toContain('👀 Preview')
  expect(json).toContain('⏳')
  expect(json).toContain('Your referral pricing')
  // the parked button is a grey peek/nudge, NOT the primary "Review" verdict
  const parkedSlice = json.slice(json.indexOf('🚧 Preview ready'), json.indexOf('Recently shipped'))
  expect(parkedSlice).toContain('👤 Derek')
  expect(parkedSlice).not.toContain('"style":"primary"')
})

test('home: preview section dedups — a decision or a clean hand-off never lands in it', () => {
  const tasks = [
    t({ taskNum: '43', company: 'JRS', status: 'needs_you', title: 'decision', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/43' }), // needs_you+link → stays a decision
    t({ taskNum: '42', company: 'JRS', status: 'delivered_awaiting', title: 'clean', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/42' }), // → Ready
    t({ taskNum: '99', company: 'JRS', status: 'in_progress', title: 'no link' }), // in_progress WITHOUT link → Portfolio only
  ]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json.slice(json.indexOf('Needs Derek'))).toContain('JRS-43') // decision stays under Needs Derek
  expect(json).not.toContain('🚧 Preview ready') // nothing in_progress/blocked WITH a link → section hidden
})

test('home: preview overflow uses the UNFILTERED board so the blocked half is never dropped', () => {
  const tasks: Task[] = []
  for (let i = 0; i < 6; i++) tasks.push(t({ taskNum: `p${i}`, company: 'JRS', status: i % 2 ? 'blocked' : 'in_progress', ownerNext: 'Derek', deliverableDriveUrl: `https://d/${i}`, dependency: 'x' }))
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json).toContain('See all 6 parked')
  // a status-filtered deep-link (open_board_status:in_progress|blocked) would drop one half
  expect(json).not.toContain('open_board_status:in_progress')
  expect(json).not.toContain('open_board_status:blocked')
})

test('task modal clamps description and never emits a URL button without a URL', () => {
  const json = JSON.stringify(buildTaskModal(t({ description: 'x'.repeat(5000), deliverableDriveUrl: undefined })))
  expect(json).not.toContain('"url"')
  expect(json.length).toBeLessThan(20000)
})

test('task modal: kicker carries the status once; the merged action line replaces "Where it stands"', () => {
  const json = JSON.stringify(buildTaskModal(t({ taskNum: '43', company: 'JRS', status: 'needs_you', ownerNext: 'Derek' }), [], 'derek'))
  expect(json).toContain('JRS-43') // kicker (ref)
  expect(json).toContain('Needs you') // status label — in the kicker
  expect(json).not.toContain('Where it stands') // merged away (no duplicate status block)
  expect(json).toContain('Your move.') // action line (viewer IS Derek, has buttons)
  expect(json).toContain('answer & release below') // affordance points straight at the buttons
  expect(json).toContain('Whose move') // facts grid backstop
  expect(json).not.toContain('Task ID') // duplicate grid field dropped
})

test('task modal action line is viewer-aware AND never contradicts the buttons (the JRS-42 fix)', () => {
  const task = t({ status: 'delivered_awaiting', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/1' })
  // Derek IS the owner → "Your move."
  expect(JSON.stringify(buildTaskModal(task, [], 'derek'))).toContain('Your move.')
  // Claudio (principal, owner = Derek) → ownership + capability in one line; NEVER "nothing"
  // while the Approve/Request-changes buttons render below.
  const claudio = JSON.stringify(buildTaskModal(task, [], 'claudio'))
  expect(claudio).toContain('Derek’s call — you can act on it.')
  expect(claudio).toContain('verdict:approve:') // the buttons ARE there
  expect(claudio).not.toMatch(/nothing/i) // …and the copy no longer denies them
  // Observer → waiting, read-only, no action affordance.
  const observer = JSON.stringify(buildTaskModal(task, [], 'observer'))
  expect(observer).toContain('Waiting on Derek')
  expect(observer).not.toContain('Your move')
  expect(observer).not.toContain('verdict:')
})

test('task modal: "What this is" renders only with a description, as a blockquote', () => {
  const withDesc = JSON.stringify(buildTaskModal(t({ description: 'line one\nline two' })))
  expect(withDesc).toContain('📋 What this is')
  expect(withDesc).toContain('> line one')
  expect(withDesc).toContain('working notes')
  expect(JSON.stringify(buildTaskModal(t({ description: undefined })))).not.toContain('What this is')
})

test('task modal: dependency heading flips to "What’s blocking it" when blocked', () => {
  expect(JSON.stringify(buildTaskModal(t({ dependency: 'need sign-off', status: 'in_progress' })))).toContain('What’s left')
  expect(JSON.stringify(buildTaskModal(t({ dependency: 'need sign-off', status: 'blocked' })))).toContain('What’s blocking it')
  expect(JSON.stringify(buildTaskModal(t({ dependency: undefined })))).not.toContain('🚧')
})

test('task modal: a delivered/done task with NO link shows a LOUD missing-link warning, not the bland note', () => {
  // The defect Claudio flagged: "Delivered – awaiting you" + "No deliverable linked yet" with no alarm.
  const delivered = JSON.stringify(buildTaskModal(t({ status: 'delivered_awaiting', deliverableDriveUrl: undefined })))
  expect(delivered).toContain('⚠️')
  expect(delivered).toMatch(/no access link/i)
  expect(delivered).not.toContain('No deliverable linked yet')

  // A linkless DONE is a decision-close, not a broken delivery → neutral note, no alarm.
  const done = JSON.stringify(buildTaskModal(t({ status: 'done', deliverableDriveUrl: undefined })))
  expect(done).not.toMatch(/no access link/i)
  expect(done).toContain('No deliverable linked yet')

  // A non-delivered task with no link keeps the neutral note (no false alarm).
  const queued = JSON.stringify(buildTaskModal(t({ status: 'queued', deliverableDriveUrl: undefined })))
  expect(queued).toContain('No deliverable linked yet')
  expect(queued).not.toMatch(/no access link/i)

  // A delivered task WITH a link shows the button and no warning.
  const linked = JSON.stringify(buildTaskModal(t({ status: 'done', deliverableDriveUrl: 'https://docs.google.com/x' })))
  expect(linked).toContain('url_drive')
  expect(linked).not.toMatch(/no access link/i)
})

test('task modal: BOTH principals (Derek + Claudio) get verdict buttons with a confirm; observers do NOT', () => {
  const task = t({ taskNum: '42', company: 'JRS', status: 'delivered_awaiting', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/1' })
  for (const viewer of ['derek', 'claudio'] as const) {
    const json = JSON.stringify(buildTaskModal(task, [], viewer))
    expect(json).toContain('verdict:approve:42')
    expect(json).toContain('verdict:request_changes:42')
    expect(json).toContain('"confirm"') // native mis-tap confirm
  }
  const observer = JSON.stringify(buildTaskModal(task, [], 'observer'))
  expect(observer).not.toContain('verdict:')
})

test('home: a changes_requested task buckets to "Needs the team", never "Needs Derek", even with Owner-next = Derek', () => {
  const tasks = [t({ taskNum: '7', company: 'JRS', status: 'changes_requested', ownerNext: 'Derek' })]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json).toContain('Needs the team')
  const teamIdx = json.indexOf('Needs the team')
  expect(json.slice(teamIdx)).toContain('JRS-7') // under the team group
  expect(json.slice(json.indexOf('Needs Derek'), teamIdx)).not.toContain('JRS-7') // NOT in Derek's queue
})

test('home: the 🔔 "since you were here" digest renders from deltas; the all-clear shows when caught up; first visit shows neither', () => {
  const tasks = [t({ taskNum: '43', company: 'JRS', status: 'delivered_awaiting', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/1' })]
  const deltas = [{ taskNum: '43', company: 'JRS', title: 'ready doc', kind: 'into_review' as const, needsYou: true }]
  const withD = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }, { deltas, lastSeenTs: 1_700_000_000_000, now: 1_700_000_100_000 }))
  expect(withD).toContain('Since you were here')
  expect(withD).toContain('Since your last visit')
  expect(withD).toContain('JRS-43')
  expect(withD).toContain('🆕')

  const clear = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }, { deltas: [], lastSeenTs: 1_700_000_000_000, now: 1_700_000_100_000 }))
  expect(clear).toContain('All caught up')
  expect(clear).not.toContain('Since you were here')

  const first = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' })) // no watermark
  expect(first).not.toContain('last visit')
  expect(first).not.toContain('Since you were here')
})

test('home: a task changed since last visit wears a 🆕 selo on its section row; unchanged rows stay clean', () => {
  const tasks = [
    t({ taskNum: '43', company: 'JRS', status: 'delivered_awaiting', title: 'changed doc', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/1' }),
    t({ taskNum: '44', company: 'JRS', status: 'delivered_awaiting', title: 'untouched doc', ownerNext: 'Derek', deliverableDriveUrl: 'https://d/2' }),
  ]
  const deltas = [{ taskNum: '43', company: 'JRS', title: 'changed doc', kind: 'into_review' as const, needsYou: true }]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }, { deltas, lastSeenTs: 1, now: 2 }))
  // The 🆕 sits immediately before the ROW title (unique to the row renderer; the
  // digest puts 🆕 after the task ref), proving the selo is on the board row itself.
  expect(json).toContain('🆕 *changed doc*')
  expect(json).toContain('untouched doc') // the unchanged row still renders…
  expect(json).not.toContain('🆕 *untouched doc*') // …but carries no selo
  // With no deltas (first visit / all caught up) NO row wears a selo.
  const clean = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(clean).not.toContain('🆕')
})

test('home: the digest on top of a full board still fits under 100 blocks', () => {
  const tasks: Task[] = []
  for (let i = 0; i < 30; i++) tasks.push(t({ taskNum: `co${i}`, company: `Co${i}`, status: 'in_progress' }))
  for (let i = 0; i < 6; i++) tasks.push(t({ taskNum: `d${i}`, company: 'JRS', status: 'needs_you', ownerNext: 'Derek' }))
  const deltas = Array.from({ length: 8 }, (_, i) => ({ taskNum: `d${i}`, company: 'JRS', title: 'x', kind: 'into_needs' as const, needsYou: true }))
  const view = buildHomeView(tasks, { kind: 'portfolio' }, { deltas, lastSeenTs: 1, now: 2 })
  expect(view.blocks.length).toBeLessThan(100)
})
