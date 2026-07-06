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
  expect(json).toContain('Showing 1 of 1')
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
  expect(json).toContain('Review') // the primary verb
  expect(json).toContain('👤 Derek') // explicit actor tag (shared view)
  // NOT duplicated into the "Needs Derek" decision group.
  expect(json.slice(json.indexOf('Needs Derek'))).not.toContain('JRS-42')
})

test('home: delivered/done WITHOUT a link surfaces under "⚠️ Delivered — link missing"', () => {
  const tasks = [
    t({ taskNum: '5', company: 'JRS', status: 'delivered_awaiting', title: 'no link yet', ownerNext: 'Claudio' }),
    t({ taskNum: '9', company: 'BAM', status: 'done', title: 'done no link' }),
  ]
  const json = JSON.stringify(buildHomeView(tasks, { kind: 'portfolio' }))
  expect(json).toContain('Delivered — link missing')
  expect(json).toContain('no link')
  expect(json).toContain('JRS-5')
  expect(json).toContain('BAM-9')
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

test('home: worst-case fixture (ready + shipped + 3 decision groups + link-missing + 30 companies) stays < 100 blocks', () => {
  const tasks: Task[] = []
  for (let i = 0; i < 30; i++) tasks.push(t({ taskNum: `co${i}`, company: `Co${i}`, status: 'in_progress' }))
  for (let i = 0; i < 7; i++) tasks.push(t({ taskNum: `r${i}`, company: 'JRS', status: 'delivered_awaiting', ownerNext: 'Derek', deliverableDriveUrl: `https://d/${i}` }))
  for (let i = 0; i < 4; i++) tasks.push(t({ taskNum: `s${i}`, company: 'BAM', status: 'done', deliverableDriveUrl: `https://s/${i}` }))
  for (let i = 0; i < 6; i++) {
    tasks.push(t({ taskNum: `d${i}`, company: 'JRS', status: 'needs_you', ownerNext: 'Derek' }))
    tasks.push(t({ taskNum: `c${i}`, company: 'JRS', status: 'changes_requested', ownerNext: 'Claudio' }))
    tasks.push(t({ taskNum: `x${i}`, company: 'JRS', status: 'needs_you' }))
  }
  for (let i = 0; i < 5; i++) tasks.push(t({ taskNum: `m${i}`, company: 'ENT', status: 'delivered_awaiting' }))
  const view = buildHomeView(tasks, { kind: 'portfolio' })
  expect(view.blocks.length).toBeLessThan(100)
  expect(JSON.stringify(view)).toContain('📬 Ready for review')
  expect(JSON.stringify(view)).toContain('🎉 Recently shipped')
  expect(JSON.stringify(view)).toContain('⚠️ Delivered — link missing')
})

test('task modal clamps description and never emits a URL button without a URL', () => {
  const json = JSON.stringify(buildTaskModal(t({ description: 'x'.repeat(5000), deliverableDriveUrl: undefined })))
  expect(json).not.toContain('"url"')
  expect(json.length).toBeLessThan(20000)
})

test('task modal: kicker shows Task ref, hero + "Where it stands" always render', () => {
  const json = JSON.stringify(buildTaskModal(t({ taskNum: '43', company: 'JRS', status: 'needs_you', ownerNext: 'Derek' }), [], 'derek'))
  expect(json).toContain('JRS-43') // kicker
  expect(json).toContain('Where it stands')
  expect(json).toContain('A person needs to weigh in before it can move.') // STATUS_EXPLAINER
  expect(json).toContain('🟠 Your move') // deriveAsk hero (viewer IS Derek)
  expect(json).toContain('Whose move') // facts grid
  expect(json).not.toContain('Task ID') // duplicate grid field dropped
})

test('task modal hero is viewer-aware for the same task', () => {
  const task = t({ status: 'delivered_awaiting', ownerNext: 'Derek' })
  expect(JSON.stringify(buildTaskModal(task, [], 'derek'))).toContain('🟡 Your move')
  const observer = JSON.stringify(buildTaskModal(task, [], 'observer'))
  expect(observer).toContain('Waiting on Derek')
  expect(observer).not.toContain('Your move')
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

  const done = JSON.stringify(buildTaskModal(t({ status: 'done', deliverableDriveUrl: undefined })))
  expect(done).toMatch(/no access link/i)

  // A non-delivered task with no link keeps the neutral note (no false alarm).
  const queued = JSON.stringify(buildTaskModal(t({ status: 'queued', deliverableDriveUrl: undefined })))
  expect(queued).toContain('No deliverable linked yet')
  expect(queued).not.toMatch(/no access link/i)

  // A delivered task WITH a link shows the button and no warning.
  const linked = JSON.stringify(buildTaskModal(t({ status: 'done', deliverableDriveUrl: 'https://docs.google.com/x' })))
  expect(linked).toContain('url_drive')
  expect(linked).not.toMatch(/no access link/i)
})
