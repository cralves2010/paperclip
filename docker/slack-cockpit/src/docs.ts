// The ONLY module that touches Google Docs/Drive. Owns a lazily-built OAuth-as-human
// client (owner = hello@m42hq.com) — a Service Account CANNOT own/create Docs (403
// storageQuotaExceeded), so this is a SEPARATE auth path from the Sheet SA in
// sheets-write.ts (which stays the ONLY Sheet writer). Never used in demo mode.
// Design mirrors sheets-write.ts: every I/O wrapper takes an injected client so tests
// drive it with a plain stub literal (no googleapis import in any test); pure cores
// (marker parse, flatten) are exported + tested on literals.
//
// Auth: OAuth2 refresh-token grant. setCredentials({refresh_token}) is enough —
// googleapis fetches + caches a fresh access token per call. Token minted by
// tools/mint-oauth-token.mjs (scopes: documents + drive.file).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { google } from 'googleapis'
import type { Config } from './config.js'
import type { Comment } from './model.js'

// ── Marker (pure; shared by create-side + dedup-side) ───────────────────────
/** Machine author for the marker comment. Matches tracker.mjs MACHINE_RE (/agent m42/i)
 *  so the Derek comment-sweep AND the Home "your move" digest both treat it as non-human
 *  (cockpit-state.ts lastCommentTurnByTask → 'other'). */
export const DOC_MARKER_AUTHOR = 'Agent M42 (cockpit doc)'
/** Fixed leading token identifying an input-doc marker. Dedup is a cheap startsWith,
 *  so a user pasting a Docs link in an ORDINARY comment is never a false positive. */
export const DOC_MARKER_PREFIX = '📄 Input doc:'

export function docUrl(docId: string): string {
  return `https://docs.google.com/document/d/${docId}/edit`
}
export function docMarkerText(url: string): string {
  return `${DOC_MARKER_PREFIX} ${url}`
}
export function docIdFromUrl(url: string): string | null {
  const m = /\/document\/d\/([A-Za-z0-9_-]+)/.exec(url || '')
  return m ? m[1] : null
}

/** Pure: the input-doc URL for `taskNum` from its comments, or null. Comments arrive
 *  in append (chronological) order, so this returns the FIRST marker — the original doc
 *  of record survives; a rare second marker (double-provision) is the orphan, never
 *  promoted. Only a comment whose text STARTS WITH the marker counts. */
export function findInputDocUrl(comments: Comment[], taskNum: string): string | null {
  for (const c of comments) {
    if (c.taskNum !== taskNum) continue
    if (!c.text.startsWith(DOC_MARKER_PREFIX)) continue
    // Capture the whole Docs URL (incl. the trailing "/edit" the marker stored), not
    // just the id — return the exact link so the "Open input doc" button reuses it verbatim.
    const m = /https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\S*/.exec(c.text)
    if (m) return m[0]
  }
  return null
}

// ── injected-client shapes (tests stub exactly these) ───────────────────────
export interface DocsClient {
  documents: {
    create(params: any): Promise<{ data: { documentId?: string | null } }>
    get(params: any): Promise<{ data: any }>
  }
}
export interface DriveClient {
  permissions: { create(params: any): Promise<{ data: { id?: string | null } }> }
}

function logErr(where: string, err: any, extra = ''): void {
  console.error(`[cockpit] docs ${where} failed:`, err?.code || err?.message || String(err), extra)
}

/** One HTTP-429 retry (mirrors sheets-write.ts withRetry; no backoff at 2-user scale). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    const code = err?.code ?? err?.response?.status ?? err?.status
    if (code === 429) return await fn()
    throw err
  }
}

/** OAuth2 client seeded with the durable refresh token; googleapis auto-refreshes access. */
function oauth(cfg: Config): any {
  const o = new google.auth.OAuth2(cfg.googleOauthClientId, cfg.googleOauthClientSecret)
  o.setCredentials({ refresh_token: cfg.googleOauthRefreshToken })
  return o
}
function realDocs(cfg: Config): DocsClient {
  return google.docs({ version: 'v1', auth: oauth(cfg) }) as unknown as DocsClient
}
function realDrive(cfg: Config): DriveClient {
  return google.drive({ version: 'v3', auth: oauth(cfg) }) as unknown as DriveClient
}

export interface CreatedDoc {
  docId: string
  url: string
}

/** Create an empty Doc (owner = hello@) titled `title`, then share it writer to each
 *  configured email. Title-only: documents.create ignores body content and the human
 *  types into the empty Doc — NO batchUpdate for v1. Sharing is best-effort PER address
 *  (drive.file suffices for an app-created file): a bad email never aborts the others,
 *  a total share failure still returns the doc (owner can always open it). THROWS only
 *  if the create itself fails / returns no id. */
export async function createInputDoc(
  cfg: Config,
  args: { title: string },
  docs: DocsClient = realDocs(cfg),
  drive: DriveClient = realDrive(cfg),
): Promise<CreatedDoc> {
  const res = await withRetry(() => docs.documents.create({ requestBody: { title: args.title } }))
  const docId = res?.data?.documentId ?? ''
  if (!docId) throw new Error('Docs API returned no documentId')
  for (const email of cfg.docShareEmails) {
    try {
      await withRetry(() =>
        drive.permissions.create({
          fileId: docId,
          sendNotificationEmail: false, // link is delivered in Slack; avoid inbox noise
          requestBody: { type: 'user', role: 'writer', emailAddress: email },
        }),
      )
    } catch (err) {
      logErr('share', err, email)
    }
  }
  return { docId, url: docUrl(docId) }
}

/** Read a Doc and flatten to plain text (for a FUTURE doc→sheet sync; NOT wired into
 *  the button flow). body.content is the first tab (includeTabsContent left default),
 *  which all our freshly-created single-tab Docs have. Throws on API failure. */
export async function readTaskDoc(cfg: Config, docId: string, docs: DocsClient = realDocs(cfg)): Promise<string> {
  const res = await withRetry(() => docs.documents.get({ documentId: docId }))
  return flattenDoc(res?.data)
}

// ── Pure flatten core (exported, tested on literals) ────────────────────────
/** Flatten documents.get().data to plain text. Paragraphs: concatenate textRun.content
 *  (each run already carries its own trailing '\n'). Tables: cells joined by ' | ', rows
 *  by '\n', RECURSING into cell content (a cell may hold paragraphs or nested tables). */
export function flattenDoc(doc: any): string {
  return normalize(flattenStructural(doc?.body?.content))
}
function flattenStructural(content: any[] | undefined): string {
  if (!content?.length) return ''
  const parts: string[] = []
  for (const el of content) {
    if (el.paragraph) parts.push((el.paragraph.elements ?? []).map((pe: any) => pe?.textRun?.content ?? '').join(''))
    else if (el.table) parts.push(flattenTable(el.table))
    // sectionBreak / tableOfContents / etc. → skipped
  }
  return parts.join('')
}
function flattenTable(table: any): string {
  const lines: string[] = []
  for (const row of table.tableRows ?? []) {
    const cells = (row.tableCells ?? []).map((cell: any) => flattenStructural(cell.content).replace(/\s*\n\s*/g, ' ').trim())
    lines.push(cells.join(' | '))
  }
  return lines.length ? lines.join('\n') + '\n' : ''
}
// Docs emits two invisible codepoints we normalize: U+E907 (a non-text run placeholder,
// e.g. an inline object) is dropped; U+000B (vertical tab = a soft line break) becomes a
// newline. Built from char codes to keep the source pure-ASCII (no control chars on disk).
const NON_TEXT_RUN = String.fromCharCode(0xe907)
const SOFT_LINE_BREAK = String.fromCharCode(0x0b)
function normalize(s: string): string {
  return s
    .split(NON_TEXT_RUN)
    .join('')
    .split(SOFT_LINE_BREAK)
    .join('\n')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}
