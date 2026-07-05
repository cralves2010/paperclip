# Agent M42 Slack Cockpit

Private, decoupled Slack **App Home** cockpit for the M42 portfolio. It renders
Derek's task board from the **M42 Central Task Tracker** Google Sheet and (v1)
lets the two allowlisted humans **act** from Slack: comment on a task, create a
task, filter/sort/search, and open deliverables.

Runs as a sidecar (Socket Mode, `@slack/bolt`) — no public HTTP surface. Deploy
is human-gated and out of scope for this package's automated tooling.

## What it does

- **Read (v0):** portfolio health, a pinned "Needs You" list, and per-task
  detail modals — all derived from the Sheet (`Tracker` tab).
- **Act (v1):**
  1. **Comment** on any task (overflow menu on a board card, or the task modal).
     Comments are appended to a `Comments` tab on the same Sheet and a DM is sent
     to Claudio. A `💬 N` badge appears on cards/hero rows with comments.
  2. **Create** a task (➕ New task) — appends a row to the `Tracker` tab with the
     next free numeric Task #, `Status = Not Started`, `Owner = Agent M42`.
  3. **Deliverables** — cards/modals surface an "Open deliverable" link when the
     `Deliverable Link` column holds a URL.
  4. **Filter / sort / search / paginate** — a flat, Linear-like board with
     per-user view state (Derek's filters never clobber Claudio's).
- Everything is gated by the allowlist (`COCKPIT_ALLOWLIST`); everyone else gets
  the private/denied view.

## Act Layer routing decision (supersedes design spec §13 D1)

The external design spec
(`docs/superpowers/specs/2026-07-02-agent-m42-slack-cockpit-design.md` §13,
**Decision D1**) proposed routing cockpit comments to the **AgentM42 board
issue** for that task (so the native "comment wakes the assignee agent" fires).

**This package supersedes that.** As of the **2026-07-03 Claude Code pivot**, the
executors are parallel **Claude Code windows** (not board agents) that claim
tasks via `tools/tracker.mjs`. So cockpit comments route to:

- the Sheet's **`Comments` tab** (the same single source of truth the windows and
  Derek already read), **plus**
- a **DM to Claudio** (`COCKPIT_NOTIFY_USER`) — never to Derek, never to a
  channel.

The board is no longer the acting surface. The external spec should be amended
out-of-band to match (the hard scope rule forbids editing files outside
`docker/slack-cockpit/`, so the supersession is recorded here).

## Environment variables

Secrets live only in `.env.cockpit` on the VPS (never in git).

| Var | Required | Default | Purpose |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | yes | — | Bot token (`xoxb-…`). |
| `SLACK_APP_TOKEN` | yes | — | App-level token (`xapp-…`, Socket Mode). |
| `COCKPIT_ALLOWLIST` | yes | — | Comma-separated Slack user IDs allowed to view/act. |
| `GOOGLE_SA_JSON` | yes (live) | — | Path to the service-account key. On the VPS: `/opt/apps/paperclip/docker/slack-cockpit/sa.json`. |
| `SHEET_ID` | yes (live) | — | Tracker spreadsheet id. |
| `SHEET_RANGE` | no | `A1:Z` | Read range. If it carries a tab prefix (`Tracker!A1:Z`) that tab is also used for writes. |
| `COCKPIT_DEMO` | no | `false` | `true` renders a JRS+Brightly fixture; act features no-op with a friendly "demo mode" modal. |
| `COCKPIT_NOTIFY_USER` | no | `U08C8QTNBJ9` (Claudio) | Who gets DMs on new comments / tasks. A Slack user id, not a secret. |
| `COCKPIT_COMMENTS_TAB` | no | `Comments` | Sheet tab that stores comments (`Timestamp \| Task # \| Author \| Comment \| Seen`). |
| `COCKPIT_TRACKER_TAB` | no | `Tracker` | Tab that `create task` appends to (only used when `SHEET_RANGE` has no tab prefix). |

## Required Slack bot scopes

The bot historically only *published* Home views. The v1 act layer additionally
needs:

- `chat:write` — to DM Claudio on new comments / tasks (a user id passed as the
  `channel` auto-opens the IM).
- `im:write` — may be required for the DM depending on workspace settings.

DM failures are treated as **non-fatal** (logged and swallowed) so a comment or
task creation still succeeds even if the notification can't be delivered. If the
scopes are missing, update the app config (`A0B6DA9CHGR`) and reinstall.

## Google write scope

Reads use a read-only Sheets client. Writes (`sheets-write.ts`) use a separate,
lazily-constructed **full-scope** (`.../auth/spreadsheets`) client — constructed
only in live mode. Writes are **append-only** (comments and new task rows) with
an echo-verify; a failed write surfaces a friendly error and never corrupts
existing rows. The VPS `sa.json` must have edit access to the Sheet for writes to
succeed (reads are unaffected if it doesn't).

## Reading cockpit comments from a Claude Code window (optional)

A CC window working a task can pull the comments Derek/Claudio left in Slack by
reading the `Comments` tab. An additive **read-only** `comments <task#>`
subcommand for `tools/tracker.mjs` is the intended home for this, but it was
**not applied in this change** because `tracker.mjs` was under active concurrent
edit by another window. Ready-to-paste snippet (insert after the `row` command
block, before the machine-columns guard — it is read-only, so do NOT add it to
`needsWrite`):

```js
if (cmd === 'comments') {
  const COMMENTS_TAB = process.env.COCKPIT_COMMENTS_TAB || 'Comments'
  let rows = []
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${COMMENTS_TAB}'!A1:E` })
    rows = res.data.values ?? []
  } catch { console.log('no comments yet'); process.exit(0) }
  if (rows.length < 2) { console.log('no comments yet'); process.exit(0) }
  const h = rows[0].map((x) => (x ?? '').trim())
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase()
  const ix = (name) => h.findIndex((x) => norm(x) === norm(name))
  const [iTs, iTask, iAuthor, iText, iSeen] = [ix('Timestamp'), ix('Task #'), ix('Author'), ix('Comment'), ix('Seen')]
  const mine = rows.slice(1).filter((r) => ((r[iTask] ?? '') + '').trim() === String(taskNum).trim())
  if (mine.length === 0) { console.log(`no comments on #${taskNum} yet`); process.exit(0) }
  for (const r of mine) {
    const seen = ((r[iSeen] ?? '') + '').trim()
    console.log(`[${((r[iTs] ?? '') + '').trim()}] ${((r[iAuthor] ?? '') + '').trim() || '(unknown)'}: ${((r[iText] ?? '') + '').trim()} (${seen ? `seen ${seen}` : 'unseen'})`)
  }
  audit({ cmd, taskNum, shown: mine.length })
  process.exit(0)
}
```

## Develop

```bash
pnpm install
pnpm typecheck   # tsc --noEmit (tests excluded from tsc)
pnpm test        # vitest run
pnpm build       # tsc -> dist/
```

Tests never import googleapis or Slack: pure functions are asserted on literal
arrays, view builders via `JSON.stringify`, and the write layer's I/O wrappers
via injected stub clients.
