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
//   node tracker.mjs create --claudio (--from-comment '#<t>@<ISO>' | --standalone)
//        --business "<b>" --title "<t>" [--priority "<p>"] [--next "<sentence>"]   mint a new task (dup Task# = hard stop)
//   node tracker.mjs comment-add <task#> --text "<t>" [--author "<machine>"]       machine back-link (self-stamps Seen)
//   node tracker.mjs mark-seen --key '#<t>@<ISO>' --state '<token>' [--force]      stamp a comment's Seen watermark
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

const { cmd, pos, flags } = parseArgs(process.argv.slice(2))

if (!cmd || flags.help) {
  console.log('usage: tracker.mjs init|claims|row|comments|comment-sweep|create|comment-add|mark-seen|sweep-lock|claim|heartbeat|release|done|link  (see file header)')
  process.exit(0)
}

const needsWrite = ['init', 'claim', 'heartbeat', 'release', 'done', 'link', 'create', 'mark-seen', 'comment-add', 'sweep-lock'].includes(cmd)
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
  // Serialize concurrent sweeps via a lock row in the hidden _CockpitState tab
  // (inert to the cockpit: its userId lookup never matches 'comment-sweep-lock').
  // A lock older than 15 min is stale and auto-reclaimable.
  const STATE_TAB = '_CockpitState'
  const LOCK_KEY = 'comment-sweep-lock'
  const action = pos[0]
  const win = flags.window || 'cc-unknown'
  if (action !== 'acquire' && action !== 'release') die('sweep-lock needs "acquire" or "release"')
  let rows
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A1:C` })
    rows = res.data.values ?? []
  } catch (err) {
    if (/unable to parse range/i.test(String(err?.message ?? err))) die(`${STATE_TAB} tab missing — open the cockpit once to create it`)
    throw err
  }
  let lockRow = -1
  for (let i = 1; i < rows.length; i++) if (((rows[i][0] ?? '') + '').trim() === LOCK_KEY) { lockRow = i; break }
  if (action === 'acquire') {
    if (lockRow >= 0) {
      const heldIso = ((rows[lockRow][1] ?? '') + '').trim()
      const heldWin = ((rows[lockRow][2] ?? '') + '').trim()
      const ageMin = heldIso ? (Date.now() - Date.parse(heldIso)) / 60000 : 999
      if (heldIso && ageMin < 15 && heldWin !== win)
        die(`sweep already running in window "${heldWin}" (${ageMin.toFixed(1)}m ago) — wait, or run from that window`)
    }
    const target = lockRow >= 0 ? lockRow : rows.length
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A${target + 1}:C${target + 1}`, valueInputOption: 'RAW', requestBody: { values: [[LOCK_KEY, nowIso(), win]] } })
    audit({ cmd: 'sweep-lock', action, window: win })
    console.log(`✓ sweep lock acquired (${win})`)
  } else {
    if (lockRow >= 0)
      await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `'${STATE_TAB}'!A${lockRow + 1}:C${lockRow + 1}`, valueInputOption: 'RAW', requestBody: { values: [['', '', '']] } })
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
  const taskN = pos[0]
  if (!taskN) die('comment-add needs a <task#>')
  const author = typeof flags.author === 'string' ? flags.author : 'Agent M42 (cc-sweep)'
  const text = typeof flags.text === 'string' ? flags.text : null
  if (!text) die(`comment-add needs --text "<t>"`)
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

if (cmd === 'create') {
  // Mint a NEW task row. Claudio-only. Requires --from-comment (provenance anchor,
  // enables crash-safe idempotency) unless --standalone. Post-append duplicate-Task#
  // scan is a HARD STOP. Owner=Agent M42, Status=Not Started (unclaimed).
  if (flags.claudio !== true) die('create requires --claudio (Claudio-only, per contract)')
  const fromComment = typeof flags['from-comment'] === 'string' ? flags['from-comment'] : null
  const standalone = flags.standalone === true
  if (!fromComment && !standalone) die(`create requires --from-comment '#<task>@<ISO>' (or --standalone for a genuine standalone task)`)
  const business = typeof flags.business === 'string' ? flags.business : null
  const title = typeof flags.title === 'string' ? flags.title : null
  if (!business) die('create needs --business "<b>"')
  if (!title) die('create needs --title "<t>"')
  const priority = typeof flags.priority === 'string' ? flags.priority : ''
  const nextSentence = typeof flags.next === 'string' ? flags.next.trim() : ''
  if (nextSentence.length > 200) die('--next too long (≤200 chars)')
  if (nextSentence && /[\\/]|cc-|\.mjs|--/.test(nextSentence)) die('--next must be a plain Derek-readable sentence (no paths/slugs/flags)')

  const norm = (s) => (s ?? '').replace(/\s+/g, '').toLowerCase()
  const idxOf = (...names) => { for (const n of names) { const i = data.headers.findIndex((h) => norm(h) === norm(n)); if (i >= 0) return i } return -1 }
  const ownerCol = idxOf('Owner')
  const priorityCol = idxOf('Priority Tier', 'Priority')

  // Idempotency: if this comment already spawned a task, no-op.
  const anchor = fromComment ? `[from comment ${fromComment}]` : ''
  if (anchor && data.cols.next >= 0) {
    for (let r = 1; r < data.rows.length; r++) {
      if (((data.rows[r][data.cols.next] ?? '') + '').includes(anchor)) {
        console.log(`already created as #${((data.rows[r][data.cols.task] ?? '') + '').trim()} (anchor found) — no-op`)
        process.exit(0)
      }
    }
  }

  let maxNum = 0
  for (let r = 1; r < data.rows.length; r++) {
    const n = parseInt(((data.rows[r][data.cols.task] ?? '') + '').replace(/[^\d]/g, ''), 10)
    if (!Number.isNaN(n) && n > maxNum) maxNum = n
  }
  const nextNum = maxNum + 1
  const nextAction = [nextSentence, anchor].filter(Boolean).join(' ').trim()

  const row = new Array(data.headers.length).fill('')
  row[data.cols.task] = String(nextNum)
  if (data.cols.business >= 0) row[data.cols.business] = business
  row[data.cols.title] = title
  if (ownerCol >= 0) row[ownerCol] = 'Agent M42'
  if (priorityCol >= 0 && priority) row[priorityCol] = priority
  if (data.cols.status >= 0) row[data.cols.status] = 'Not Started'
  if (data.cols.next >= 0 && nextAction) row[data.cols.next] = nextAction
  if (data.cols.updated >= 0) row[data.cols.updated] = today()

  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: `${TAB}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] } })

  // HARD STOP on duplicate Task# (concurrent mint).
  const verify = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A1:Z` })
  const vRows = verify.data.values ?? []
  const vHeaders = (vRows[0] ?? []).map((h) => (h ?? '').trim())
  const vTaskCol = vHeaders.findIndex((h) => norm(h) === norm('Task #') || norm(h) === norm('Task#'))
  const dupes = vRows.slice(1).filter((rr) => ((rr[vTaskCol] ?? '') + '').trim() === String(nextNum))
  if (dupes.length !== 1) die(`HARD STOP: Task #${nextNum} appears ${dupes.length}× after append — DE-DUP manually before continuing`)
  audit({ cmd: 'create', taskNum: nextNum, business, provenance: fromComment || 'standalone' })
  console.log(`✓ created ${business}-${nextNum} — Not Started (Owner: Agent M42)`)
  if (fromComment) console.log(`  anchored: ${anchor}`)
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
  await writeCell(sheets, r, data.cols.status, 'Done')
  if (flags.link && data.cols.link >= 0) await writeCell(sheets, r, data.cols.link, String(flags.link))
  await writeCell(sheets, r, data.cols.updated, today())
  await writeCell(sheets, r, data.cols.claimedBy, '')
  await writeCell(sheets, r, data.cols.claimTs, '')
  await verifyRow(sheets, data, r, taskNum, '')
  audit({ cmd, taskNum, link: flags.link || null })
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
