import { google } from 'googleapis'
import type { Config } from './config.js'
import type { Task } from './model.js'
import { normalizeStatus } from './normalize.js'

/** v0 prototype scope: only these two companies. */
const V0_COMPANIES = new Set(['JRS', 'Brightly'])

function colIndex(headers: string[], name: string): number {
  return headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
}

/** Pure: map raw sheet rows (header row + data rows) into Tasks. Testable offline. */
export function parseRows(rows: string[][]): Task[] {
  if (!rows || rows.length < 2) return []
  const headers = rows[0].map((h) => (h ?? '').trim())
  const iNum = colIndex(headers, 'Task#')
  const iBiz = colIndex(headers, 'Business')
  const iTitle = colIndex(headers, 'Task')
  const iOwner = colIndex(headers, 'Owner')
  const iDep = colIndex(headers, 'Dependency/Blocker')
  const iStatus = colIndex(headers, 'Working Status')
  const iDeliv = colIndex(headers, 'Deliverable Link')
  const iUpdated = colIndex(headers, 'Last Updated')

  const cell = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '')
  const tasks: Task[] = []

  for (const row of rows.slice(1)) {
    const company = cell(row, iBiz)
    if (!V0_COMPANIES.has(company)) continue

    const rawStatus = cell(row, iStatus)
    const link = cell(row, iDeliv)
    const isDrive = /google\.com/i.test(link)
    const isSlack = /slack\.com/i.test(link)
    const lastUpdated = cell(row, iUpdated)
    const ts = lastUpdated ? Date.parse(lastUpdated) : Number.NaN

    tasks.push({
      taskNum: cell(row, iNum),
      company,
      title: cell(row, iTitle),
      owner: cell(row, iOwner),
      status: normalizeStatus(rawStatus),
      rawStatus,
      deliverableDriveUrl: isDrive ? link : undefined,
      deliverableSlackUrl: isSlack ? link : undefined,
      dependency: cell(row, iDep) || undefined,
      lastUpdated: lastUpdated || undefined,
      lastUpdatedTs: Number.isNaN(ts) ? undefined : ts,
    })
  }
  return tasks
}

/** I/O: read the tracker Sheet (read-only) then parseRows. */
export async function fetchTasks(cfg: Config): Promise<Task[]> {
  const auth = new google.auth.GoogleAuth({
    keyFile: cfg.googleSaJsonPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.sheetId,
    range: cfg.sheetRange,
  })
  return parseRows((res.data.values as string[][]) ?? [])
}
