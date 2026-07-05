// The ONLY write module for the cockpit. Owns a lazily-constructed full-scope
// (spreadsheets, read+write) Google client — NEVER constructed in demo mode.
// Every I/O wrapper accepts an optional injected client so tests drive it with
// a plain stub literal (no googleapis import in any test).
//
// Invariants (mirroring tools/tracker.mjs):
//  - append-only for new rows (values.append + INSERT_ROWS); NEVER values.update
//    over an existing data row.
//  - Task # is minted by re-reading the tracker AT WRITE TIME (concurrent-create
//    defense) + an echo-verify of the append response.
//  - Only one retry on HTTP 429; no backoff infrastructure (2-user scale).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { google } from 'googleapis'
import type { Config } from './config.js'
import { colIndex } from './sheets.js'

/** Minimal shape of the googleapis Sheets client we use (and tests stub). */
export interface SheetsClient {
  spreadsheets: {
    get(params: any): Promise<any>
    batchUpdate(params: any): Promise<any>
    values: {
      get(params: any): Promise<any>
      append(params: any): Promise<any>
      update(params: any): Promise<any>
    }
  }
}

export interface CreateTaskInput {
  business: string
  priority: string
  title: string
  notes?: string
}

export interface CreatedTask {
  taskNum: number
  warning?: string
}

const COMMENTS_HEADER = ['Timestamp', 'Task #', 'Author', 'Comment', 'Seen']

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Lazily build the real read+write client. Never called in demo (no key there). */
function realClient(cfg: Config): SheetsClient {
  const auth = new google.auth.GoogleAuth({
    keyFile: cfg.googleSaJsonPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth }) as unknown as SheetsClient
}

/** Run fn; on a single HTTP 429 retry once. No backoff (accepted at this scale). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    const code = err?.code ?? err?.response?.status ?? err?.status
    if (code === 429) return await fn()
    throw err
  }
}

// ── Pure cores (exported, tested on literal arrays) ─────────────────────────

/** Max numeric Task # (via the tolerant header map) + 1; non-numeric cells ignored. */
export function nextTaskNum(rows: string[][]): number {
  if (!rows || rows.length === 0) return 1
  const headers = rows[0].map((h) => (h ?? '').trim())
  const iNum = colIndex(headers, ['Task #', 'Task#'])
  let max = 0
  if (iNum >= 0) {
    for (const row of rows.slice(1)) {
      const raw = (row[iNum] ?? '').toString().trim()
      if (/^\d+$/.test(raw)) max = Math.max(max, parseInt(raw, 10))
    }
  }
  return max + 1
}

/** Full-width row sized to `headers`, values placed by the tolerant header map. */
export function buildTaskRow(headers: string[], input: CreateTaskInput & { taskNum: number }): string[] {
  const h = headers.map((x) => (x ?? '').trim())
  const row: string[] = new Array(h.length).fill('')
  const put = (candidates: string[], value: string): void => {
    const i = colIndex(h, candidates)
    if (i >= 0) row[i] = value
  }
  put(['Task #', 'Task#'], String(input.taskNum))
  put(['Business / Section', 'Business'], input.business)
  put(['Priority Tier', 'Priority'], input.priority)
  put(['Task'], input.title)
  put(['Owner'], 'Agent M42')
  put(['Status'], 'Not Started')
  put(['Next action', 'Next Action'], input.notes ?? '')
  put(['Last Updated', 'Last updated'], today())
  return row
}

function echoRow(appendRes: any): { updatedRange?: string; values?: string[][] } {
  const d = appendRes?.data ?? {}
  const updates = d.updates ?? {}
  const updatedData = updates.updatedData ?? d.updatedData ?? {}
  return {
    updatedRange: updates.updatedRange ?? d.updatedRange ?? updatedData.range,
    values: (updatedData.values ?? d.values) as string[][] | undefined,
  }
}

/** Compare the append echo against what we intended; return a warning string or undefined. */
function verifyAppend(
  appendRes: any,
  headers: string[],
  taskNum: number,
  title: string,
  priorRows: string[][],
): string | undefined {
  const warnings: string[] = []
  const echo = echoRow(appendRes)
  const iNum = colIndex(headers, ['Task #', 'Task#'])
  const iTitle = colIndex(headers, ['Task'])
  if (echo.values && echo.values[0]) {
    const wrote = echo.values[0]
    const gotNum = iNum >= 0 ? (wrote[iNum] ?? '').toString().trim() : ''
    const gotTitle = iTitle >= 0 ? (wrote[iTitle] ?? '').toString().trim() : ''
    if (gotNum !== String(taskNum)) warnings.push(`row landed with Task# "${gotNum}" (expected ${taskNum})`)
    if (gotTitle !== title) warnings.push('row landed with an unexpected title')
  }
  // Duplicate-Task# scan against the pre-write snapshot (concurrent create).
  if (iNum >= 0) {
    const dup = priorRows.slice(1).some((rr) => (rr[iNum] ?? '').toString().trim() === String(taskNum))
    if (dup) warnings.push(`Task# ${taskNum} already existed before append (possible concurrent create)`)
  }
  return warnings.length ? warnings.join('; ') : undefined
}

// ── I/O wrappers (injected-client; real client used by default) ─────────────

/**
 * Ensure the Comments tab exists (idempotent). If absent: addSheet + write the
 * A1:E1 header. An 'already exists' race is treated as success. When the tab is
 * already present we return early WITHOUT rewriting the header (never clobber).
 */
export async function ensureCommentsTab(cfg: Config, client: SheetsClient = realClient(cfg)): Promise<void> {
  const res = await client.spreadsheets.get({
    spreadsheetId: cfg.sheetId,
    fields: 'sheets(properties(sheetId,title))',
  })
  const titles: string[] = ((res?.data?.sheets ?? []) as any[]).map((s) => s?.properties?.title ?? '')
  if (titles.some((t) => t === cfg.commentsTab)) return
  try {
    await client.spreadsheets.batchUpdate({
      spreadsheetId: cfg.sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: cfg.commentsTab } } }] },
    })
  } catch (err: any) {
    const msg = err?.message ?? err?.errors?.[0]?.message ?? ''
    if (!/already exists/i.test(msg)) throw err
  }
  await client.spreadsheets.values.update({
    spreadsheetId: cfg.sheetId,
    range: `'${cfg.commentsTab}'!A1:E1`,
    valueInputOption: 'RAW',
    requestBody: { values: [COMMENTS_HEADER] },
  })
}

/**
 * Append ONE comment row to the Comments tab (append-only, never values.update
 * over an existing row). Ensures the tab exists first (idempotent).
 */
export async function appendComment(
  cfg: Config,
  input: { taskNum: string; author: string; text: string },
  client: SheetsClient = realClient(cfg),
): Promise<void> {
  await ensureCommentsTab(cfg, client)
  const row = [new Date().toISOString(), input.taskNum, input.author, input.text, '']
  await withRetry(() =>
    client.spreadsheets.values.append({
      spreadsheetId: cfg.sheetId,
      range: `'${cfg.commentsTab}'!A1:E1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      includeValuesInResponse: true,
      requestBody: { values: [row] },
    }),
  )
}

/**
 * Append a NEW task row to the tracker tab. Reads the tracker at write time to
 * mint the next Task #, builds a full-width row, appends (INSERT_ROWS), then
 * echo-verifies. Returns the minted Task # and an optional warning.
 */
export async function createTask(
  cfg: Config,
  input: CreateTaskInput,
  client: SheetsClient = realClient(cfg),
): Promise<CreatedTask> {
  const readRes = await client.spreadsheets.values.get({
    spreadsheetId: cfg.sheetId,
    range: `'${cfg.trackerTab}'!A1:Z`,
  })
  const rows = ((readRes?.data?.values ?? []) as string[][])
  if (rows.length === 0) {
    throw new Error('tracker came back empty — refusing to append (would corrupt headers)')
  }
  const headers = rows[0].map((h) => (h ?? '').trim())
  const taskNum = nextTaskNum(rows)
  const row = buildTaskRow(headers, { ...input, taskNum })
  const appendRes = await withRetry(() =>
    client.spreadsheets.values.append({
      spreadsheetId: cfg.sheetId,
      range: `'${cfg.trackerTab}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      includeValuesInResponse: true,
      requestBody: { values: [row] },
    }),
  )
  const warning = verifyAppend(appendRes, headers, taskNum, input.title, rows)
  return { taskNum, warning }
}
