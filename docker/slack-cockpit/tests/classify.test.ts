import { expect, test } from 'vitest'
import type { Config } from '../src/config.js'
import type { Task } from '../src/model.js'
import { classifyAndCompose, composeEnrichedDm, suggestedCommand, type Classification } from '../src/classify.js'

const cfg = (over: Partial<Config> = {}): Config => ({
  slackBotToken: 'x', slackAppToken: 'x', demo: false, googleSaJsonPath: '', sheetId: 'SHEET',
  sheetRange: 'Tracker!A1:Z', allowlist: ['U_DEREK', 'U_CLAUDIO'], notifyUserId: 'U_CLAUDIO',
  commentsTab: 'Comments', trackerTab: 'Tracker', classifyEnabled: true, anthropicApiKey: 'k', ...over,
})
const task = (o: Partial<Task> = {}): Task => ({ taskNum: '42', company: 'JRS', title: 'x', owner: 'a', status: 'delivered_awaiting', rawStatus: '', ...o })
const base = { sheetId: 'SHEET', taskNum: '42', company: 'JRS', title: 'School outreach', author: 'Derek', text: 'make the subhead punchier' }
const cls = (o: Partial<Classification> = {}): Classification => ({ klass: 'change_request', confidence: 0.9, impact: 'A scoped revision remains.', reason: 'punchier subhead', draftReply: '', ...o })

test('disabled (no flag/key) → raw DM, no enrichment', async () => {
  const out = await classifyAndCompose(cfg({ classifyEnabled: false }), { authorId: 'U_DEREK', base, task: task() }, async () => cls())
  expect(out).toContain('New comment on #42')
  expect(out).not.toContain('🧠')
})

test('raw-comment-always invariant: classify failure falls back to the raw DM (never eats a comment)', async () => {
  const out = await classifyAndCompose(cfg(), { authorId: 'U_DEREK', base, task: task() }, async () => { throw new Error('boom') })
  expect(out).toContain('New comment on #42')
  expect(out).toContain('make the subhead punchier')
})

test('self-note (author == Claudio) skips the LLM and returns the raw note', async () => {
  let called = false
  const out = await classifyAndCompose(cfg(), { authorId: 'U_CLAUDIO', base, task: task() }, async () => { called = true; return cls() })
  expect(called).toBe(false)
  expect(out).toContain('New comment on #42')
})

test('emoji-only ack on a NON-delivered task → deterministic no-op, no LLM', async () => {
  let called = false
  const out = await classifyAndCompose(cfg(), { authorId: 'U_DEREK', base: { ...base, text: '👍' }, task: task({ status: 'in_progress' }) }, async () => { called = true; return cls() })
  expect(called).toBe(false)
  expect(out).toContain('⚪')
})

test('high-confidence change_request → 🟣 verdict + copy-paste command + the raw comment', async () => {
  const out = await classifyAndCompose(cfg(), { authorId: 'U_DEREK', base, task: task() }, async () => cls({ klass: 'change_request', confidence: 0.9 }))
  expect(out).toContain('🟣')
  expect(out).toContain('tracker.mjs release 42')
  expect(out).toContain('make the subhead punchier')
})

test('medium-confidence high-stakes → prose only, NO pre-filled command', async () => {
  const out = await classifyAndCompose(cfg(), { authorId: 'U_DEREK', base, task: task() }, async () => cls({ klass: 'blocker', confidence: 0.6, reason: 'link broken' }))
  expect(out).not.toContain('tracker.mjs')
  expect(out).toMatch(/your read/i)
})

test('approval command is confirm-then-run, never a bare auto-done', () => {
  const cmd = suggestedCommand(cls({ klass: 'approval' }), '12', 'Derek')
  expect(cmd).toContain('tracker.mjs done 12 --claudio')
  expect(cmd).toMatch(/confirm/i)
})

test('composeEnrichedDm always carries the raw comment text (mislabel is fully recoverable)', () => {
  const out = composeEnrichedDm(cls({ klass: 'praise_ack', confidence: 0.9 }), base)
  expect(out).toContain('make the subhead punchier')
})
