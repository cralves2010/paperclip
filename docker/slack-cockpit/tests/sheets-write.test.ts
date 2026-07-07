import { expect, test, vi } from 'vitest'
import {
  appendComment,
  buildTaskRow,
  countTaskNum,
  createTask,
  ensureCommentsTab,
  nextTaskNum,
  writeStatus,
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
  expect(calls.get).toHaveBeenCalledTimes(2) // read at write time + post-append duplicate scan
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

test('countTaskNum counts data rows matching a Task#, tolerant of blanks / whitespace', () => {
  const rows = [
    HEADER,
    ['31', '', 'JRS', '', 'a', '', '', '', '', '', '', '', '', '', ''],
    [' 31 ', '', 'JRS', '', 'b', '', '', '', '', '', '', '', '', '', ''], // whitespace -> still matches
    ['12', '', 'JRS', '', 'c', '', '', '', '', '', '', '', '', '', ''],
  ]
  expect(countTaskNum(rows, 31)).toBe(2)
  expect(countTaskNum(rows, 12)).toBe(1)
  expect(countTaskNum(rows, 99)).toBe(0)
})

test('createTask warns when the post-append re-read finds a duplicate Task# (concurrent create)', async () => {
  const priorRows = [HEADER, ['30', '', 'JRS', '', 'a', '', '', '', '', '', '', '', '', '', '']]
  // Simulate a racing sibling create: the POST-append re-read returns TWO rows
  // carrying the minted number 31.
  const postRows = [
    HEADER,
    ['30', '', 'JRS', '', 'a', '', '', '', '', '', '', '', '', '', ''],
    ['31', '', 'JRS', '', 'mine', '', '', '', '', '', '', '', '', '', ''],
    ['31', '', 'Brightly', '', 'theirs', '', '', '', '', '', '', '', '', '', ''],
  ]
  let getCall = 0
  const calls = { append: vi.fn() }
  const client: SheetsClient = {
    spreadsheets: {
      get: () => Promise.resolve({ data: { sheets: [{ properties: { title: 'Tracker' } }] } }),
      batchUpdate: () => Promise.resolve({ data: {} }),
      values: {
        get: () => {
          getCall += 1
          return Promise.resolve({ data: { values: getCall === 1 ? priorRows : postRows } })
        },
        append: (p: any) => {
          calls.append(p)
          return Promise.resolve({ data: { updatedData: { values: [buildStubRow('31', 'mine')] } } })
        },
        update: () => Promise.resolve({ data: {} }),
      },
    },
  }
  const res = await createTask(cfg(), { business: 'JRS', priority: 'P1', title: 'mine' }, client)
  expect(res.taskNum).toBe(31)
  expect(res.warning).toMatch(/more than once/)
  expect(calls.append).toHaveBeenCalledTimes(1)
})

test('createTask refuses to append when the header layout is unrecognizable', async () => {
  const trackerRows = [
    ['Col A', 'Col B', 'Col C'], // no Task # / Status columns
    ['x', 'y', 'z'],
  ]
  const { client, calls } = stubClient({ trackerRows })
  await expect(createTask(cfg(), { business: 'JRS', priority: 'P1', title: 'nope' }, client)).rejects.toThrow(
    /layout changed/,
  )
  expect(calls.append).not.toHaveBeenCalled() // never wrote a junk row
})

// Helper: a full-width echo row with a given Task# + Title in the real columns.
function buildStubRow(taskNum: string, title: string): string[] {
  const row = new Array(HEADER.length).fill('')
  row[0] = taskNum // Task #
  row[4] = title // Task
  return row
}

// ── writeStatus (Derek's verdict write) ──────────────────────────────────────

/** A data row with Task# (A/0), Title (E/4), Status (J/9), Owner-next (M/12). */
function statusRow(taskNum: string, status: string, ownerNext = 'Derek'): string[] {
  const row = new Array(HEADER.length).fill('')
  row[0] = taskNum
  row[4] = 't' + taskNum
  row[9] = status // Status (J)
  row[12] = ownerNext // Owner-next (M)
  return row
}

/** Range-aware stub: full A1:Z read returns all rows; the single-cell verify read returns that cell. */
function trackerStub(rows: string[][]): { client: SheetsClient; updates: any[] } {
  const updates: any[] = []
  const client: SheetsClient = {
    spreadsheets: {
      get: () => Promise.resolve({ data: { sheets: [{ properties: { title: 'Tracker' } }] } }),
      batchUpdate: () => Promise.resolve({ data: {} }),
      values: {
        get: (p: any) => {
          const range = String(p.range || '')
          if (range.includes('A1:Z')) return Promise.resolve({ data: { values: rows } })
          const m = /!([A-Z])(\d+)$/.exec(range) // single-cell verify read
          if (m) {
            const col = m[1].charCodeAt(0) - 65
            const rowNum = parseInt(m[2], 10)
            return Promise.resolve({ data: { values: [[rows[rowNum - 1]?.[col] ?? '']] } })
          }
          return Promise.resolve({ data: { values: rows } })
        },
        append: () => Promise.resolve({ data: {} }),
        update: (p: any) => {
          updates.push(p)
          return Promise.resolve({ data: {} })
        },
      },
    },
  }
  return { client, updates }
}

test('writeStatus: CAS passes → writes ONLY Status(J)/Next(K)/Updated(N), never Owner-next(M) or A–I', async () => {
  const rows = [HEADER, statusRow('42', 'Delivered — awaiting Derek review')]
  const { client, updates } = trackerStub(rows)
  const res = await writeStatus(cfg(), { taskNum: '42', expect: ['delivered_awaiting'], rawStatus: 'Done', nextAction: 'closing' }, client)
  expect(res.ok).toBe(true)
  const ranges = updates.map((u) => u.range)
  expect(ranges).toContain(`'Tracker'!J2`) // Status
  expect(ranges).toContain(`'Tracker'!K2`) // Next action
  expect(ranges).toContain(`'Tracker'!N2`) // Last updated
  expect(ranges.some((r) => /!M\d/.test(r))).toBe(false) // NEVER Owner-next (Derek's)
  expect(ranges.some((r) => /![A-I]\d/.test(r))).toBe(false) // NEVER A–I (Derek's)
  const jWrite = updates.find((u) => u.range === `'Tracker'!J2`)
  expect(jWrite.requestBody.values[0][0]).toBe('Done')
})

test('writeStatus: CAS ABORTS (writes nothing) when the live status no longer matches the precondition', async () => {
  const rows = [HEADER, statusRow('42', 'Done')] // already moved to Done by someone else
  const { client, updates } = trackerStub(rows)
  const res = await writeStatus(cfg(), { taskNum: '42', expect: ['delivered_awaiting'], rawStatus: 'Done' }, client)
  expect(res.ok).toBe(false)
  expect(res.reason).toBe('precondition')
  expect(res.currentStatus).toBe('done')
  expect(updates).toHaveLength(0) // nothing written on a stale precondition
})

test('writeStatus: not_found and duplicate abort without writing', async () => {
  const nf = trackerStub([HEADER, statusRow('99', 'In Progress')])
  const r1 = await writeStatus(cfg(), { taskNum: '42', expect: ['needs_you'], rawStatus: 'Done' }, nf.client)
  expect(r1.reason).toBe('not_found')
  expect(nf.updates).toHaveLength(0)

  const dup = trackerStub([HEADER, statusRow('42', 'Needs you'), statusRow('42', 'Needs you')])
  const r2 = await writeStatus(cfg(), { taskNum: '42', expect: ['needs_you'], rawStatus: 'Done' }, dup.client)
  expect(r2.reason).toBe('duplicate')
  expect(dup.updates).toHaveLength(0)
})

test('writeStatus: a post-write row-shift (verify cell shows a DIFFERENT Task#) aborts as row_shift, NOT success', async () => {
  const rows = [HEADER, statusRow('42', 'Delivered — awaiting Derek review')]
  const updates: any[] = []
  // Full read returns rows; the single-cell VERIFY read returns a different Task# (row moved).
  const client: SheetsClient = {
    spreadsheets: {
      get: () => Promise.resolve({ data: { sheets: [{ properties: { title: 'Tracker' } }] } }),
      batchUpdate: () => Promise.resolve({ data: {} }),
      values: {
        get: (p: any) =>
          Promise.resolve({
            data: { values: String(p.range || '').includes('A1:Z') ? rows : [['99']] },
          }),
        append: () => Promise.resolve({ data: {} }),
        update: (p: any) => {
          updates.push(p)
          return Promise.resolve({ data: {} })
        },
      },
    },
  }
  const res = await writeStatus(cfg(), { taskNum: '42', expect: ['delivered_awaiting'], rawStatus: 'Done' }, client)
  expect(res.ok).toBe(false) // must SCREAM, never report a wrong-row write as success
  expect(res.reason).toBe('row_shift')
})
