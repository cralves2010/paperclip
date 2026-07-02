import { google } from 'googleapis'
import type { Config } from './config.js'
import type { Task } from './model.js'
import { normalizeStatus } from './normalize.js'

// Resolve a column by ANY of several candidate header names, whitespace- and
// case-insensitive. The live sheet uses spaced headers ("Business / Section",
// "Task #", "Dependency / Blocker") — exact matching silently fails.
function colIndex(headers: string[], candidates: string[]): number {
  const norm = (s: string): string => (s ?? '').replace(/\s+/g, '').toLowerCase()
  const normed = headers.map(norm)
  // Candidate PRIORITY (not sheet order): try each candidate in turn so a
  // preferred header (e.g. "Working Status" over "Status", "Blocked on /
  // waiting for" over "Dependency / Blocker") wins when both exist.
  for (const c of candidates) {
    const i = normed.indexOf(norm(c))
    if (i >= 0) return i
  }
  return -1
}

/**
 * Pure: map the real M42 tracker rows (header row + data rows) into Tasks.
 * Reads ALL companies (v0 decision 2026-07-02: show every Business / Section).
 * Status comes from a maintained "Working Status" column if present, else the
 * real "Status" column (the 06-30 sheet overhaul populates it for all rows).
 */
export function parseRows(rows: string[][]): Task[] {
  if (!rows || rows.length < 2) return []
  const headers = rows[0].map((h) => (h ?? '').trim())

  const iNum = colIndex(headers, ['Task #', 'Task#'])
  const iBiz = colIndex(headers, ['Business / Section', 'Business'])
  const iTitle = colIndex(headers, ['Task'])
  const iOwner = colIndex(headers, ['Owner'])
  const iStatus = colIndex(headers, ['Working Status', 'Status'])
  const iDesc = colIndex(headers, ['Next action', 'Next Action'])
  const iDep = colIndex(headers, ['Blocked on / waiting for', 'Dependency / Blocker', 'Dependency/Blocker'])
  const iDeliv = colIndex(headers, ['Deliverable Link'])
  const iUpdated = colIndex(headers, ['Last Updated', 'Last updated'])

  const cell = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '')
  const tasks: Task[] = []

  for (const row of rows.slice(1)) {
    const company = cell(row, iBiz)
    const title = cell(row, iTitle)
    if (!company || !title) continue // drop banner / spacer / empty rows

    const rawStatus = cell(row, iStatus)
    const link = cell(row, iDeliv)
    const isUrl = /^https?:\/\//i.test(link)
    const isDrive = isUrl && /google\.com/i.test(link)
    const isSlack = isUrl && /slack\.com/i.test(link)
    const lastUpdated = cell(row, iUpdated)
    const ts = lastUpdated ? Date.parse(lastUpdated) : Number.NaN

    tasks.push({
      taskNum: cell(row, iNum),
      company,
      title,
      owner: cell(row, iOwner),
      // Blank status -> queued (never fall through to the in_progress fallback,
      // which would paint not-started tasks blue and flip health to green).
      status: rawStatus ? normalizeStatus(rawStatus) : 'queued',
      rawStatus,
      deliverableDriveUrl: isDrive ? link : undefined,
      deliverableSlackUrl: isSlack ? link : undefined,
      // A valid http(s) link that is neither Drive nor Slack still renders a
      // generic "Open link" button (never emit an unscheme'd URL to Block Kit).
      deliverableOtherUrl: isUrl && !isDrive && !isSlack ? link : undefined,
      description: cell(row, iDesc) || undefined,
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
