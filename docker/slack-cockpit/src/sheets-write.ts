// The ONLY write module for the cockpit. Owns a lazily-constructed full-scope
// (spreadsheets, read+write) Google client — NEVER constructed in demo mode.
// Every I/O wrapper accepts an optional injected client so tests drive it with
// a plain stub literal (no googleapis import in any test).
//
// Invariants (mirroring tools/tracker.mjs):
//  - append-only for new rows (values.append + INSERT_ROWS); NEVER values.update
//    over an existing data row.
//  - Task # is minted by re-reading the tracker AT WRITE TIME, echo-verified
//    against the append response, then re-read AFTER the append to detect a
//    concurrent-create duplicate (nextTaskNum is a read-then-append TOCTOU).
//  - Only one retry on HTTP 429; no backoff infrastructure (2-user scale).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { google } from 'googleapis'
import type { Config } from './config.js'
import type { CanonicalStatus } from './model.js'
import { normalizeStatus } from './normalize.js'
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
function verifyEcho(appendRes: any, headers: string[], taskNum: number, title: string): string | undefined {
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
  return warnings.length ? warnings.join('; ') : undefined
}

/** Count data rows whose Task # cell equals `taskNum` (post-append duplicate scan). */
export function countTaskNum(rows: string[][], taskNum: number): number {
  if (!rows || rows.length === 0) return 0
  const headers = rows[0].map((h) => (h ?? '').trim())
  const iNum = colIndex(headers, ['Task #', 'Task#'])
  if (iNum < 0) return 0
  let n = 0
  for (const row of rows.slice(1)) {
    if ((row[iNum] ?? '').toString().trim() === String(taskNum)) n++
  }
  return n
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
  input: { taskNum: string; author: string; text: string; seen?: string },
  client: SheetsClient = realClient(cfg),
): Promise<void> {
  await ensureCommentsTab(cfg, client)
  // Col E ("Seen") is the comment-sweep watermark. Normally empty (an un-processed
  // comment); a verdict note pre-stamps it terminal so the sweep never re-surfaces
  // an intent the cockpit already actioned.
  const row = [new Date().toISOString(), input.taskNum, input.author, input.text, input.seen ?? '']
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
  // Header-sanity gate (mirrors tools/tracker.mjs load()): if the tracker layout
  // shifted so the key columns are unrecognizable, refuse rather than append a
  // mis-numbered / field-dropped junk row into Derek's source of truth.
  if (colIndex(headers, ['Task #', 'Task#']) < 0 || colIndex(headers, ['Status']) < 0) {
    throw new Error('tracker layout changed (Task #/Status columns not found) — refusing to append')
  }
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
  const warnings: string[] = []
  const echoWarn = verifyEcho(appendRes, headers, taskNum, input.title)
  if (echoWarn) warnings.push(echoWarn)
  // Post-append duplicate scan: nextTaskNum() is a read-then-append TOCTOU, so
  // two racing creates can both mint the same max+1. A duplicate Task # would
  // jam tools/tracker.mjs findRow() (it hard-dies on any number appearing >1×)
  // for the live Claude Code windows, so re-read AFTER the append and confirm
  // the minted number occurs exactly once. Best-effort: a failed re-read must
  // never fail an already-successful append.
  try {
    const postRes = await client.spreadsheets.values.get({
      spreadsheetId: cfg.sheetId,
      range: `'${cfg.trackerTab}'!A1:Z`,
    })
    const postRows = (postRes?.data?.values ?? []) as string[][]
    if (countTaskNum(postRows, taskNum) > 1) {
      warnings.push(
        `Task# ${taskNum} appears more than once after append — likely a concurrent create; de-duplicate it in the sheet before the Claude Code windows touch that number`,
      )
    }
  } catch {
    // swallow: the append succeeded; a verification read failure is not fatal
  }
  return { taskNum, warning: warnings.length ? warnings.join('; ') : undefined }
}

// ── writeStatus: the cockpit's ONLY status-changing write (Derek's verdict buttons) ──
// This is the FIRST values.update the cockpit makes on an existing DATA row, so it
// is deliberately paranoid — it guards Derek's source of truth.

/** 0-based column index -> A1 letter (tracker has < 52 columns). */
function colLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + (i - 26))
}

export interface WriteStatusInput {
  taskNum: string
  /** CAS precondition: the row's CURRENT canonical status must be one of these, else abort. */
  expect: CanonicalStatus[]
  /** Raw Status string to write (must normalize back to the intended canonical status). */
  rawStatus: string
  /** Optional Next-action (col K) to write alongside. */
  nextAction?: string
}

export interface WriteStatusResult {
  ok: boolean
  reason?: 'not_found' | 'duplicate' | 'layout' | 'precondition' | 'row_shift'
  /** Present on a precondition miss — the status the row is ACTUALLY in now. */
  currentStatus?: CanonicalStatus
  /** Non-fatal warning (e.g. a post-write row-shift was detected). */
  warning?: string
  message?: string
}

/**
 * Compare-and-swap status write. Re-reads the tracker at write time, confirms the
 * row's live canonical status still matches `expect` (defends the ≤60s stale cache
 * AND a concurrent tracker.mjs window — a Slack confirm dialog does NOT defend
 * staleness), then writes ONLY the whitelisted cells J(Status)/K(Next)/N(Updated)
 * — never A-I or M (Owner-next, Derek's). Does NOT clear a live claim (respects
 * tracker.mjs "no auto-steal"; the working window sees Done and releases itself).
 */
export async function writeStatus(
  cfg: Config,
  input: WriteStatusInput,
  client: SheetsClient = realClient(cfg),
): Promise<WriteStatusResult> {
  const read = await client.spreadsheets.values.get({ spreadsheetId: cfg.sheetId, range: `'${cfg.trackerTab}'!A1:Z` })
  const rows = (read?.data?.values ?? []) as string[][]
  if (rows.length === 0) return { ok: false, reason: 'layout', message: 'tracker came back empty' }
  const headers = rows[0].map((h) => (h ?? '').trim())
  const iTask = colIndex(headers, ['Task #', 'Task#'])
  const iStatus = colIndex(headers, ['Status'])
  const iNext = colIndex(headers, ['Next action', 'Next Action'])
  const iUpdated = colIndex(headers, ['Last Updated', 'Last updated'])
  if (iTask < 0 || iStatus < 0 || iUpdated < 0) {
    return { ok: false, reason: 'layout', message: 'Task #/Status/Last-updated columns not found — layout changed' }
  }

  // Defense-in-depth: the three write targets MUST be the Status/Next/Updated
  // columns and NOTHING else. If a header rename ever collided a protected column
  // (Task #, Business, Task, Owner, Priority, Owner-next) onto one of those three
  // names, refuse rather than write onto Derek's data. Makes "never A-I / never M"
  // an ENFORCED invariant, not just an observation about the current layout.
  const protectedIdx = new Set(
    [
      iTask,
      colIndex(headers, ['Business / Section', 'Business']),
      colIndex(headers, ['Task']),
      colIndex(headers, ['Owner']),
      colIndex(headers, ['Priority Tier', 'Priority']),
      colIndex(headers, ['Owner-next']),
    ].filter((x) => x >= 0),
  )
  for (const w of [iStatus, iNext, iUpdated]) {
    if (w >= 0 && protectedIdx.has(w)) {
      return { ok: false, reason: 'layout', message: 'a protected column resolved onto a write target — refusing to write' }
    }
  }

  const hits: number[] = []
  for (let r = 1; r < rows.length; r++) {
    if (((rows[r][iTask] ?? '') + '').trim() === String(input.taskNum).trim()) hits.push(r)
  }
  if (hits.length === 0) return { ok: false, reason: 'not_found' }
  if (hits.length > 1) return { ok: false, reason: 'duplicate', message: `Task# ${input.taskNum} appears ${hits.length}×` }
  const r = hits[0]

  // CAS precondition — the live canonical status must still match what the button was shown for.
  const current = normalizeStatus(((rows[r][iStatus] ?? '') + '').trim())
  if (!input.expect.includes(current)) return { ok: false, reason: 'precondition', currentStatus: current }

  const rowNum = r + 1
  const put = (colIdx: number, value: string) =>
    withRetry(() =>
      client.spreadsheets.values.update({
        spreadsheetId: cfg.sheetId,
        range: `'${cfg.trackerTab}'!${colLetter(colIdx)}${rowNum}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
      }),
    )

  await put(iStatus, input.rawStatus)
  if (input.nextAction != null && iNext >= 0) await put(iNext, input.nextAction)
  await put(iUpdated, today())

  // Row-shift defense: confirm the row we wrote still carries this Task#.
  try {
    const check = await client.spreadsheets.values.get({ spreadsheetId: cfg.sheetId, range: `'${cfg.trackerTab}'!${colLetter(iTask)}${rowNum}` })
    const got = ((check?.data?.values?.[0]?.[0] ?? '') + '').trim()
    if (got !== String(input.taskNum).trim()) {
      // A row shifted between the write-time read and the writes — the updates may
      // have landed on the WRONG task's cells. Match tracker.mjs verifyRow: SCREAM,
      // never report success. The caller halts and a human verifies the Sheet.
      return { ok: false, reason: 'row_shift', message: `post-write row now shows Task# "${got}" (expected ${input.taskNum}) — a row-shift may have hit the wrong row; verify the Sheet` }
    }
  } catch {
    // a verification read failure is not fatal; the write already succeeded.
  }
  return { ok: true }
}
