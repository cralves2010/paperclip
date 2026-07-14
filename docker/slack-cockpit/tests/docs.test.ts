import { expect, test, vi } from 'vitest'
import {
  createInputDoc,
  readTaskDoc,
  flattenDoc,
  findInputDocUrl,
  docUrl,
  docMarkerText,
  docIdFromUrl,
  DOC_MARKER_PREFIX,
  type DocsClient,
  type DriveClient,
} from '../src/docs.js'
import type { Config } from '../src/config.js'
import type { Comment } from '../src/model.js'

const cfg = (o: Partial<Config> = {}): Config => ({
  slackBotToken: 'x',
  slackAppToken: 'x',
  demo: false,
  googleSaJsonPath: '/nope.json',
  sheetId: 'SID',
  sheetRange: 'A1:Z',
  allowlist: ['U1'],
  notifyUserId: 'U1',
  commentsTab: 'Comments',
  trackerTab: 'Tracker',
  classifyEnabled: false,
  anthropicApiKey: '',
  googleOauthClientId: 'cid',
  googleOauthClientSecret: 'sec',
  googleOauthRefreshToken: 'rt',
  docShareEmails: [],
  ...o,
})

const cmt = (taskNum: string, text: string): Comment => ({ timestamp: '', taskNum, author: 'a', text, seen: '' })

test('docUrl / docMarkerText / docIdFromUrl round-trip', () => {
  expect(docUrl('DID')).toBe('https://docs.google.com/document/d/DID/edit')
  expect(docMarkerText(docUrl('DID'))).toBe(`${DOC_MARKER_PREFIX} https://docs.google.com/document/d/DID/edit`)
  expect(docIdFromUrl(docUrl('DID'))).toBe('DID')
  expect(docIdFromUrl('not a doc url')).toBeNull()
})

test('findInputDocUrl: task marker wins; other-task + pasted-link ignored; first marker wins', () => {
  const url1 = docUrl('D1')
  const url2 = docUrl('D2')
  const comments = [
    cmt('1', 'normal comment with a link ' + url1), // NOT a marker (doesn't start with the prefix)
    cmt('2', docMarkerText(docUrl('OTHER'))), // marker on a different task
    cmt('1', docMarkerText(url1)), // first marker on task 1 → the one of record
    cmt('1', docMarkerText(url2)), // later marker (must NOT win)
  ]
  expect(findInputDocUrl(comments, '1')).toBe(url1)
  expect(findInputDocUrl(comments, '3')).toBeNull()
  expect(findInputDocUrl([cmt('1', 'no marker here ' + url1)], '1')).toBeNull()
})

test('flattenDoc: paragraphs keep newlines; a table renders "a | b" rows; empty → ""', () => {
  const content = [
    { paragraph: { elements: [{ textRun: { content: 'Hello\n' } }] } },
    {
      table: {
        tableRows: [
          {
            tableCells: [
              { content: [{ paragraph: { elements: [{ textRun: { content: 'A\n' } }] } }] },
              { content: [{ paragraph: { elements: [{ textRun: { content: 'B\n' } }] } }] },
            ],
          },
        ],
      },
    },
  ]
  expect(flattenDoc({ body: { content } })).toBe('Hello\nA | B')
  expect(flattenDoc({})).toBe('')
  expect(flattenDoc({ body: { content: [] } })).toBe('')
})

test('createInputDoc: create by title, share each email (writer, no notification), return {docId,url}', async () => {
  const create = vi.fn().mockResolvedValue({ data: { documentId: 'DID123' } })
  const permCreate = vi.fn().mockResolvedValue({ data: { id: 'p' } })
  const docs = { documents: { create, get: vi.fn() } } as unknown as DocsClient
  const drive = { permissions: { create: permCreate } } as unknown as DriveClient
  const res = await createInputDoc(cfg({ docShareEmails: ['a@x.com', 'b@y.com'] }), { title: 'JRS-42 — input' }, docs, drive)
  expect(res).toEqual({ docId: 'DID123', url: 'https://docs.google.com/document/d/DID123/edit' })
  expect(create.mock.calls[0][0]).toEqual({ requestBody: { title: 'JRS-42 — input' } })
  expect(permCreate).toHaveBeenCalledTimes(2)
  expect(permCreate.mock.calls[0][0]).toMatchObject({
    fileId: 'DID123',
    sendNotificationEmail: false,
    requestBody: { type: 'user', role: 'writer', emailAddress: 'a@x.com' },
  })
})

test('createInputDoc: no share emails → zero permission calls, doc still returned', async () => {
  const create = vi.fn().mockResolvedValue({ data: { documentId: 'D' } })
  const permCreate = vi.fn()
  const docs = { documents: { create, get: vi.fn() } } as unknown as DocsClient
  const drive = { permissions: { create: permCreate } } as unknown as DriveClient
  const res = await createInputDoc(cfg({ docShareEmails: [] }), { title: 't' }, docs, drive)
  expect(res.docId).toBe('D')
  expect(permCreate).not.toHaveBeenCalled()
})

test('createInputDoc: one bad share does not throw or block the others', async () => {
  const create = vi.fn().mockResolvedValue({ data: { documentId: 'D' } })
  const permCreate = vi
    .fn()
    .mockRejectedValueOnce(new Error('invalid grantee'))
    .mockResolvedValueOnce({ data: { id: 'p2' } })
  const docs = { documents: { create, get: vi.fn() } } as unknown as DocsClient
  const drive = { permissions: { create: permCreate } } as unknown as DriveClient
  const res = await createInputDoc(cfg({ docShareEmails: ['bad@x.com', 'ok@y.com'] }), { title: 't' }, docs, drive)
  expect(res.docId).toBe('D')
  expect(permCreate).toHaveBeenCalledTimes(2) // did not abort after the first failed
})

test('createInputDoc: no documentId → throws', async () => {
  const docs = { documents: { create: vi.fn().mockResolvedValue({ data: {} }), get: vi.fn() } } as unknown as DocsClient
  const drive = { permissions: { create: vi.fn() } } as unknown as DriveClient
  await expect(createInputDoc(cfg(), { title: 't' }, docs, drive)).rejects.toThrow(/no documentId/)
})

test('readTaskDoc: get by id, flattened', async () => {
  const get = vi.fn().mockResolvedValue({
    data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Line one\n' } }] } }] } },
  })
  const docs = { documents: { create: vi.fn(), get } } as unknown as DocsClient
  expect(await readTaskDoc(cfg(), 'DID', docs)).toBe('Line one')
  expect(get.mock.calls[0][0]).toEqual({ documentId: 'DID' })
})
