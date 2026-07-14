import { expect, test } from 'vitest'
import { buildSnapshot, diffSnapshot, isNewSince, lastCommentTurnByTask, parseWatermark, resolveAnchor, taskHasCommentFrom, type Snapshot } from '../src/cockpit-state.js'
import type { Comment, Task } from '../src/model.js'

const DEREK = 'U08APFXGJ4U'
const CLAUDIO = 'U08C8QTNBJ9'
const cmt = (taskNum: string, author: string): Comment => ({ timestamp: '', taskNum, author, text: 'x', seen: '' })

const t = (o: Partial<Task>): Task => ({
  taskNum: '1',
  company: 'JRS',
  title: 'x',
  owner: 'a',
  status: 'in_progress',
  rawStatus: '',
  ...o,
})
const counts = (o: Record<string, number> = {}) => new Map(Object.entries(o))

test('diffSnapshot: an empty/first snapshot yields NOTHING (never floods on first visit)', () => {
  const tasks = [t({ taskNum: '1', status: 'delivered_awaiting' }), t({ taskNum: '2', status: 'done' })]
  expect(diffSnapshot(tasks, counts(), {})).toEqual([])
})

test('diffSnapshot: status moves are classified (into_review / shipped / into_needs / changes)', () => {
  const snap: Snapshot = {
    '1': { s: 'in_progress', l: true, c: 0 },
    '2': { s: 'delivered_awaiting', l: true, c: 0 },
    '3': { s: 'in_progress', l: false, c: 0 },
    '4': { s: 'delivered_awaiting', l: true, c: 0 },
  }
  const tasks = [
    t({ taskNum: '1', status: 'delivered_awaiting' }), // → into_review
    t({ taskNum: '2', status: 'done' }), // → shipped
    t({ taskNum: '3', status: 'needs_you' }), // → into_needs
    t({ taskNum: '4', status: 'changes_requested' }), // → changes
  ]
  const kinds = Object.fromEntries(diffSnapshot(tasks, counts(), snap).map((d) => [d.taskNum, d.kind]))
  expect(kinds).toEqual({ '1': 'into_review', '2': 'shipped', '3': 'into_needs', '4': 'changes' })
})

test('diffSnapshot: a delivery gaining its link, a new task, and new comments each surface', () => {
  const snap: Snapshot = { '1': { s: 'delivered_awaiting', l: false, c: 0 }, '2': { s: 'in_progress', l: true, c: 1 } }
  const tasks = [
    t({ taskNum: '1', status: 'delivered_awaiting', deliverableDriveUrl: 'https://d/1' }), // gained a link
    t({ taskNum: '2', status: 'in_progress' }), // same status, +1 comment
    t({ taskNum: '9', status: 'needs_you' }), // brand new task
  ]
  const d = diffSnapshot(tasks, counts({ '2': 2 }), snap)
  const byNum = Object.fromEntries(d.map((x) => [x.taskNum, x.kind]))
  expect(byNum['1']).toBe('linked')
  expect(byNum['2']).toBe('new_comment')
  expect(byNum['9']).toBe('new_task')
  // the new needs_you task flags needsYou
  expect(d.find((x) => x.taskNum === '9')?.needsYou).toBe(true)
})

test('lastCommentTurnByTask: the LATEST comment author per task maps to derek/claudio/other', () => {
  const comments = [
    cmt('1', `@derek (${DEREK})`),
    cmt('1', `@claudio (${CLAUDIO})`), // latest on 1 → claudio
    cmt('2', `@derek (${DEREK})`), // latest on 2 → derek
    cmt('3', 'Agent M42 (cc-sweep)'), // machine → other
  ]
  const m = lastCommentTurnByTask(comments, DEREK, CLAUDIO)
  expect(m.get('1')).toBe('claudio')
  expect(m.get('2')).toBe('derek')
  expect(m.get('3')).toBe('other')
})

test('taskHasCommentFrom: gates the Derek ping to threads he is actually part of', () => {
  const comments = [cmt('1', `@derek (${DEREK})`), cmt('1', `@claudio (${CLAUDIO})`), cmt('2', `@claudio (${CLAUDIO})`)]
  // #1 has a Derek comment → a Claudio reply there is a genuine hand-off.
  expect(taskHasCommentFrom(comments, '1', DEREK)).toBe(true)
  // #2 is Claudio-only (a private note thread) → no Derek to hand off to.
  expect(taskHasCommentFrom(comments, '2', DEREK)).toBe(false)
  // #3 has no comments at all.
  expect(taskHasCommentFrom(comments, '3', DEREK)).toBe(false)
})

test('diffSnapshot: a new comment flags needsYou ONLY for the OTHER principal (turn hand-off)', () => {
  const snap: Snapshot = { '1': { s: 'in_progress', l: false, c: 1 } }
  const tasks = [t({ taskNum: '1', status: 'in_progress' })]
  const lastAuthorByTask = new Map([['1', 'claudio' as const]])
  // Derek viewing Claudio's reply → his move.
  const derekView = diffSnapshot(tasks, counts({ '1': 2 }), snap, { lastAuthorByTask, viewer: 'derek' })
  expect(derekView.find((d) => d.taskNum === '1')).toMatchObject({ kind: 'new_comment', needsYou: true })
  // Claudio viewing his OWN reply → not his move.
  const claudioView = diffSnapshot(tasks, counts({ '1': 2 }), snap, { lastAuthorByTask, viewer: 'claudio' })
  expect(claudioView.find((d) => d.taskNum === '1')?.needsYou).toBe(false)
  // No turn info → backward-compatible false (existing callers unaffected).
  expect(diffSnapshot(tasks, counts({ '1': 2 }), snap).find((d) => d.taskNum === '1')?.needsYou).toBe(false)
  // A machine-authored last comment is never a hand-off.
  const machine = new Map([['1', 'other' as const]])
  expect(diffSnapshot(tasks, counts({ '1': 2 }), snap, { lastAuthorByTask: machine, viewer: 'derek' }).find((d) => d.taskNum === '1')?.needsYou).toBe(false)
})

test('resolveAnchor: first-ever visit → now (nothing new); a >30m gap freezes the anchor at the old lastSeen; an active session keeps it stable', () => {
  const now = 1_000_000_000
  expect(resolveAnchor(null, now)).toEqual({ anchorTs: now, isNewVisit: true })
  const old = now - 40 * 60_000
  expect(resolveAnchor({ userId: 'u', lastSeenTs: old, sessionAnchorTs: old - 5, snapshot: {} }, now)).toEqual({ anchorTs: old, isNewVisit: true })
  const recent = now - 60_000 // 1 min ago → same session
  const r = resolveAnchor({ userId: 'u', lastSeenTs: recent, sessionAnchorTs: 12345, snapshot: {} }, now)
  expect(r).toEqual({ anchorTs: 12345, isNewVisit: false }) // anchor stays put; a quick refresh won't wipe the strip
})

test('isNewSince: true only when the task was updated after the session anchor', () => {
  expect(isNewSince(t({ lastUpdatedTs: 200 }), 100)).toBe(true)
  expect(isNewSince(t({ lastUpdatedTs: 50 }), 100)).toBe(false)
  expect(isNewSince(t({ lastUpdatedTs: undefined }), 100)).toBe(false)
})

test('buildSnapshot + parseWatermark round-trip through the compact cell format', () => {
  const snap = buildSnapshot([t({ taskNum: '1', status: 'done', deliverableDriveUrl: 'https://d/1' })], counts({ '1': 3 }))
  expect(snap['1']).toEqual({ s: 'done', l: true, c: 3 })
  const rows = [
    ['userId', 'lastSeenIso', 'lastSeenTs', 'sessionAnchorTs', 'snapshotJson'],
    ['U9', '2026-07-07T00:00:00Z', '1700', '1600', JSON.stringify(snap)],
  ]
  const wm = parseWatermark(rows, 'U9')
  expect(wm?.lastSeenTs).toBe(1700)
  expect(wm?.sessionAnchorTs).toBe(1600)
  expect(wm?.snapshot['1']).toEqual({ s: 'done', l: true, c: 3 })
  expect(parseWatermark(rows, 'UNKNOWN')).toBeNull()
})
