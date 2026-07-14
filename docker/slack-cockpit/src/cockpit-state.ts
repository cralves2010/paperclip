// Durable per-user watermark for the "🔔 what changed since you were here" strip.
//
// Stored in a HIDDEN `_CockpitState` Sheet tab (one row per user), NOT the task
// tab — two reasons: (1) it survives a redeploy, so we don't false-flood every
// task as "new" after each deploy (an in-memory Map would); (2) a non-task tab is
// outside the tracker column layout by construction, so it can NEVER corrupt
// Derek's task data. Safe-degrade: a missing/empty tab means "first visit → show
// nothing as new", never a flood.
//
// Row schema: userId | lastSeenIso | lastSeenTs | sessionAnchorTs | snapshotJson

/* eslint-disable @typescript-eslint/no-explicit-any */
import { google } from 'googleapis'
import type { Config } from './config.js'
import { hasDeliverableLink, type CanonicalStatus, type Comment, type Task } from './model.js'

export const COCKPIT_STATE_TAB = '_CockpitState'
export const STATE_HEADER = ['userId', 'lastSeenIso', 'lastSeenTs', 'sessionAnchorTs', 'snapshotJson']

/** How a single task looked at snapshot time — compact (fits ~125 in one cell). */
export interface TaskSnap {
  s: CanonicalStatus // status
  l: boolean // hasDeliverableLink
  c: number // comment count
}
export type Snapshot = Record<string, TaskSnap>

export interface Watermark {
  userId: string
  /** ms of the user's previous visit advance (0 if never seen). */
  lastSeenTs: number
  /** The "new since" line — frozen at the start of a NEW visit (>30m gap). */
  sessionAnchorTs: number
  snapshot: Snapshot
}

/** A single change worth surfacing to the returning user. */
export interface Delta {
  taskNum: string
  company: string
  title: string
  kind: 'into_review' | 'shipped' | 'into_needs' | 'changes' | 'linked' | 'new_task' | 'new_comment' | 'updated'
  needsYou: boolean // did this delta move the task INTO a state that needs the viewer?
}

const NEW_VISIT_GAP_MS = 30 * 60_000

/** Build the compact snapshot of the current board (for storing as the next watermark). */
export function buildSnapshot(tasks: Task[], commentCounts: Map<string, number>): Snapshot {
  const snap: Snapshot = {}
  for (const t of tasks) {
    snap[t.taskNum] = { s: t.status, l: hasDeliverableLink(t), c: commentCounts.get(t.taskNum) ?? 0 }
  }
  return snap
}

/** Whose "move" a comment is — the two principals plus everyone/thing else. */
export type CommentTurn = 'derek' | 'claudio' | 'other'

/**
 * The role of the LATEST comment author per task — used to decide whose "move" a
 * new comment is. Comments arrive in append (chronological) order, so the last
 * one for a task wins. Author is a free-text string carrying the Slack user id
 * (e.g. "@claudio (U08C8QTNBJ9)"), matched by id substring; a machine back-link
 * or an unknown author is 'other' and never triggers a turn hand-off.
 */
export function lastCommentTurnByTask(comments: Comment[], derekId: string, claudioId: string): Map<string, CommentTurn> {
  const latest = new Map<string, string>()
  for (const c of comments) latest.set(c.taskNum, c.author ?? '')
  const out = new Map<string, CommentTurn>()
  for (const [taskNum, author] of latest) {
    out.set(taskNum, author.includes(derekId) ? 'derek' : author.includes(claudioId) ? 'claudio' : 'other')
  }
  return out
}

/**
 * True if `userId` (matched by id substring in the free-text author) authored ANY
 * comment on `taskNum`. Gates the Derek "your move" ping to genuine replies in a
 * thread he is part of: a fresh Claudio note on a task Derek never touched is a
 * private note, not a hand-off, and must not ping him.
 */
export function taskHasCommentFrom(comments: Comment[], taskNum: string, userId: string): boolean {
  return comments.some((c) => c.taskNum === taskNum && (c.author ?? '').includes(userId))
}

/**
 * Diff the current board against the user's last snapshot → the deltas worth a
 * "since you were here" mention. Materiality tiers: a status move INTO a
 * review/decision/shipped state, a delivery gaining its link, a brand-new task,
 * and new comments. A task absent from the snapshot (first visit / new task) is
 * NEW; an empty snapshot yields NOTHING (never a flood on first run).
 *
 * `turn` (optional) drives the two-way comment loop: when a new comment appears,
 * it is flagged needsYou ONLY if the latest comment is from the OTHER principal
 * (Derek sees Claudio's reply as his move, and vice-versa). Omitted → new
 * comments are never a hand-off (the pre-two-way behaviour), so existing callers
 * are unaffected.
 */
export function diffSnapshot(
  tasks: Task[],
  commentCounts: Map<string, number>,
  snap: Snapshot,
  turn?: { lastAuthorByTask: Map<string, CommentTurn>; viewer: CommentTurn },
): Delta[] {
  if (!snap || Object.keys(snap).length === 0) return [] // first visit → nothing is "new"
  const deltas: Delta[] = []
  for (const t of tasks) {
    const prev = snap[t.taskNum]
    const nowC = commentCounts.get(t.taskNum) ?? 0
    if (!prev) {
      deltas.push({ taskNum: t.taskNum, company: t.company, title: t.title, kind: 'new_task', needsYou: t.status === 'needs_you' || t.status === 'delivered_awaiting' })
      continue
    }
    if (prev.s !== t.status) {
      const kind: Delta['kind'] =
        t.status === 'delivered_awaiting' ? 'into_review'
        : t.status === 'done' ? 'shipped'
        : t.status === 'needs_you' ? 'into_needs'
        : t.status === 'changes_requested' ? 'changes'
        : 'updated'
      deltas.push({ taskNum: t.taskNum, company: t.company, title: t.title, kind, needsYou: t.status === 'needs_you' || t.status === 'delivered_awaiting' })
    } else if (!prev.l && hasDeliverableLink(t)) {
      deltas.push({ taskNum: t.taskNum, company: t.company, title: t.title, kind: 'linked', needsYou: t.status === 'delivered_awaiting' })
    } else if (nowC > prev.c) {
      // A new comment is "your move" ONLY when its latest author is the OTHER
      // principal — Derek sees Claudio's reply as his turn, and vice-versa. Your
      // own comment, or a machine/unknown author, is never a hand-off. (Two-way loop.)
      const last = turn?.lastAuthorByTask.get(t.taskNum)
      const needsYou = !!turn && (last === 'derek' || last === 'claudio') && last !== turn.viewer
      deltas.push({ taskNum: t.taskNum, company: t.company, title: t.title, kind: 'new_comment', needsYou })
    }
  }
  return deltas
}

/** True if a task changed since the session anchor (drives the per-row 🆕 badge). */
export function isNewSince(t: Task, anchorTs: number): boolean {
  return typeof t.lastUpdatedTs === 'number' && t.lastUpdatedTs > anchorTs
}

/**
 * Given the stored watermark + now, decide the session anchor: on a NEW visit
 * (>30m since last seen) freeze the anchor at the OLD lastSeen (so the strip shows
 * everything since the previous visit); within an active session keep the anchor
 * stable (a 🔄 five seconds later must not wipe the strip). Returns the anchor to
 * DIFF against + the next lastSeen to store.
 */
export function resolveAnchor(wm: Watermark | null, now: number): { anchorTs: number; isNewVisit: boolean } {
  if (!wm || wm.lastSeenTs === 0) return { anchorTs: now, isNewVisit: true } // first ever → nothing new
  const isNewVisit = now - wm.lastSeenTs > NEW_VISIT_GAP_MS
  return { anchorTs: isNewVisit ? wm.lastSeenTs : wm.sessionAnchorTs, isNewVisit }
}

// ── Sheet I/O ────────────────────────────────────────────────────────────────

function client(cfg: Config): any {
  const auth = new google.auth.GoogleAuth({ keyFile: cfg.googleSaJsonPath, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  return google.sheets({ version: 'v4', auth })
}

/** Ensure the hidden tab exists (idempotent; treats an "already exists" race as success). */
export async function ensureCockpitStateTab(cfg: Config, sheets: any = client(cfg)): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: cfg.sheetId })
  const titles: string[] = (meta?.data?.sheets ?? []).map((s: any) => s?.properties?.title)
  if (titles.includes(COCKPIT_STATE_TAB)) return
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: cfg.sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: COCKPIT_STATE_TAB, hidden: true } } }] },
    })
  } catch (err: any) {
    if (!/already exists/i.test(err?.message ?? '')) throw err
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.sheetId,
    range: `'${COCKPIT_STATE_TAB}'!A1:E1`,
    valueInputOption: 'RAW',
    requestBody: { values: [STATE_HEADER] },
  })
}

/** Parse the state rows → the watermark for one user (null if not present / unreadable). */
export function parseWatermark(rows: string[][], userId: string): Watermark | null {
  for (let r = 1; r < (rows?.length ?? 0); r++) {
    if (((rows[r][0] ?? '') + '').trim() === userId) {
      let snapshot: Snapshot = {}
      try {
        snapshot = JSON.parse(rows[r][4] || '{}')
      } catch {
        snapshot = {}
      }
      return {
        userId,
        lastSeenTs: parseInt((rows[r][2] ?? '0') + '', 10) || 0,
        sessionAnchorTs: parseInt((rows[r][3] ?? '0') + '', 10) || 0,
        snapshot,
      }
    }
  }
  return null
}

export async function readWatermark(cfg: Config, userId: string, sheets: any = client(cfg)): Promise<Watermark | null> {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: cfg.sheetId, range: `'${COCKPIT_STATE_TAB}'!A1:E` })
    return parseWatermark((res?.data?.values ?? []) as string[][], userId)
  } catch {
    return null // tab missing / unreadable → treat as first visit (safe-degrade)
  }
}

/**
 * Write the user's watermark row (append if new, update in place if present).
 * Best-effort: a failure here must never break the Home render (the caller
 * fire-and-forgets it). Snapshot is capped so a runaway board can't overflow the cell.
 */
export async function writeWatermark(cfg: Config, wm: Watermark, sheets: any = client(cfg)): Promise<void> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: cfg.sheetId, range: `'${COCKPIT_STATE_TAB}'!A1:E` })
  const rows = (res?.data?.values ?? []) as string[][]
  const snapJson = JSON.stringify(wm.snapshot).slice(0, 48_000) // one cell holds up to ~50k chars
  const row = [wm.userId, new Date(wm.lastSeenTs).toISOString(), String(wm.lastSeenTs), String(wm.sessionAnchorTs), snapJson]
  let target = -1
  for (let r = 1; r < rows.length; r++) if (((rows[r][0] ?? '') + '').trim() === wm.userId) target = r
  if (target >= 0) {
    await sheets.spreadsheets.values.update({ spreadsheetId: cfg.sheetId, range: `'${COCKPIT_STATE_TAB}'!A${target + 1}:E${target + 1}`, valueInputOption: 'RAW', requestBody: { values: [row] } })
  } else {
    await sheets.spreadsheets.values.append({ spreadsheetId: cfg.sheetId, range: `'${COCKPIT_STATE_TAB}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] } })
  }
}
