import { expect, test, vi } from 'vitest'
import {
  appendComment,
  buildTaskRow,
  createTask,
  ensureCommentsTab,
  nextTaskNum,
  type SheetsClient,
} from '../src/sheets-write.js'
import type { Config } from '../src/config.js'

// Whitespace-y live header (mirrors the real tracker + a couple machine cols).
const HEADER = [
  'Task #', 'Priority Tier', 'Business / Section', 'Applies To', 'Task', 'Owner',
  'Human Backup', 'Type', 'Dependency / Blocker', 'Status', 'Next action',
  'Blocked on / waiting for', 'Owner-next', 'Last updated', 'Deliverable Link',
]

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
  ...o,
})

// Build a stub client whose method behaviour is caller-configurable.
function stubClient(opts: {
  sheetTitles?: string[]
  trackerRows?: string[][]
  appendData?: any
} = {}): { client: SheetsClient; calls: any } {
  const calls = {
    get: vi.fn(),
    append: vi.fn(),
    update: vi.fn(),
    batchUpdate: vi.fn(),
    spreadsheetsGet: vi.fn(),
  }
  const client: SheetsClient = {
    spreadsheets: {
      get: (p: any) => {
        calls.spreadsheetsGet(p)
        return Promise.resolve({
          data: { sheets: (opts.sheetTitles ?? ['Tracker']).map((title) => ({ properties: { title } })) },
        })
      },
      batchUpdate: (p: any) => {
        calls.batchUpdate(p)
        return Promise.resolve({ data: {} })
      },
      values: {
        get: (p: any) => {
          calls.get(p)
          return Promise.resolve({ data: { values: opts.trackerRows ?? [] } })
        },
        append: (p: any) => {
          calls.append(p)
          return Promise.resolve({ data: opts.appendData ?? {} })
        },
        update: (p: any) => {
          calls.update(p)
          return Promise.resolve({ data: {} })
        },
      },
    },
  }
  return { client, calls }
}

test('nextTaskNum = max numeric +1, ignoring blank / non-numeric cells', () => {
  const rows = [
    HEADER,
    ['42', '', 'JRS', '', 'a', '', '', '', '', '', '', '', '', '', ''],
    ['', '', 'JRS', '', 'b', '', '', '', '', '', '', '', '', '', ''], // blank -> skipped
    ['abc', '', 'JRS', '', 'c', '', '', '', '', '', '', '', '', '', ''], // non-numeric -> skipped
    ['7', '', 'JRS', '', 'd', '', '', '', '', '', '', '', '', '', ''],
  ]
  expect(nextTaskNum(rows)).toBe(43)
})

test('buildTaskRow places fields by the whitespace-y header map + defaults', () => {
  const row = buildTaskRow(HEADER, { taskNum: 99, business: 'JRS', priority: 'P1', title: 'New thing', notes: 'do it' })
  expect(row).toHaveLength(HEADER.length)
  expect(row[0]).toBe('99') // Task #
  expect(row[1]).toBe('P1') // Priority Tier
  expect(row[2]).toBe('JRS') // Business / Section
  expect(row[4]).toBe('New thing') // Task
  expect(row[5]).toBe('Agent M42') // Owner default
  expect(row[9]).toBe('Not Started') // Status default
  expect(row[10]).toBe('do it') // Next action = notes
  expect(row[13]).toMatch(/^\d{4}-\d{2}-\d{2}$/) // Last updated = today
  // Untouched cells stay empty.
  expect(row[3]).toBe('')
  expect(row[14]).toBe('')
})

test('appendComment appends exactly one 5-col row (A1:E1), INSERT_ROWS, never updates a data row', async () => {
  const { client, calls } = stubClient({ sheetTitles: ['Tracker', 'Comments'] })
  await appendComment(cfg(), { taskNum: '41', author: 'derek (U1)', text: 'go' }, client)
  expect(calls.append).toHaveBeenCalledTimes(1)
  const p = calls.append.mock.calls[0][0]
  expect(p.range).toMatch(/!A1:E1$/)
  expect(p.insertDataOption).toBe('INSERT_ROWS')
  const row = p.requestBody.values[0]
  expect(row).toHaveLength(5)
  expect(row[1]).toBe('41')
  expect(row[2]).toBe('derek (U1)')
  expect(row[3]).toBe('go')
  expect(row[4]).toBe('') // Seen empty on create
  // Comments tab already present -> no header write.
  expect(calls.update).not.toHaveBeenCalled()
})

test('ensureCommentsTab adds the sheet + header only when the tab is missing', async () => {
  const missing = stubClient({ sheetTitles: ['Tracker'] })
  await ensureCommentsTab(cfg(), missing.client)
  expect(missing.calls.batchUpdate).toHaveBeenCalledTimes(1)
  expect(missing.calls.update).toHaveBeenCalledTimes(1) // header write A1:E1

  const present = stubClient({ sheetTitles: ['Tracker', 'Comments'] })
  await ensureCommentsTab(cfg(), present.client)
  expect(present.calls.batchUpdate).not.toHaveBeenCalled()
  expect(present.calls.update).not.toHaveBeenCalled()
})

test('ensureCommentsTab treats an "already exists" addSheet error as success', async () => {
  const { client, calls } = stubClient({ sheetTitles: ['Tracker'] })
  // Force batchUpdate to throw the race error.
  client.spreadsheets.batchUpdate = (p: any) => {
    calls.batchUpdate(p)
    return Promise.reject(new Error('A sheet with the name "Comments" already exists.'))
  }
  await expect(ensureCommentsTab(cfg(), client)).resolves.toBeUndefined()
  expect(calls.update).toHaveBeenCalledTimes(1) // still writes header after the swallow
})

test('createTask reads then appends one row to the tracker tab; mints max+1', async () => {
  const trackerRows = [
    HEADER,
    ['12', '', 'JRS', '', 'a', '', '', '', '', '', '', '', '', '', ''],
    ['30', '', 'Brightly', '', 'b', '', '', '', '', '', '', '', '', '', ''],
  ]
  const appendData = {
    updatedRange: 'Tracker!A4:O4',
    updatedData: { range: 'Tracker!A4:O4', values: [buildStubRow('31', 'New task')] },
  }
  const { client, calls } = stubClient({ trackerRows, appendData })
  const res = await createTask(cfg(), { business: 'JRS', priority: 'P1', title: 'New task' }, client)
  expect(res.taskNum).toBe(31)
  expect(res.warning).toBeUndefined()
  expect(calls.get).toHaveBeenCalledTimes(1) // read at write time
  expect(calls.append).toHaveBeenCalledTimes(1)
  const p = calls.append.mock.calls[0][0]
  expect(p.range).toMatch(/^'Tracker'!A1$/)
  expect(p.insertDataOption).toBe('INSERT_ROWS')
})

test('createTask surfaces a warning when the echo Task# mismatches', async () => {
  const trackerRows = [HEADER, ['12', '', 'JRS', '', 'a', '', '', '', '', '', '', '', '', '', '']]
  const appendData = {
    updatedData: { values: [buildStubRow('999', 'New task')] }, // wrong Task#
  }
  const { client } = stubClient({ trackerRows, appendData })
  const res = await createTask(cfg(), { business: 'JRS', priority: 'P1', title: 'New task' }, client)
  expect(res.taskNum).toBe(13)
  expect(res.warning).toMatch(/Task#/)
})

// Helper: a full-width echo row with a given Task# + Title in the real columns.
function buildStubRow(taskNum: string, title: string): string[] {
  const row = new Array(HEADER.length).fill('')
  row[0] = taskNum // Task #
  row[4] = title // Task
  return row
}
