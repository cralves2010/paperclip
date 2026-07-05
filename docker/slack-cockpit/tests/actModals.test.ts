import { expect, test } from 'vitest'
import {
  attributeAuthor,
  buildCommentModal,
  buildCreateModal,
  buildDemoNoticeModal,
  buildDeniedModal,
  parseCommentMetadata,
  validateComment,
} from '../src/views/actModals.js'
import { commentDmText, createDmText } from '../src/notify.js'
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

test('buildCommentModal: comment_submit, required multiline input, metadata round-trip', () => {
  const modal = buildCommentModal({ taskNum: '41', title: 'School sourcing', company: 'JRS', origin: 'modal' })
  expect(modal.callback_id).toBe('comment_submit')
  const json = JSON.stringify(modal)
  expect(json).toContain('"block_id":"comment"')
  expect(json).toContain('"multiline":true')
  // The comment input is NOT optional (required).
  const inputBlock: any = modal.blocks.find((b: any) => b.block_id === 'comment')
  expect(inputBlock.optional).toBeUndefined()
  const meta = parseCommentMetadata(modal.private_metadata)
  expect(meta).toEqual({ taskNum: '41', origin: 'modal' })
})

test('parseCommentMetadata is defensive on garbage', () => {
  expect(parseCommentMetadata(undefined)).toEqual({ taskNum: '', origin: 'home' })
  expect(parseCommentMetadata('not json')).toEqual({ taskNum: '', origin: 'home' })
})

test('validateComment: empty -> error, non-empty -> null', () => {
  expect(validateComment('   ')).toBe('Comment cannot be empty.')
  expect(validateComment('')).toBe('Comment cannot be empty.')
  expect(validateComment('hi')).toBeNull()
})

test('attributeAuthor: name -> @name (id), no name -> id', () => {
  expect(attributeAuthor('U1', 'derek')).toBe('@derek (U1)')
  expect(attributeAuthor('U1')).toBe('U1')
})

test('buildCreateModal derives business + priority options from tasks; required inputs', () => {
  const tasks = [t({ company: 'JRS', priority: 'P0' }), t({ company: 'Brightly', priority: 'P2' })]
  const modal = buildCreateModal(tasks)
  expect(modal.callback_id).toBe('create_task_submit')
  const json = JSON.stringify(modal)
  expect(json).toContain('JRS')
  expect(json).toContain('Brightly')
  expect(json).toContain('P0')
  expect(json).toContain('P2')
  // business / title / priority are required (not optional); notes optional.
  const byId = (id: string): any => modal.blocks.find((b: any) => b.block_id === id)
  expect(byId('business').optional).toBeUndefined()
  expect(byId('title').optional).toBeUndefined()
  expect(byId('priority').optional).toBeUndefined()
  expect(byId('notes').optional).toBe(true)
})

test('buildCreateModal falls back to P0..P3 when no priorities present', () => {
  const modal = buildCreateModal([t({ company: 'JRS', priority: undefined })])
  const json = JSON.stringify(modal)
  for (const p of ['P0', 'P1', 'P2', 'P3']) expect(json).toContain(p)
})

test('demo + denied modals carry the expected copy', () => {
  expect(JSON.stringify(buildDemoNoticeModal('comment'))).toContain('Demo mode')
  expect(JSON.stringify(buildDemoNoticeModal('create'))).toContain('Demo mode')
  expect(JSON.stringify(buildDeniedModal()).toLowerCase()).toContain('private')
})

test('commentDmText / createDmText produce locked copy + spreadsheet link', () => {
  const c = commentDmText({ sheetId: 'SID', taskNum: '41', company: 'JRS', title: 'School', author: '@derek (U1)', text: 'go' })
  expect(c).toContain('💬 New comment on #41')
  expect(c).toContain('@derek (U1)')
  expect(c).toContain('> go')
  expect(c).toContain('https://docs.google.com/spreadsheets/d/SID/edit')

  const cr = createDmText({ sheetId: 'SID', taskNum: 31, title: 'New thing', business: 'JRS', priority: 'P1', author: '@derek (U1)' })
  expect(cr).toContain('➕ New task #31')
  expect(cr).toContain('(JRS, P1)')
  expect(cr).toContain('https://docs.google.com/spreadsheets/d/SID/edit')
})
