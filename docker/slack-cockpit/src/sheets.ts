import { google } from 'googleapis'
import type { Config } from './config.js'
import type { Comment, Task } from './model.js'
import { normalizeStatus } from './normalize.js'

// Resolve a column by ANY of several candidate header names, whitespace- and
// case-insensitive. The live sheet uses spaced headers ("Business / Section",
// "Task #", "Dependency / Blocker") — exact matching silently fails.
// Exported so the write layer (sheets-write.ts) reuses the SAME tolerant mapper.
export function colIndex(headers: string[], candidates: string[]): number {
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
 * Status comes ONLY from the real "Status" column — a stray "Working Status"
 * column must never silently shadow it (pivot Day-0 hardening, 2026-07-03).
 */
export function parseRows(rows: string[][]): Task[] {
  if (!rows || rows.length < 2) return []
  const headers = rows[0].map((h) => (h ?? '').trim())

  const iNum = colIndex(headers, ['Task #', 'Task#'])
  const iBiz = colIndex(headers, ['Business / Section', 'Business'])
  const iTitle = colIndex(headers, ['Task'])
  const iOwner = colIndex(headers, ['Owner'])
  const iStatus = colIndex(headers, ['Status'])
  // Derek's column (col M): who the next move is on. The cockpit only READS it.
  const iOwnerNext = colIndex(headers, ['Owner-next', 'Owner next'])
  const iPriority = colIndex(headers, ['Priority Tier', 'Priority'])
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
      ownerNext: cell(row, iOwnerNext) || undefined,
      priority: cell(row, iPriority) || undefined,
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
  const rows = (res.data.values as string[][]) ?? []
  // Row-count visibility: a silent truncation (bounded range) or an empty
  // parse must be diagnosable from `docker logs` alone.
  console.log(`[cockpit] tracker fetch: ${rows.length} rows`)
  return parseRows(rows)
}

/**
 * Pure: map the Comments tab rows (header row + data rows) into Comments.
 * Header A–E: Timestamp | Task # | Author | Comment | Seen. Tolerant of
 * whitespace-y headers via colIndex; rows with an empty Task # are dropped.
 */
export function parseComments(rows: string[][]): Comment[] {
  if (!rows || rows.length < 2) return []
  const headers = rows[0].map((h) => (h ?? '').trim())
  const iTs = colIndex(headers, ['Timestamp', 'Time'])
  const iTask = colIndex(headers, ['Task #', 'Task#', 'Task'])
  const iAuthor = colIndex(headers, ['Author'])
  const iText = colIndex(headers, ['Comment', 'Text'])
  const iSeen = colIndex(headers, ['Seen'])
  const cell = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '')
  const out: Comment[] = []
  for (const row of rows.slice(1)) {
    const taskNum = cell(row, iTask)
    if (!taskNum) continue
    out.push({
      timestamp: cell(row, iTs),
      taskNum,
      author: cell(row, iAuthor),
      text: cell(row, iText),
      seen: cell(row, iSeen),
    })
  }
  return out
}

/** Pure: count comments per Task # (keyed by the raw taskNum string). */
export function commentCountByTask(comments: Comment[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of comments) m.set(c.taskNum, (m.get(c.taskNum) ?? 0) + 1)
  return m
}

/**
 * I/O: read the Comments tab (read-only client). A missing tab (never created
 * yet) must NEVER fail a Home render — swallow to [].
 */
export async function fetchComments(cfg: Config): Promise<Comment[]> {
  const auth = new google.auth.GoogleAuth({
    keyFile: cfg.googleSaJsonPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.sheetId,
      range: `'${cfg.commentsTab}'!A1:E`,
    })
    const rows = (res.data.values as string[][]) ?? []
    return parseComments(rows)
  } catch {
    // Tab absent / not shared yet — comments are an additive layer, not required.
    return []
  }
}
