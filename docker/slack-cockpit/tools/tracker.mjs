#!/usr/bin/env node
// tracker.mjs — M42 Central Task Tracker claim/status CLI (multi-window coordination).
// Day-0 tooling of the Claude Code execution pivot (2026-07-03).
// Every Claude Code window that works a tracker task claims/updates/releases through
// this script so Derek's Sheet (and the Slack cockpit reading it) stays truthful.
//
// Commands:
//   node tracker.mjs init                                  add machine headers O/P/Q (idempotent)
//   node tracker.mjs claims                                list active claims (+stale flags)
//   node tracker.mjs row <task#>                           show one row
//   node tracker.mjs comments <task#>                      read-only: list Comments-tab entries for a task
//   node tracker.mjs comment-sweep [--all] [--json]        read-only: unprocessed comments (Derek by default)
//        [--include-seen] [--task <N>]                     joined to their parent task, for /m42-comment-sweep
//   node tracker.mjs match --text "<message>" [--json] [--top N]   read-only: fuzzy ask→Task# retrieval
//        ("is this ask already covered by a task?" against the LIVE sheet — dedup check for any skill)
//   node tracker.mjs radar [--json]                        read-only: STATELESS neglect radar (verdict backlog,
//        aging reviews/blocks, stale claims, missing links, comment backlog, unclaimed new, log pulse)
//   node tracker.mjs create --claudio (--from-comment '#<t>@<ISO>' | --from-slack '<chan>@<ts>' | --standalone)
//        --business "<b>" --title "<t>" [--priority "<p>"] [--next "<sentence>"]   mint a new task (dup Task# = hard stop)
//   node tracker.mjs comment-add <task#> --text "<t>" [--author "<machine>"]       machine back-link (self-stamps Seen;
//        [--allow-dup]                                                             same-task dup text/slack-token = no-op)
//   node tracker.mjs mark-seen --key '#<t>@<ISO>' --state '<token>' [--force]      stamp a comment's Seen watermark
//   node tracker.mjs state-get <key> [--json]                                      read one _CockpitState KV row (intake:*/followup:*)
//   node tracker.mjs state-set <key> (--value '<s>' | --value-file <p>)            CAS upsert of ONE _CockpitState row
//        [--if-value '<expected>' | --if-value-file <p> | --if-absent]             (namespace-guarded; sweep-lock and cockpit
//        [--window cc-<slug>]                                                      userId rows unreachable through this path)
//   node tracker.mjs sweep-lock acquire|release [--window cc-<slug>]               serialize concurrent sweeps
//   node tracker.mjs claim <task#> --window cc-<slug> [--force]
//   node tracker.mjs heartbeat <task#> --window cc-<slug>
//   node tracker.mjs release <task#> --window cc-<slug> --status "<status>"
//        [--link <url>] [--next "<one Derek-readable sentence>"]
//        (--sop <vault-path> | --no-sop "<reason>")
//   node tracker.mjs done <task#> --claudio [--link <url>]   Done is Claudio-only
//   node tracker.mjs link <task#> --url <url> [--force]      attach/backfill Deliverable Link ONLY (no status change)
//
// Hard rules ENFORCED HERE (not prose):
//  - single-row writes only; whitelist J(Status) K(Next action) N(Last updated)
//    O(Claimed By) P(Claim TS) Q(Deliverable Link) — columns A-I and M are never touched
//  - `link` writes ONLY Q (Deliverable Link) — never status/date/claim — so a
//    deliverable can be attached to a Waiting/blocked/drafted task without
//    misstating its state; refuses to overwrite an existing link without --force
//  - exact status vocabulary (the cockpit's normalizeStatus mislabels anything else)
//  - row located by Task# AT WRITE TIME + post-write Task#-echo verify (row-shift defense)
//  - no auto-steal: a foreign claim needs --force, and --force is only used after Claudio's OK
//  - windows never write "Done" (reserved to Claudio via the done command)
//  - audit trail appended to ~/.m42/tracker-log.jsonl

import { google } from 'googleapis'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SHEET_ID = '1K2YFr0GbjrUinVfcADkEBU94C071zGCJ5aS0dFeVH8A'
const TAB = 'Tracker'
const KEY = process.env.TRACKER_SA_JSON || path.join(os.homedir(), '.m42', 'm42-cockpit-sa.json')
const LOG = path.join(os.homedir(), '.m42', 'tracker-log.jsonl')
const STALE_HOURS = 3

// Cockpit-safe vocabulary. normalizeStatus in the sidecar maps ONLY these reliably;
// improvised strings render as wrong statuses on Derek's cockpit (verified 2026-07-03).
const isValidStatus = (s) =>
  ['Not Started', 'In Progress', 'Delivered — awaiting Derek review'].includes(s) ||
  /^Blocked — .{3,}/.test(s)

const MACHINE_HEADERS = ['Claimed By', 'Claim TS', 'Deliverable Link']

function die(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}
function audit(entry) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true })
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
}
function colLetter(i) {
  // 0-based index -> A1 letter (sheet has < 26*2 cols)
  return i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + (i - 26))
}
function nowIso() {
  return new Date().toISOString()
}
function today() {
  return new Date().toISOString().slice(0, 10)
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv
  const pos = []
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const k = rest[i].slice(2)
      const next = rest[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[k] = next
        i++
      } else flags[k] = true
    } else pos.push(rest[i])
  }
  return { cmd, pos, flags }
}

async function sheetsClient(write) {
  if (!fs.existsSync(KEY)) die(`SA key not found at ${KEY} (set TRACKER_SA_JSON)`)
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY,
    scopes: [
      write
        ? 'https://www.googleapis.com/auth/spreadsheets'
        : 'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  })
  return google.sheets({ version: 'v4', auth })
}

async function load(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A1:Z`,
  })
  const rows = res.data.values ?? []
  if (rows.length < 2) die('sheet came back (near-)empty — refusing to operate')
  const headers = rows[0].map((h) => (h ?? '').trim())
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase()
  const idx = (name) => headers.findIndex((h) => norm(h) === norm(name))
  const cols = {
    task: idx('Task #'),
    title: idx('Task'),
    business: idx('Business / Section'),
    status: idx('Status'),
    next: idx('Next action'),
    updated: idx('Last updated'),
    claimedBy: idx('Claimed By'),
    claimTs: idx('Claim TS'),
    link: idx('Deliverable Link'),
    // Read-only for the radar: the capped buckets use it so a P0 is never the row
    // that gets folded into the "+N mais" counter. Optional on purpose, every
    // consumer must tolerate -1 (see priorityOf).
    priority: idx('Priority Tier') >= 0 ? idx('Priority Tier') : idx('Priority'),
  }
  if (cols.task < 0 || cols.status < 0 || cols.updated < 0)
    die('Derek columns (Task #/Status/Last updated) not found — tab layout changed, STOP and tell Claudio')
  return { rows, headers, cols }
}

function findRow(data, taskNum) {
  const hits = []
  for (let r = 1; r < data.rows.length; r++) {
    if (((data.rows[r][data.cols.task] ?? '') + '').trim() === String(taskNum).trim()) hits.push(r)
  }
  if (hits.length === 0) die(`Task# ${taskNum} not found`)
  if (hits.length > 1)
    die(`Task# ${taskNum} appears ${hits.length}× (rows ${hits.map((r) => r + 1).join(', ')}) — duplicate Task#, STOP and tell Claudio`)
  return hits[0] // 0-based index into rows; sheet row = +1
}

async function writeCell(sheets, rowIdx, colIdx, value) {
  const range = `${TAB}!${colLetter(colIdx)}${rowIdx + 1}`
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  })
}

// Post-write row-shift defense: re-read Task# cell and the claim cell.
async function verifyRow(sheets, data, rowIdx, taskNum, expectClaimedBy) {
  await new Promise((r) => setTimeout(r, 2500))
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!${colLetter(data.cols.task)}${rowIdx + 1}:${colLetter(data.cols.claimTs)}${rowIdx + 1}`,
  })
  const row = (res.data.values ?? [[]])[0] ?? []
  const gotTask = ((row[0] ?? '') + '').trim()
  if (gotTask !== String(taskNum).trim())
    die(`ROW SHIFT DETECTED after write (expected Task# ${taskNum} at row ${rowIdx + 1}, found "${gotTask}"). Tell Claudio before doing anything else.`)
  if (expectClaimedBy !== undefined) {
    const got = ((row[data.cols.claimedBy - data.cols.task] ?? '') + '').trim()
    if (got !== expectClaimedBy)
      die(`claim verify failed: Claimed By is "${got}", expected "${expectClaimedBy}"`)
  }
}

function lintNext(text) {
  if (text.length > 200) die('--next too long (>200 chars) — one Derek-readable sentence only')
  if (/cc-\w+|[A-Za-z]:\\|\.jsonl|\.mjs|node |tracker\.|%USERPROFILE%/i.test(text))
    die('--next failed lint: no window slugs, paths or tooling jargon in Derek-facing cells')
}

function claimAge(tsStr) {
  const t = Date.parse(tsStr)
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 3.6e6
}

// ---- sweep lock (shared by sweep-lock and create) ----
// Lock row in the hidden _CockpitState tab (inert to the cockpit: its userId
// lookup never matches 'comment-sweep-lock'). A lock older than 15 min is
// stale and auto-reclaimable.
const STATE_TAB = '_CockpitState'
const SWEEP_LOCK_KEY = 'comment-sweep-lock'

function anonWindow() {
  // Unique per invocation: two anonymous windows must NEVER share a slug —
  // the lock treats same-slug as the same window and would let them interleave.
  return 'cc-anon-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0')
}

async function readSweepLock(sheets) {
  let rows
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A1:C` })
    rows = res.data.values ?? []
  } catch (err) {
    if (/unable to parse range/i.test(String(err?.message ?? err))) die(`${STATE_TAB} tab missing — open the cockpit once to create it`)
    throw err
  }
  let lockRow = -1
  for (let i = 1; i < rows.length; i++) if (((rows[i][0] ?? '') + '').trim() === SWEEP_LOCK_KEY) { lockRow = i; break }
  return { rows, lockRow }
}

async function acquireSweepLock(sheets, win) {
  const { rows, lockRow } = await readSweepLock(sheets)
  if (lockRow >= 0) {
    const heldIso = ((rows[lockRow][1] ?? '') + '').trim()
    const heldWin = ((rows[lockRow][2] ?? '') + '').trim()
    const ageMin = heldIso ? (Date.now() - Date.parse(heldIso)) / 60000 : 999
    if (heldIso && ageMin < 15 && heldWin !== win)
      die(`sweep already running in window "${heldWin}" (${ageMin.toFixed(1)}m ago) — wait, or run from that window`)
  }
  const target = lockRow >= 0 ? lockRow : rows.length
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A${target + 1}:C${target + 1}`, valueInputOption: 'RAW', requestBody: { values: [[SWEEP_LOCK_KEY, nowIso(), win]] } })
}

async function releaseSweepLock(sheets) {
  const { lockRow } = await readSweepLock(sheets)
  if (lockRow >= 0)
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A${lockRow + 1}:C${lockRow + 1}`, valueInputOption: 'RAW', requestBody: { values: [['', '', '']] } })
}

// ---- tolerant Comments-tab loader (shared by the read-only match/radar) ----
// Absent tab is a NORMAL state (returns null) — same contract as `comments`:
// only "unable to parse range" means missing; anything else dies loudly so an
// outage is never mistaken for an empty tab.
async function loadComments(sheets) {
  let cRows
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'Comments'!A1:F` })
    cRows = res.data.values ?? []
  } catch (err) {
    const msg = String(err?.message ?? err)
    if (!/unable to parse range/i.test(msg)) die(`comments read failed: ${msg}`)
    return null
  }
  const h = (cRows[0] ?? []).map((x) => (x ?? '').trim())
  const n = (s) => s.replace(/\s+/g, '').toLowerCase()
  const ix = (...names) => { for (const nm of names) { const i = h.findIndex((x) => n(x) === n(nm)); if (i >= 0) return i } return -1 }
  return {
    rows: cRows,
    iTs: ix('Timestamp', 'Time'),
    iTask: ix('Task #', 'Task#', 'Task'),
    iAuthor: ix('Author'),
    iText: ix('Comment', 'Text'),
    iSeen: ix('Seen'),
    cell: (row, i) => (i >= 0 ? ((row?.[i] ?? '') + '').trim() : ''),
  }
}

const { cmd, pos, flags } = parseArgs(process.argv.slice(2))

if (!cmd || flags.help) {
  console.log('usage: tracker.mjs init|claims|row|comments|comment-sweep|match|radar|create|comment-add|mark-seen|sweep-lock|claim|heartbeat|release|done|link  (see file header)')
  process.exit(0)
}

const needsWrite = ['init', 'claim', 'heartbeat', 'release', 'done', 'link', 'create', 'mark-seen', 'comment-add', 'sweep-lock', 'state-set'].includes(cmd)
const sheets = await sheetsClient(needsWrite)
const data = await load(sheets)

if (cmd === 'init') {
  // Idempotent: add machine headers right after Derek's last column.
  const missing = MACHINE_HEADERS.filter((h) => !data.headers.some((x) => x.trim() === h))
  if (missing.length === 0) {
    console.log('✓ machine columns already present:', MACHINE_HEADERS.join(', '))
    process.exit(0)
  }
  let start = data.headers.length
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!${colLetter(start)}1:${colLetter(start + missing.length - 1)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [missing] },
  })
  audit({ cmd, added: missing })
  console.log(`✓ added machine headers: ${missing.join(', ')}`)
  process.exit(0)
}

if (cmd === 'claims') {
  if (data.cols.claimedBy < 0) die('machine columns missing — run: tracker.mjs init')
  let any = false
  for (let r = 1; r < data.rows.length; r++) {
    const who = ((data.rows[r][data.cols.claimedBy] ?? '') + '').trim()
    if (!who) continue
    any = true
    const ts = ((data.rows[r][data.cols.claimTs] ?? '') + '').trim()
    const age = claimAge(ts)
    const stale = age > STALE_HOURS ? `  ⚠ STALE (${age.toFixed(1)}h)` : `  (${age.toFixed(1)}h)`
    console.log(
      `#${data.rows[r][data.cols.task]} [${data.rows[r][data.cols.business]}] ${data.rows[r][data.cols.title]} -> ${who}${stale}`
    )
  }
  if (!any) console.log('no active claims')
  process.exit(0)
}

if (cmd === 'comment-sweep') {
  // READ-ONLY. Sweep the Comments tab for comments to PROCESS, each joined to its
  // parent Tracker row + full thread, so Claude Code can proactively turn Derek's
  // requests into tasks. Buckets by the "Seen" (col E) watermark: unprocessed
  // (empty) / deferred / held (Awaiting Derek) / terminal (already handled). NEVER
  // writes. Default = Derek only (matched by RAW user-id substring — his author can
  // be stored as a bare id with no parens); --all = all humans except machine
  // back-links. Flags: --all --json --include-seen --task <N>.
  const DEREK_ID = 'U08APFXGJ4U'
  const wantAll = flags.all === true
  const includeSeen = flags['include-seen'] === true
  const onlyTask = flags.task ? String(flags.task).trim() : null
  const asJson = flags.json === true
  const MACHINE_RE = /agent m42|cc-sweep|cc-w\d|machine/i

  let cRows
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'Comments'!A1:F` })
    cRows = res.data.values ?? []
  } catch (err) {
    const msg = String(err?.message ?? err)
    if (!/unable to parse range/i.test(msg)) die(`comment-sweep read failed: ${msg}`)
    console.log(asJson ? '[]' : 'No comments tab yet — nothing to sweep.')
    audit({ cmd: 'comment-sweep', tab: 'absent', count: 0 })
    process.exit(0)
  }
  const cHeaders = (cRows[0] ?? []).map((h) => (h ?? '').trim())
  const cNorm = (s) => s.replace(/\s+/g, '').toLowerCase()
  const cIdx = (...names) => {
    for (const n of names) {
      const i = cHeaders.findIndex((h) => cNorm(h) === cNorm(n))
      if (i >= 0) return i
    }
    return -1
  }
  const iTs = cIdx('Timestamp', 'Time')
  const iTask = cIdx('Task #', 'Task#', 'Task')
  const iAuthor = cIdx('Author')
  const iText = cIdx('Comment', 'Text')
  const iSeen = cIdx('Seen')
  const iAtt = cIdx('Attachments', 'Files')
  const cCell = (row, i) => (i >= 0 ? ((row?.[i] ?? '') + '').trim() : '')

  // Join map: Task# -> parent Tracker row context.
  const tcell = (r, i) => (i >= 0 ? ((data.rows[r][i] ?? '') + '').trim() : '')
  const tByNum = new Map()
  for (let r = 1; r < data.rows.length; r++) {
    const n = tcell(r, data.cols.task)
    if (n) tByNum.set(n, { title: tcell(r, data.cols.title), business: tcell(r, data.cols.business), status: tcell(r, data.cols.status), next: tcell(r, data.cols.next), link: tcell(r, data.cols.link) })
  }

  const stateOf = (seen) => {
    const s = seen.toLowerCase()
    if (!seen) return 'unprocessed'
    if (s.startsWith('awaiting derek')) return 'held'
    if (s.startsWith('deferred')) return 'deferred'
    return 'terminal'
  }

  const items = []
  cRows.slice(1).forEach((row, i) => {
    const taskN = cCell(row, iTask)
    if (!taskN) return
    if (onlyTask && taskN !== onlyTask) return
    const author = cCell(row, iAuthor)
    const isDerek = author.includes(DEREK_ID)
    if (!wantAll && !isDerek) return
    if (wantAll && MACHINE_RE.test(author)) return // never process machine/back-link rows
    const seen = cCell(row, iSeen)
    const state = stateOf(seen)
    if (!includeSeen && state === 'terminal') return
    const parent = tByNum.get(taskN) || null
    items.push({
      key: `#${taskN}@${cCell(row, iTs)}`,
      sheetRow: i + 2,
      timestamp: cCell(row, iTs),
      taskNum: taskN,
      author,
      isDerek,
      text: cCell(row, iText),
      attachments: cCell(row, iAtt),
      seen,
      state,
      task: parent ? { found: true, ...parent } : { found: false },
    })
  })

  audit({ cmd: 'comment-sweep', mode: wantAll ? 'all' : 'derek', count: items.length })

  if (asJson) {
    console.log(JSON.stringify(items, null, 2))
    process.exit(0)
  }

  const buckets = { unprocessed: [], deferred: [], held: [], terminal: [] }
  for (const it of items) buckets[it.state].push(it)
  const printItem = (it) => {
    const ctx = it.task.found ? `${it.task.business}-${it.taskNum} · ${it.task.status || '—'}` : `#${it.taskNum}  ⚠ parent not found`
    console.log(`\n  [${it.key}]  (${ctx})`)
    if (it.task.found && it.task.title) console.log(`    task: ${it.task.title}`)
    console.log(`    ${it.author} @ ${it.timestamp}`)
    console.log(`    "${it.text}"`)
    if (it.attachments) console.log(`    📎 ${it.attachments}`)
    if (it.seen) console.log(`    seen: ${it.seen}`)
  }
  console.log(`Comment sweep — ${wantAll ? 'all humans (excl. machine)' : 'Derek only'}${onlyTask ? ` · task #${onlyTask}` : ''}`)
  console.log(`\n=== UNPROCESSED (${buckets.unprocessed.length}) ===`)
  buckets.unprocessed.length ? buckets.unprocessed.forEach(printItem) : console.log('  (none)')
  if (buckets.deferred.length) {
    console.log(`\n=== PREVIOUSLY DEFERRED (${buckets.deferred.length}) ===`)
    buckets.deferred.forEach(printItem)
  }
  if (buckets.held.length) {
    console.log(`\n=== AWAITING DEREK (${buckets.held.length}) ===`)
    buckets.held.forEach(printItem)
  }
  if (includeSeen && buckets.terminal.length) {
    console.log(`\n=== ALREADY PROCESSED (${buckets.terminal.length}) ===`)
    buckets.terminal.forEach(printItem)
  }
  console.log(`\nSurfaced ${buckets.unprocessed.length + buckets.deferred.length + buckets.held.length} to act on (of ${items.length} matched).`)
  process.exit(0)
}

if (cmd === 'sweep-lock') {
  // Serialize concurrent sweeps via the shared sweep-lock helpers (lock row in
  // the hidden _CockpitState tab). Anonymous windows get a random unique slug —
  // never a shared default, or two windows would look like the same holder.
  const action = pos[0]
  const win = flags.window || anonWindow()
  if (action !== 'acquire' && action !== 'release') die('sweep-lock needs "acquire" or "release"')
  if (action === 'acquire') {
    await acquireSweepLock(sheets, win)
    audit({ cmd: 'sweep-lock', action, window: win })
    console.log(`✓ sweep lock acquired (${win})`)
  } else {
    await releaseSweepLock(sheets)
    audit({ cmd: 'sweep-lock', action, window: win })
    console.log('✓ sweep lock released')
  }
  process.exit(0)
}

if (cmd === 'mark-seen') {
  // Stamp a comment's "Seen" (col E) with a processed-state token. State machine:
  // terminal (Processed/Skipped/Handled) is protected — needs --force to overwrite
  // (same-token = safe no-op); non-terminal (Deferred/Awaiting Derek) advances freely.
  const key = typeof flags.key === 'string' ? flags.key : null
  const state = typeof flags.state === 'string' ? flags.state : null
  const force = flags.force === true
  if (!key) die(`mark-seen needs --key '#<task>@<ISO>'`)
  if (!state) die(`mark-seen needs --state '<token>'`)
  const m = key.match(/^#([^@]+)@(.+)$/)
  if (!m) die(`bad --key (expected '#<task>@<ISO>'): ${key}`)
  const kTask = m[1].trim()
  const kTs = m[2].trim()
  let cRows
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'Comments'!A1:F` })
    cRows = res.data.values ?? []
  } catch (err) {
    if (/unable to parse range/i.test(String(err?.message ?? err))) die('no Comments tab')
    throw err
  }
  const ch = (cRows[0] ?? []).map((h) => (h ?? '').trim())
  const cn = (s) => s.replace(/\s+/g, '').toLowerCase()
  const ci = (...names) => { for (const n of names) { const i = ch.findIndex((h) => cn(h) === cn(n)); if (i >= 0) return i } return -1 }
  const iTs = ci('Timestamp', 'Time'), iTask = ci('Task #', 'Task#', 'Task'), iSeen = ci('Seen')
  if (iSeen < 0) die('Comments tab has no "Seen" column')
  const hits = []
  for (let i = 1; i < cRows.length; i++) if (((cRows[i][iTask] ?? '') + '').trim() === kTask && ((cRows[i][iTs] ?? '') + '').trim() === kTs) hits.push(i)
  if (hits.length === 0) die(`comment not found for key ${key}`)
  if (hits.length > 1) die(`ambiguous key ${key} (${hits.length} rows) — escalate to Claudio`)
  const rowIdx = hits[0]
  const cur = ((cRows[rowIdx][iSeen] ?? '') + '').trim()
  const isTerminal = (s) => /^(processed|skipped|handled)\b/i.test(s)
  if (isTerminal(cur)) {
    if (cur === state) { console.log(`✓ no-op (already "${cur}")`); process.exit(0) }
    if (!force) die(`refusing to overwrite terminal state "${cur}" without --force`)
  }
  const col = colLetter(iSeen)
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'Comments'!${col}${rowIdx + 1}`, valueInputOption: 'RAW', requestBody: { values: [[state]] } })
  // row-shift verify: re-read from Timestamp col to Seen col of that row.
  const chk = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'Comments'!${colLetter(iTs)}${rowIdx + 1}:${col}${rowIdx + 1}` })
  const back = chk.data.values?.[0] ?? []
  if (((back[0] ?? '') + '').trim() !== kTs || ((back[back.length - 1] ?? '') + '').trim() !== state)
    die(`ROW SHIFT / verify failed for ${key} — check the Comments tab manually`)
  audit({ cmd: 'mark-seen', key, state, prev: cur })
  console.log(`✓ marked ${key} → "${state}"${cur ? ` (was "${cur}")` : ''}`)
  process.exit(0)
}

if (cmd === 'comment-add') {
  // Append a MACHINE back-link comment, self-stamping its own col E terminal so it
  // never re-enters the sweep. Author must be a machine identity, never Derek/Claudio.
  // IDEMPOTENT for crash/race retries (2026-07-09): if the same task already carries
  // a comment with the same exact text — or the same Slack provenance token
  // "(<chan>@<ts>)" — this is a NO-OP, so a re-confirmed checkpoint or a second
  // window never double-posts into Derek's cockpit. --allow-dup bypasses.
  const taskN = pos[0]
  if (!taskN) die('comment-add needs a <task#>')
  const author = typeof flags.author === 'string' ? flags.author : 'Agent M42 (cc-sweep)'
  // Enforce the machine-identity contract above (doc-only until 2026-08-04):
  // Derek is never an author (attribution belongs in --text); Claudio only via
  // the "... via Agent M42" proxy form used by the traceability A-out mirror.
  if (/\bDerek\b|U08APFXGJ4U/i.test(author))
    die('comment-add author must be a machine identity, never Derek (put attribution in --text)')
  if (/\bClaudio\b|U08C8QTNBJ9/i.test(author) && !author.includes('via Agent M42'))
    die('Claudio-attributed comments must use the "... via Agent M42" author form')
  const text = typeof flags.text === 'string' ? flags.text : null
  if (!text) die(`comment-add needs --text "<t>"`)
  if (flags['allow-dup'] !== true) {
    const cmDup = await loadComments(sheets)
    if (cmDup) {
      const tokenM = text.match(/\(([CDG][A-Z0-9]{8,}@\d{10}\.\d{6})\)/)
      for (let i = 1; i < cmDup.rows.length; i++) {
        if (cmDup.cell(cmDup.rows[i], cmDup.iTask) !== String(taskN).trim()) continue
        const prev = cmDup.cell(cmDup.rows[i], cmDup.iText)
        if (prev === text.trim() || (tokenM && prev.includes(`(${tokenM[1]})`))) {
          audit({ cmd: 'comment-add', taskNum: taskN, dedup: true })
          console.log(`already back-linked on #${taskN} (dup ${tokenM ? 'slack token' : 'text'}) — no-op`)
          process.exit(0)
        }
      }
    }
  }
  const seenStamp = `Skipped — machine back-link (${today()})`
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'Comments'!A1:E1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[nowIso(), String(taskN), author, text, seenStamp]] },
  })
  audit({ cmd: 'comment-add', taskNum: taskN, author })
  console.log(`✓ back-link comment added to #${taskN} (self-stamped "${seenStamp}")`)
  process.exit(0)
}

if (cmd === 'state-get' || cmd === 'state-set') {
  // Generic _CockpitState KV rows for durable machine state (2026-07-09):
  // Slack-intake watermarks `intake:<channelId>` + consistency-guard suppressions
  // `followup:changes`. Namespace-guarded: ONLY intake:* / followup:* — the
  // sweep-lock row and the cockpit's userId rows are UNREACHABLE through this
  // path. Row layout: A=key, B=value (string, usually JSON), C=updatedAt ISO,
  // D=window. state-set locates the row by EXACT col-A match AT WRITE TIME,
  // appends via INSERT_ROWS when absent (never overwrites neighbors), supports
  // CAS via --if-value / --if-value-file / --if-absent, and echo-verifies the
  // write so a row shift dies loudly. Only that one row's A:D is ever touched.
  // PS 5.1 mangles quoted JSON on the command line — from PowerShell ALWAYS use
  // --value-file and --if-value-file (scratchpad files), never inline JSON.
  const key = pos[0]
  if (!key) die(`${cmd} needs a <key>`)
  if (!/^(intake|followup):[A-Za-z0-9._:-]{1,80}$/.test(key))
    die(`key "${key}" outside the allowed namespaces (intake:* / followup:*) — sweep-lock and cockpit rows are off-limits`)
  let sRows
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A1:D` })
    sRows = res.data.values ?? []
  } catch (err) {
    if (/unable to parse range/i.test(String(err?.message ?? err))) die(`${STATE_TAB} tab missing — open the cockpit once to create it`)
    throw err
  }
  const hits = []
  for (let i = 0; i < sRows.length; i++) if (((sRows[i][0] ?? '') + '').trim() === key) hits.push(i)
  if (hits.length > 1) die(`key "${key}" appears ${hits.length}× in ${STATE_TAB} — de-dup manually before continuing`)
  const cur = hits.length ? ((sRows[hits[0]][1] ?? '') + '').trim() : null

  if (cmd === 'state-get') {
    if (flags.json === true) console.log(JSON.stringify({ key, value: cur, updatedAt: hits.length ? ((sRows[hits[0]][2] ?? '') + '').trim() : null }))
    else console.log(cur === null ? `(absent) ${key}` : `${key} = ${cur}`)
    audit({ cmd: 'state-get', key, absent: cur === null })
    process.exit(0)
  }

  let value = typeof flags.value === 'string' ? flags.value : null
  if (value === null && typeof flags['value-file'] === 'string') value = fs.readFileSync(flags['value-file'], 'utf8').replace(/\r?\n$/, '')
  if (value === null) die(`state-set needs --value '<string>' or --value-file <path>`)
  if (value.length > 40000) die('--value too long (>40k chars — sheet cell cap is 50k)')
  let ifValue = typeof flags['if-value'] === 'string' ? flags['if-value'] : null
  if (ifValue === null && typeof flags['if-value-file'] === 'string') ifValue = fs.readFileSync(flags['if-value-file'], 'utf8').replace(/\r?\n$/, '')
  if (flags['if-absent'] === true && hits.length) die(`CAS conflict: "${key}" already exists — re-read (state-get) and retry with --if-value-file`)
  if (ifValue !== null && cur !== ifValue.trim())
    die(`CAS conflict on "${key}":\n  expected: ${ifValue === null ? '(absent)' : ifValue.trim().slice(0, 200)}\n  actual:   ${cur === null ? '(absent)' : cur.slice(0, 200)}\n— another window advanced this state; re-read (state-get) and reconcile before retrying`)
  const sWin = typeof flags.window === 'string' ? flags.window : anonWindow()
  const rowVals = [[key, value, nowIso(), sWin]]
  if (hits.length === 0) {
    await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A1:D1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: rowVals } })
  } else {
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A${hits[0] + 1}:D${hits[0] + 1}`, valueInputOption: 'RAW', requestBody: { values: rowVals } })
  }
  const chk = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A1:B` })
  const back = (chk.data.values ?? []).filter((r) => ((r[0] ?? '') + '').trim() === key)
  if (back.length !== 1 || ((back[0][1] ?? '') + '').trim() !== value.trim())
    die(`state-set verify failed for "${key}" (ROW SHIFT or concurrent edit) — check ${STATE_TAB} manually`)
  audit({ cmd: 'state-set', key, cas: ifValue !== null || flags['if-absent'] === true, window: sWin, bytes: value.length })
  console.log(`✓ ${key} set (${value.length} chars)${ifValue !== null ? ' [CAS ok]' : ''}`)
  process.exit(0)
}

if (cmd === 'create') {
  // Mint a NEW task row. Claudio-only. Requires --from-comment (provenance anchor,
  // enables crash-safe idempotency) unless --standalone. Post-append duplicate-Task#
  // scan is a HARD STOP. Owner=Agent M42, Status=Not Started (unclaimed).
  // SERIALIZED under the sweep lock: two windows minting concurrently would both
  // read the same max Task# and append the same number (TOCTOU), so we acquire the
  // lock FIRST, then RE-READ the tracker and run anchor-scan + max-Task# on the
  // fresh data — the boot-time `data` is stale by the time the lock is ours.
  if (flags.claudio !== true) die('create requires --claudio (Claudio-only, per contract)')
  const fromComment = typeof flags['from-comment'] === 'string' ? flags['from-comment'] : null
  const fromSlack = typeof flags['from-slack'] === 'string' ? flags['from-slack'] : null
  const standalone = flags.standalone === true
  if (!fromComment && !fromSlack && !standalone) die(`create requires --from-comment '#<task>@<ISO>' or --from-slack '<channelId>@<message ts>' (or --standalone for a genuine standalone task)`)
  if (fromSlack && !/^[CDG][A-Z0-9]{8,}@\d{10}\.\d{6}$/.test(fromSlack)) die(`bad --from-slack (expected '<channelId>@<epoch.6dp message ts>'): ${fromSlack}`)
  const business = typeof flags.business === 'string' ? flags.business : null
  const title = typeof flags.title === 'string' ? flags.title : null
  if (!business) die('create needs --business "<b>"')
  if (!title) die('create needs --title "<t>"')
  const priority = typeof flags.priority === 'string' ? flags.priority : ''
  const nextSentence = typeof flags.next === 'string' ? flags.next.trim() : ''
  if (nextSentence.length > 200) die('--next too long (≤200 chars)')
  if (nextSentence && /[\\/]|cc-|\.mjs|--/.test(nextSentence)) die('--next must be a plain Derek-readable sentence (no paths/slugs/flags)')

  const createWin = typeof flags.window === 'string' ? flags.window : anonWindow()
  await acquireSweepLock(sheets, createWin) // held by another window? it dies — wait for its release (≤15 min stale) and re-run
  // From here every exit path releases the lock first (die() exits the process,
  // so try/finally can't cover it). An uncaught crash still self-heals: the lock
  // goes stale and auto-reclaims after 15 min.
  const fresh = await load(sheets)

  const norm = (s) => (s ?? '').replace(/\s+/g, '').toLowerCase()
  const idxOf = (...names) => { for (const n of names) { const i = fresh.headers.findIndex((h) => norm(h) === norm(n)); if (i >= 0) return i } return -1 }
  const ownerCol = idxOf('Owner')
  const priorityCol = idxOf('Priority Tier', 'Priority')

  // Idempotency: if this comment already spawned a task, no-op.
  const anchor = fromComment ? `[from comment ${fromComment}]` : fromSlack ? `[from slack ${fromSlack}]` : ''
  if (anchor && fresh.cols.next >= 0) {
    for (let r = 1; r < fresh.rows.length; r++) {
      if (((fresh.rows[r][fresh.cols.next] ?? '') + '').includes(anchor)) {
        await releaseSweepLock(sheets)
        console.log(`already created as #${((fresh.rows[r][fresh.cols.task] ?? '') + '').trim()} (anchor found) — no-op`)
        process.exit(0)
      }
    }
  }

  let maxNum = 0
  for (let r = 1; r < fresh.rows.length; r++) {
    const n = parseInt(((fresh.rows[r][fresh.cols.task] ?? '') + '').replace(/[^\d]/g, ''), 10)
    if (!Number.isNaN(n) && n > maxNum) maxNum = n
  }
  const nextNum = maxNum + 1
  const nextAction = [nextSentence, anchor].filter(Boolean).join(' ').trim()

  const row = new Array(fresh.headers.length).fill('')
  row[fresh.cols.task] = String(nextNum)
  if (fresh.cols.business >= 0) row[fresh.cols.business] = business
  row[fresh.cols.title] = title
  if (ownerCol >= 0) row[ownerCol] = 'Agent M42'
  if (priorityCol >= 0 && priority) row[priorityCol] = priority
  if (fresh.cols.status >= 0) row[fresh.cols.status] = 'Not Started'
  if (fresh.cols.next >= 0 && nextAction) row[fresh.cols.next] = nextAction
  if (fresh.cols.updated >= 0) row[fresh.cols.updated] = today()

  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: `${TAB}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] } })

  // HARD STOP on duplicate Task# (concurrent mint).
  const verify = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A1:Z` })
  const vRows = verify.data.values ?? []
  const vHeaders = (vRows[0] ?? []).map((h) => (h ?? '').trim())
  const vTaskCol = vHeaders.findIndex((h) => norm(h) === norm('Task #') || norm(h) === norm('Task#'))
  const dupes = vRows.slice(1).filter((rr) => ((rr[vTaskCol] ?? '') + '').trim() === String(nextNum))
  await releaseSweepLock(sheets) // duplicate scan done — release before the verdict so a HARD STOP never strands the lock
  if (dupes.length !== 1) die(`HARD STOP: Task #${nextNum} appears ${dupes.length}× after append — DE-DUP manually before continuing`)
  audit({ cmd: 'create', taskNum: nextNum, business, provenance: fromComment || (fromSlack ? `slack ${fromSlack}` : 'standalone'), window: createWin })
  console.log(`✓ created ${business}-${nextNum} — Not Started (Owner: Agent M42)`)
  if (anchor) console.log(`  anchored: ${anchor}`)
  process.exit(0)
}

if (cmd === 'match') {
  // READ-ONLY fuzzy ask→Task# retrieval: "is this ask already covered by a task?"
  // against the LIVE sheet. Pure lexical scoring (no new deps, no state): token
  // overlap with title (w3) / business incl. company aliases (w2) / next action
  // (w1.5) / recent comment text (w1), plus a literal Task# mention in the ask
  // ("#42" / "JRS-42", w10 — near-certain). Weak scores are surfaced WITH a
  // caveat — they are NOT dedup guarantees. Exits 0 always: zero matches just
  // means "likely a NEW ask", which is a valid answer, not an error.
  const text = typeof flags.text === 'string' ? flags.text : null
  if (!text) die(`match needs --text "<message>"`)
  const topN = Math.max(1, parseInt(flags.top, 10) || 5)
  const asJson = flags.json === true

  // Small EN+PT stopword list — asks arrive in either language.
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'is', 'are', 'was', 'be', 'do', 'does', 'we', 'i', 'you', 'it', 'this', 'that', 'de', 'da', 'das', 'dos', 'o', 'as', 'os', 'e', 'ou', 'um', 'uma', 'para', 'pra', 'em', 'no', 'na', 'nos', 'nas', 'que', 'com', 'por', 'se', 'ele', 'ela', 'isso'])
  const fold = (s) => ((s ?? '') + '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const toks = (s) => new Set(fold(s).split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)))
  const overlap = (a, b) => { let n = 0; for (const t of a) if (b.has(t)) n++; return n }

  const textToks = toks(text)
  // Literal Task# mentions ("#42", "JRS-42") — near-certain signal.
  const litNums = new Set()
  for (const m of text.matchAll(/#(\d+)\b/g)) litNums.add(m[1])
  for (const m of text.matchAll(/\b[A-Za-z]\w*-(\d+)\b/g)) litNums.add(m[1])

  // Company aliases: a group hits when BOTH the ask and the row's Business /
  // Section contain one of its tokens (however each side spells the company).
  const ALIAS_GROUPS = [
    ['jrs'], ['brightly'], ['bam'], ['tmt'], ['immersivity'], ['entourage'],
    ['2020', 'theory', '2020theory'],
    ['3t', '3talliance', 'alliance'],
    ['m42', 'umbrella', 'holdings'],
  ]

  // Recent comment text (last 3 per task) strengthens matching; tab may be absent.
  const cm = await loadComments(sheets)
  const recentComments = new Map() // taskNum -> [text, ...] (newest first, ≤3)
  if (cm) {
    for (let i = cm.rows.length - 1; i >= 1; i--) {
      const tn = cm.cell(cm.rows[i], cm.iTask)
      if (!tn) continue
      const list = recentComments.get(tn) ?? []
      if (list.length >= 3) continue
      list.push(cm.cell(cm.rows[i], cm.iText))
      recentComments.set(tn, list)
    }
  }

  const tcell = (r, i) => (i >= 0 ? ((data.rows[r][i] ?? '') + '').trim() : '')
  const clamp = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const scored = []
  for (let r = 1; r < data.rows.length; r++) {
    const tn = tcell(r, data.cols.task)
    if (!tn) continue
    const title = tcell(r, data.cols.title)
    const business = tcell(r, data.cols.business)
    let score = 0
    score += 3 * overlap(toks(title), textToks)
    const bizToks = toks(business)
    const bizHit =
      overlap(bizToks, textToks) > 0 ||
      ALIAS_GROUPS.some((g) => g.some((t) => bizToks.has(t)) && g.some((t) => textToks.has(t)))
    if (bizHit) score += 2
    score += 1.5 * overlap(toks(tcell(r, data.cols.next)), textToks)
    const cList = recentComments.get(tn)
    if (cList) score += overlap(toks(cList.join(' ')), textToks)
    const tnDigits = tn.replace(/[^\d]/g, '')
    if (tnDigits && litNums.has(tnDigits)) score += 10
    if (score <= 0) continue
    scored.push({
      score: Math.round(score * 10) / 10,
      strength: score >= 8 ? 'strong' : score >= 4 ? 'medium' : 'weak',
      taskNum: tn,
      business,
      title: clamp(title, 80),
      status: tcell(r, data.cols.status),
      claimedBy: data.cols.claimedBy >= 0 ? tcell(r, data.cols.claimedBy) : '',
    })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, topN)
  audit({ cmd, matched: top.length, top: top[0]?.taskNum ?? null })

  if (asJson) {
    console.log(JSON.stringify(top, null, 2))
    process.exit(0)
  }
  if (top.length === 0) {
    console.log('no plausible match — likely a NEW ask')
    process.exit(0)
  }
  for (const it of top)
    console.log(
      `${String(it.score).padStart(5)}  ${it.strength.padEnd(6)}  #${it.taskNum} [${it.business}] ${it.title} · ${it.status || '—'}${it.claimedBy ? ` · claimed by ${it.claimedBy}` : ''}`
    )
  if (top.some((it) => it.strength === 'weak'))
    console.log('⚠ weak matches are NOT dedup guarantees — verify the row before assuming the ask is covered')
  process.exit(0)
}

if (cmd === 'radar') {
  // READ-ONLY, STATELESS neglect radar — recomputed fresh every run, no state
  // stored anywhere. Surfaces what nothing else watches, starting with the
  // "Changes requested" verdict backlog (the currently-BLIND channel: the
  // cockpit writes it, nothing reads it). That bucket is flagged EVERY run and
  // NEVER capped, until the row is claimed or its status changes. Also: aging
  // reviews/blocks, stale claims, delivered rows without a link, comment
  // backlog, unclaimed new tasks, and a movement pulse from the local audit
  // log. Each human row ends with the exact next command to run.
  const asJson = flags.json === true
  const tcell = (r, i) => (i >= 0 ? ((data.rows[r][i] ?? '') + '').trim() : '')
  const clamp = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const dayMs = (s) => {
    // Col N contract is YYYY-MM-DD; anything else (blank/garbage) is unparseable.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    const t = Date.parse(s + 'T00:00:00Z')
    return Number.isNaN(t) ? null : t
  }
  const ageDays = (t) => Math.floor((Date.now() - t) / 86400000)
  const DEREK_ID = 'U08APFXGJ4U'

  const S = { changesRequested: [], agingReviews: [], blockedAging: [], staleClaims: [], linkMissing: [], commentBacklog: null, unclaimedNew: [], notStartedAging: [], inProgressStale: [], logPulse: null }
  const noDate = new Set() // tracker rows an age bucket wanted but whose col N was unparseable

  for (let r = 1; r < data.rows.length; r++) {
    const tn = tcell(r, data.cols.task)
    if (!tn) continue
    const status = tcell(r, data.cols.status)
    const claimedBy = data.cols.claimedBy >= 0 ? tcell(r, data.cols.claimedBy) : ''
    const business = tcell(r, data.cols.business)
    const title = clamp(tcell(r, data.cols.title), 80)
    const upd = dayMs(tcell(r, data.cols.updated))
    const priority = data.cols.priority >= 0 ? tcell(r, data.cols.priority) : ''

    // a. 🟣 verdict backlog — flagged until claimed or status changed; never capped.
    if (/^changes requested/i.test(status) && !claimedBy)
      S.changesRequested.push({ taskNum: tn, business, title, status, next: `node tracker.mjs claim ${tn} --window cc-<you>` })

    // b. ⏳ delivered, waiting on Derek's review > 3 days
    if (status === 'Delivered — awaiting Derek review') {
      if (upd === null) noDate.add(r)
      else if (ageDays(upd) > 3) S.agingReviews.push({ taskNum: tn, business, title, ageDays: ageDays(upd), next: 'draft a nudge for Derek (send via Claudio)' })
    }

    // c. 🔴 blocked > 5 days
    // Word-boundary, NOT "blocked —": the em-dash ban of 2026-07-29 means new rows
    // are written "Blocked: reason" / "Blocked, reason" / plain "Blocked". The old
    // literal-em-dash matcher silently hid every one of them (found 2026-07-30:
    // #22, #47 and #7 invisible for 30 days).
    if (/^blocked\b/i.test(status)) {
      if (upd === null) noDate.add(r)
      else if (ageDays(upd) > 5) S.blockedAging.push({ taskNum: tn, business, title, status, ageDays: ageDays(upd), next: `node tracker.mjs row ${tn}  (re-check the blocker; escalate to Claudio)` })
    }

    // d. 🟠 stale claims (> STALE_HOURS)
    if (claimedBy) {
      const age = claimAge(data.cols.claimTs >= 0 ? tcell(r, data.cols.claimTs) : '')
      if (age > STALE_HOURS)
        S.staleClaims.push({ taskNum: tn, holder: claimedBy, ageHours: age === Infinity ? null : Math.round(age * 10) / 10, title, next: 'release or takeover per protocol (ask Claudio before any --force)' })
    }

    // e. ⚠️ delivered/done without a deliverable link
    if (/^(done$|delivered)/i.test(status)) {
      const link = data.cols.link >= 0 ? tcell(r, data.cols.link) : ''
      if (!link) S.linkMissing.push({ taskNum: tn, business, title, status, next: `node tracker.mjs link ${tn} --url <deliverable-url>` })
    }

    // g. 🆕 recently minted (col N ≤ 7 days), nobody picked it up
    if (/^not started$/i.test(status) && !claimedBy) {
      if (upd === null) noDate.add(r)
      else if (ageDays(upd) <= 7) S.unclaimedNew.push({ taskNum: tn, business, title, ageDays: ageDays(upd), next: `node tracker.mjs claim ${tn} --window cc-<you>` })
      // h. 🕰️ the other side of the same coin. The ≤7d ceiling above meant that the
      // OLDER an abandoned row got, the quieter it became: 70 rows had aged out of
      // every bucket. Capped render, oldest first, so it informs without flooding.
      else S.notStartedAging.push({ taskNum: tn, business, title, priority, ageDays: ageDays(upd), next: `node tracker.mjs claim ${tn} --window cc-<you>` })
    }

    // i. 🟡 In Progress and not moving. This was the ONLY one of the four official
    // statuses with no alarm at all, and 46 of 130 open rows sat in it. That blind
    // spot is what hid #138 (Brightly tech app) for 15 days until Derek asked twice.
    if (/^in progress$/i.test(status)) {
      if (upd === null) noDate.add(r)
      else if (ageDays(upd) > 7) S.inProgressStale.push({ taskNum: tn, business, title, priority, ageDays: ageDays(upd), next: `node tracker.mjs row ${tn}  (still moving? update col N or re-scope)` })
    }
  }

  // f. 💬 comment backlog (tab may be absent — that is a normal state)
  const cm = await loadComments(sheets)
  if (cm) {
    let unseenDerek = 0
    let unseenOthers = 0
    let deferred = 0
    const awaitingOld = []
    for (let i = 1; i < cm.rows.length; i++) {
      const row = cm.rows[i]
      const tn = cm.cell(row, cm.iTask)
      if (!tn) continue
      const seen = cm.cell(row, cm.iSeen)
      if (!seen) {
        if (cm.cell(row, cm.iAuthor).includes(DEREK_ID)) unseenDerek++
        else unseenOthers++
        continue
      }
      if (/^deferred —/i.test(seen)) deferred++
      else if (/^awaiting derek/i.test(seen)) {
        const dm = /(\d{4}-\d{2}-\d{2})/.exec(seen)
        const t = dm ? dayMs(dm[1]) : null
        if (t !== null && ageDays(t) > 3) awaitingOld.push({ key: `#${tn}@${cm.cell(row, cm.iTs)}`, ageDays: ageDays(t) })
      }
    }
    S.commentBacklog = { tabAbsent: false, unseenDerek, unseenOthers, deferred, awaitingDerekOver3d: awaitingOld, next: 'run the /m42-comment-sweep skill' }
  } else {
    S.commentBacklog = { tabAbsent: true, unseenDerek: 0, unseenOthers: 0, deferred: 0, awaitingDerekOver3d: [], next: 'run the /m42-comment-sweep skill' }
  }

  // h. 📊 log pulse — movement signal from the local audit log tail (~200 lines)
  if (fs.existsSync(LOG)) {
    const lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean).slice(-200)
    const MUTATIONS = new Set(['init', 'claim', 'heartbeat', 'release', 'done', 'link', 'create', 'mark-seen', 'comment-add', 'sweep-lock', 'state-set'])
    const last24h = {}
    const last48h = {}
    for (const ln of lines) {
      let e
      try { e = JSON.parse(ln) } catch { continue }
      if (!e || !MUTATIONS.has(e.cmd)) continue
      const t = Date.parse(e.at)
      if (Number.isNaN(t)) continue
      const h = (Date.now() - t) / 3.6e6
      if (h <= 48) {
        last48h[e.cmd] = (last48h[e.cmd] ?? 0) + 1
        if (h <= 24) last24h[e.cmd] = (last24h[e.cmd] ?? 0) + 1
      }
    }
    S.logPulse = { found: true, last24h, last48h }
  } else {
    S.logPulse = { found: false }
  }

  const cb = S.commentBacklog
  const cbCount = cb.unseenDerek + cb.unseenOthers + cb.deferred + cb.awaitingDerekOver3d.length
  // Oldest first: in an aging bucket the top of the list is the one that hurts.
  S.notStartedAging.sort((a, b) => b.ageDays - a.ageDays)
  S.inProgressStale.sort((a, b) => b.ageDays - a.ageDays)

  const total = S.changesRequested.length + S.agingReviews.length + S.blockedAging.length + S.staleClaims.length + S.linkMissing.length + cbCount + S.unclaimedNew.length + S.notStartedAging.length + S.inProgressStale.length
  audit({ cmd, total })

  if (asJson) {
    console.log(JSON.stringify({ generatedAt: nowIso(), sections: S, rowsWithUnreadableDate: noDate.size, total }, null, 2))
    process.exit(0)
  }

  console.log(`RADAR ${today()} · ${total} itens`)
  const section = (emoji, name, items, fmt) => {
    if (!items.length) return
    console.log(`\n${emoji} ${name} (${items.length})`)
    for (const it of items) console.log(`  ${fmt(it)}`)
  }
  section('🟣', 'CHANGES REQUESTED — verdict backlog (never capped)', S.changesRequested, (it) => `#${it.taskNum} [${it.business}] ${it.title} · ${it.status}  →  ${it.next}`)
  section('⏳', 'AGING REVIEWS (delivered > 3d, no verdict)', S.agingReviews, (it) => `#${it.taskNum} [${it.business}] ${it.title} · ${it.ageDays}d waiting  →  ${it.next}`)
  section('🔴', 'BLOCKED > 5d', S.blockedAging, (it) => `#${it.taskNum} [${it.business}] ${it.title} · ${it.status} · ${it.ageDays}d  →  ${it.next}`)
  section('🟠', `STALE CLAIMS (> ${STALE_HOURS}h)`, S.staleClaims, (it) => `#${it.taskNum} held by ${it.holder} · ${it.ageHours === null ? 'unknown age' : it.ageHours + 'h'} · ${it.title}  →  ${it.next}`)
  section('⚠️', 'LINK MISSING (delivered/done, no deliverable link)', S.linkMissing, (it) => `#${it.taskNum} [${it.business}] ${it.title} · ${it.status}  →  ${it.next}`)
  if (cbCount > 0) {
    console.log(`\n💬 COMMENT BACKLOG (${cbCount})`)
    if (cb.unseenDerek + cb.unseenOthers > 0) console.log(`  unseen: ${cb.unseenDerek} from Derek, ${cb.unseenOthers} from others  →  ${cb.next}`)
    if (cb.deferred > 0) console.log(`  deferred: ${cb.deferred}  →  ${cb.next}`)
    for (const a of cb.awaitingDerekOver3d) console.log(`  awaiting Derek > 3d: ${a.key} (${a.ageDays}d)  →  draft a nudge for Derek (send via Claudio)`)
  }
  section('🆕', 'UNCLAIMED NEW (minted ≤ 7d, nobody picked up)', S.unclaimedNew, (it) => `#${it.taskNum} [${it.business}] ${it.title} · ${it.ageDays}d old  →  ${it.next}`)
  // Capped: these two buckets were born holding ~116 rows between them. Rendering
  // all of them would drown the radar and get it ignored, which is the failure mode
  // we are fixing. Top 5 oldest plus a counter keeps the signal and the pressure.
  // A P0 is never folded into the counter, however young it is.
  //
  // Why this exists: the cap sorts oldest-first, so a row that has JUST crossed the
  // 7-day line lands at the BOTTOM and disappears into "+N mais". #138 (Brightly tech
  // app) would have re-entered this bucket on 2026-08-06 as the youngest of roughly
  // thirty rows and gone quiet again, which is the exact failure this bucket was
  // built on 2026-07-30 to prevent. Age is the wrong sort key for a critical row.
  const isCritical = (it) => /^p0\b/i.test((it.priority ?? '').trim())
  const capped = (emoji, name, items, cap, fmt) => {
    if (!items.length) return
    const critical = items.filter(isCritical)
    const rest = items.filter((it) => !isCritical(it))
    const shown = [...critical, ...rest.slice(0, Math.max(0, cap - critical.length))]
    const hidden = items.length - shown.length
    console.log(`\n${emoji} ${name} (${items.length}${critical.length ? `, ${critical.length} P0` : ''})`)
    for (const it of shown) console.log(`  ${isCritical(it) ? '🔴 ' : ''}${fmt(it)}`)
    if (hidden > 0) console.log(`  (+${hidden} mais, nenhuma delas P0 — 'node tracker.mjs radar --json' lista todas)`)
  }
  capped('🟡', 'IN PROGRESS, PARADAS > 7d', S.inProgressStale, 5, (it) => `#${it.taskNum} [${it.business}] ${it.title} · ${it.ageDays}d sem update  →  ${it.next}`)
  capped('🕰️', 'NOT STARTED, ESQUECIDAS > 7d', S.notStartedAging, 5, (it) => `#${it.taskNum} [${it.business}] ${it.title} · ${it.ageDays}d old  →  ${it.next}`)
  const fmtPulse = (o) => Object.entries(o).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'
  console.log(
    S.logPulse.found
      ? `\n📊 LOG PULSE — 24h: ${fmtPulse(S.logPulse.last24h)} · 48h: ${fmtPulse(S.logPulse.last48h)}`
      : `\n📊 LOG PULSE — tracker-log absent (no movement signal)`
  )
  if (noDate.size) console.log(`\n(${noDate.size} rows sem data legível — skipped from age buckets)`)
  console.log(`\nTOTAL: ${total} itens`)
  process.exit(0)
}

const taskNum = pos[0]
if (!taskNum) die(`command "${cmd}" needs a <task#>`)

if (cmd === 'row') {
  const r = findRow(data, taskNum)
  data.headers.forEach((h, i) => {
    const v = ((data.rows[r][i] ?? '') + '').trim()
    if (h && v) console.log(`${h}: ${v}`)
  })
  process.exit(0)
}

if (cmd === 'comments') {
  // Read-only: list the Comments-tab entries for one task. The tab is
  // lazy-created by the cockpit's act layer on its first write, so absence is
  // a NORMAL state (exit 0), mirroring the sidecar's tolerant fetchComments.
  let cRows
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'Comments'!A1:E`,
    })
    cRows = res.data.values ?? []
  } catch (err) {
    // A missing tab is the ONLY error treated as "no comments": Google answers
    // HTTP 400 "Unable to parse range: 'Comments'!..." when the range names a
    // tab that doesn't exist. Anything else (429 quota, 5xx, revoked access)
    // must fail loudly so a parallel window never mistakes an outage for an
    // empty tab.
    const msg = String(err?.message ?? err)
    if (!/unable to parse range/i.test(msg)) die(`comments read failed: ${msg}`)
    console.log('No comments tab yet.')
    audit({ cmd: 'comments-read', taskNum, tab: 'absent', count: 0 })
    process.exit(0)
  }
  // Header A–E: Timestamp | Task # | Author | Comment | Seen — same tolerant
  // header mapping as load(). The tab is append-only, so sheet order is
  // chronological: printing in order already yields newest last.
  const cHeaders = (cRows[0] ?? []).map((h) => (h ?? '').trim())
  const cNorm = (s) => s.replace(/\s+/g, '').toLowerCase()
  const cIdx = (...names) => {
    for (const n of names) {
      const i = cHeaders.findIndex((h) => cNorm(h) === cNorm(n))
      if (i >= 0) return i
    }
    return -1
  }
  const iTs = cIdx('Timestamp', 'Time')
  const iTask = cIdx('Task #', 'Task#', 'Task')
  const iAuthor = cIdx('Author')
  const iText = cIdx('Comment', 'Text')
  const cCell = (row, i) => (i >= 0 ? ((row?.[i] ?? '') + '').trim() : '')
  const hits = cRows.slice(1).filter((row) => cCell(row, iTask) === String(taskNum).trim())
  if (hits.length === 0) console.log(`No comments for #${taskNum}.`)
  for (const row of hits) console.log(`[${cCell(row, iTs)}] ${cCell(row, iAuthor)}: ${cCell(row, iText)}`)
  audit({ cmd: 'comments-read', taskNum, count: hits.length })
  process.exit(0)
}

if (data.cols.claimedBy < 0) die('machine columns missing — run: tracker.mjs init')
const win = flags.window
const r = findRow(data, taskNum)
const holder = ((data.rows[r][data.cols.claimedBy] ?? '') + '').trim()

if (cmd === 'claim') {
  if (!win || !/^cc-[\w-]+$/.test(String(win))) die('claim needs --window cc-<slug>')
  if (holder && holder !== win) {
    const age = claimAge(((data.rows[r][data.cols.claimTs] ?? '') + '').trim())
    if (!flags.force)
      die(
        `Task# ${taskNum} is claimed by ${holder} (${age === Infinity ? 'unknown age' : age.toFixed(1) + 'h'}). ` +
          (age > STALE_HOURS
            ? 'Claim looks STALE — ask Claudio, then re-run with --force.'
            : 'NO auto-steal. Pick another task or ask Claudio.')
      )
  }
  await writeCell(sheets, r, data.cols.claimedBy, win)
  await writeCell(sheets, r, data.cols.claimTs, nowIso())
  await writeCell(sheets, r, data.cols.status, 'In Progress')
  await writeCell(sheets, r, data.cols.updated, today())
  await verifyRow(sheets, data, r, taskNum, win)
  audit({ cmd, taskNum, window: win, forced: !!flags.force, prevHolder: holder || null })
  console.log(`✓ claimed #${taskNum} for ${win} (status: In Progress)`)
  console.log(`  🧭 before working: run the consistency gate — m42-tracker-protocol step 3 (canonical: m42-comment-sweep §🧭)`)
  process.exit(0)
}

if (cmd === 'heartbeat') {
  if (!win) die('heartbeat needs --window')
  if (holder !== win) die(`heartbeat refused: #${taskNum} is claimed by "${holder || '(nobody)'}", not ${win}`)
  await writeCell(sheets, r, data.cols.claimTs, nowIso())
  await writeCell(sheets, r, data.cols.updated, today())
  await verifyRow(sheets, data, r, taskNum, win)
  audit({ cmd, taskNum, window: win })
  console.log(`✓ heartbeat #${taskNum} (${win})`)
  process.exit(0)
}

if (cmd === 'release') {
  if (!win) die('release needs --window')
  if (holder && holder !== win) die(`release refused: #${taskNum} is claimed by "${holder}", not ${win}`)
  // "Done" is Claudio's final word (done command) — a late-finishing window must
  // never regress it back to a working status. No --force bypass, on purpose.
  const curStatus = ((data.rows[r][data.cols.status] ?? '') + '').trim()
  if (curStatus === 'Done')
    die(`task #${taskNum} is already Done — releasing would clobber a final state; talk to Claudio`)
  const status = flags.status
  if (!status || !isValidStatus(status))
    die(
      `--status must be one of: "Not Started" | "In Progress" | "Blocked — <reason>" | "Delivered — awaiting Derek review" (got: ${status}). "Done" is Claudio-only.`
    )
  if (!flags.sop && !flags['no-sop'])
    die('release requires --sop <vault-path> or --no-sop "<reason>" — the SOP gate is what keeps the pivot temporary')
  if (flags.next) lintNext(String(flags.next))
  if (flags.link && !/^https?:\/\//.test(String(flags.link))) die('--link must be a full http(s) URL')

  await writeCell(sheets, r, data.cols.status, status)
  if (flags.next) await writeCell(sheets, r, data.cols.next, String(flags.next))
  if (flags.link && data.cols.link >= 0) await writeCell(sheets, r, data.cols.link, String(flags.link))
  await writeCell(sheets, r, data.cols.updated, today())
  await writeCell(sheets, r, data.cols.claimedBy, '')
  await writeCell(sheets, r, data.cols.claimTs, '')
  await verifyRow(sheets, data, r, taskNum, '')
  audit({ cmd, taskNum, window: win, status, link: flags.link || null, sop: flags.sop || null, noSop: flags['no-sop'] || null })
  console.log(`✓ released #${taskNum} -> "${status}"${flags.sop ? ` (SOP: ${flags.sop})` : ' (NO SOP — logged)'}`)
  process.exit(0)
}

if (cmd === 'done') {
  if (!flags.claudio) die('"Done" is reserved to Claudio — re-run with --claudio after his approval')
  // A live claim means a window may still be mid-run on this row — marking Done
  // under it races that window's release. Coordinate first; --force only after
  // Claudio's explicit OK.
  if (holder && !flags.force)
    die(`task #${taskNum} is claimed by ${holder} — coordinate a release first, or re-run with --force after Claudio's OK`)
  await writeCell(sheets, r, data.cols.status, 'Done')
  if (flags.link && data.cols.link >= 0) await writeCell(sheets, r, data.cols.link, String(flags.link))
  await writeCell(sheets, r, data.cols.updated, today())
  await writeCell(sheets, r, data.cols.claimedBy, '')
  await writeCell(sheets, r, data.cols.claimTs, '')
  await verifyRow(sheets, data, r, taskNum, '')
  audit({ cmd, taskNum, link: flags.link || null, forced: !!flags.force })
  console.log(`✓ #${taskNum} marked Done`)
  process.exit(0)
}

if (cmd === 'link') {
  // Attach/backfill ONLY the Deliverable Link (col Q). Never touches status/date/
  // claim, so a link can be added to a Waiting/blocked/drafted task without
  // misstating its state. Refuses to clobber a different existing link w/o --force.
  if (data.cols.link < 0) die('Deliverable Link column missing — run: tracker.mjs init')
  const url = flags.url
  if (!url || !/^https?:\/\//.test(String(url))) die('link needs --url <full http(s) URL>')
  const existing = ((data.rows[r][data.cols.link] ?? '') + '').trim()
  if (existing && existing !== String(url) && !flags.force)
    die(`#${taskNum} already has a link:\n  ${existing}\nRe-run with --force to overwrite.`)
  await writeCell(sheets, r, data.cols.link, String(url))
  await verifyRow(sheets, data, r, taskNum)
  // `overwrote` only when a DIFFERENT prior link was replaced — an idempotent
  // re-write of the same URL must not log a phantom overwrite.
  const overwrote = existing && existing !== String(url) ? existing : null
  audit({ cmd, taskNum, url: String(url), overwrote, forced: !!flags.force })
  console.log(`✓ linked #${taskNum} -> ${url}`)
  process.exit(0)
}

die(`unknown command "${cmd}"`)
