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
