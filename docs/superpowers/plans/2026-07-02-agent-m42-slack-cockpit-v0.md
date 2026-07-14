# Agent M42 Slack Cockpit — v0 (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a private, read-only "Agent M42" Slack App Home cockpit that shows JRS + Brightly tasks by company/status with drill-down to each task's deliverable, plus filter/sort/search — reading the existing Google Sheet tracker, deployed as a decoupled Docker sidecar on the VPS.

**Architecture:** A standalone Node/TypeScript service using Slack Bolt in **Socket Mode** (no public endpoint, no Caddy route, no URL verification). It reads the "M42 Central Task Tracker" Google Sheet (read-only service account), normalizes each row's free-text working-status into a fixed human vocabulary, and publishes Block Kit views to the app's Home tab. Privacy is enforced in-app via a Slack `user_id` allowlist. It never writes to the Sheet or the board (read-only). It is a sibling container (like `claude-runner`) — it does **not** patch Paperclip core, so the weekly upstream rebase never touches it.

**Tech Stack:** TypeScript, `@slack/bolt` (Socket Mode), `googleapis` (Sheets v4, read-only), `vitest` (tests), Docker (sibling service in the existing `docker-compose`).

## Global Constraints

- **UI language = English** (Derek-facing; fork English-only rule).
- **Read-only in v0** — the service performs NO writes to the Google Sheet or the AgentM42 board. Only read-safe Slack interactions (publish views, open modals, open URLs).
- **Socket Mode** — no inbound HTTP endpoint; connect via App-Level Token. No public URL, no Caddy route.
- **Privacy = in-app allowlist**, NOT a Slack ACL. Unauthorized users get a neutral "private app" home.
- **Decoupled sidecar** — new files under `docker/slack-cockpit/`; NO edits to Paperclip `server/` or `ui/` core. Its build failing must not block the server build.
- **Fixed status vocabulary** (the only strings shown): `Queued · In progress · Delivered – awaiting you · Needs you · Changes requested · Blocked · Done`.
- **Block Kit fidelity rules:** counts use single-space + middot separators (Slack collapses multi-space); modal `title` ≤ 24 chars (truncate; full title in body); clamp section text ≤ 2900 chars and field values ≤ 1900; render a thumbnail ONLY when a direct image URL exists; every interaction (incl. URL buttons) is `ack()`ed; track per-user view-state so a background refresh re-publishes the SAME view the user is on.
- **Data source columns** (Sheet): existing `Task# · Business · Task · Owner · Dependency/Blocker` PLUS new maintained columns `Working Status · Deliverable Link · Last Updated`. The cockpit reads `Working Status` for status (NOT the dead `Status` column that reads "Not Started" for every row).
- **Sample scope:** JRS + Brightly only for the first live test.

---

## Phase 0 — Human prerequisite (only Claudio/Derek can do this)

Not a code task. Before Task 8 can run live, Claudio creates the Slack app and supplies secrets. Documented here so the plan is self-contained.

- [ ] **P0.1 — Create the Slack app.** Go to `https://api.slack.com/apps` → *Create New App* → *From scratch* → name **"Agent M42"**, pick the M42 workspace.
- [ ] **P0.2 — Enable Socket Mode.** *Settings → Socket Mode* → toggle ON. This generates an **App-Level Token** (`xapp-…`) with scope `connections:write`. Copy it.
- [ ] **P0.3 — Enable the App Home tab.** *Features → App Home* → turn ON the **Home Tab**. Turn OFF Messages tab & the "Allow users to send messages" (v0 has no messaging).
- [ ] **P0.4 — Subscribe to the event.** *Features → Event Subscriptions* → toggle ON → *Subscribe to bot events* → add **`app_home_opened`**. (Socket Mode delivers events over the socket; no Request URL needed.)
- [ ] **P0.5 — Bot scopes.** *Features → OAuth & Permissions → Bot Token Scopes* → add `chat:write`, `commands`, `users:read`. Install the app to the workspace → copy the **Bot User OAuth Token** (`xoxb-…`).
- [ ] **P0.6 — Google read access.** Create a read-only Google **service account**, download its JSON key, and **share the tracker Sheet** with the service account's email (Viewer). Note the Sheet ID `1K2YFr0GbjrUinVfcADkEBU94C071zGCJ5aS0dFeVH8A`.
- [ ] **P0.7 — Add the 3 columns.** In the tracker Sheet, add headers `Working Status`, `Deliverable Link`, `Last Updated` (the process that maintains the tracker fills them; the cockpit reads them).
- [ ] **P0.8 — Hand Claudio the values** for `.env.cockpit` on the VPS: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `GOOGLE_SA_JSON` (path), `SHEET_ID`, `COCKPIT_ALLOWLIST` (Claudio + Derek Slack user IDs, comma-separated).

---

## File structure

```
docker/slack-cockpit/
  package.json            # deps + scripts
  tsconfig.json
  Dockerfile
  vitest.config.ts
  src/
    config.ts             # env → typed Config
    model.ts              # Task, CanonicalStatus, CompanyRollup, ViewState types
    normalize.ts          # free-text Working Status → CanonicalStatus; company health
    sheets.ts             # parseRows (pure) + fetchTasks (Sheets I/O)
    allowlist.ts          # isAllowed(); buildPrivateView()
    state.ts              # per-user ViewState + tasks cache (TTL)
    text.ts              # clamp(), truncateTitle(), countLine() helpers
    views/
      home.ts             # buildHomeView(tasks, state)
      company.ts          # buildCompanyView(tasks, companyId, state)
      taskModal.ts        # buildTaskModal(task)
      search.ts           # buildSearchModal(), buildSearchResults()
    handlers.ts           # registerHandlers(app) — actions/events wiring
    index.ts              # Bolt app bootstrap (Socket Mode) + start
  tests/
    normalize.test.ts
    sheets.test.ts
    allowlist.test.ts
    views.test.ts
docker-compose.yml         # MODIFY: add `slack-cockpit` service (sibling, isolated)
```

---

## Task 1: Scaffold the sidecar package

**Files:**
- Create: `docker/slack-cockpit/package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Test: `docker/slack-cockpit/tests/smoke.test.ts`

**Interfaces:**
- Produces: an installable TS package with `pnpm test` (vitest) and `pnpm build` (tsc) working.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "agent-m42-slack-cockpit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@slack/bolt": "^4.2.0",
    "googleapis": "^144.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`** (`target ES2022`, `module NodeNext`, `moduleResolution NodeNext`, `outDir dist`, `strict true`, `rootDir src`).
- [ ] **Step 3: Write `vitest.config.ts`** (default node environment).
- [ ] **Step 4: Write `tests/smoke.test.ts`**

```ts
import { expect, test } from 'vitest'
test('smoke', () => { expect(1 + 1).toBe(2) })
```

- [ ] **Step 5: Install + run** — `cd docker/slack-cockpit && pnpm install && pnpm test`. Expected: 1 passing test.
- [ ] **Step 6: Commit** — `git add docker/slack-cockpit && git commit -m "feat(cockpit): scaffold slack-cockpit sidecar package"`

---

## Task 2: Domain types + config

**Files:**
- Create: `src/model.ts`, `src/config.ts`

**Interfaces:**
- Produces:
  - `type CanonicalStatus = 'queued'|'in_progress'|'delivered_awaiting'|'needs_you'|'changes_requested'|'blocked'|'done'`
  - `interface Task { taskNum, company, title, owner, status: CanonicalStatus, rawStatus, deliverableTitle?, deliverableDriveUrl?, deliverableSlackUrl?, description?, dependency?, lastUpdated?, lastUpdatedTs? }`
  - `interface CompanyRollup { company: string; health: 'on_track'|'at_risk'|'blocked'; counts: { inProgress: number; awaiting: number; blocked: number } }`
  - `type ViewState = { kind: 'portfolio' } | { kind: 'company'; companyId: string; filterStatus?: CanonicalStatus | 'all'; sort?: SortKey }`
  - `type SortKey = 'recent'|'status'|'title'`
  - `loadConfig(env): Config` where `Config = { slackBotToken, slackAppToken, googleSaJsonPath, sheetId, sheetRange, allowlist: string[] }`

- [ ] **Step 1: Write `model.ts`** with the types above (plus a `STATUS_LABEL: Record<CanonicalStatus,string>` and `STATUS_EMOJI: Record<CanonicalStatus,string>` per the Global Constraints vocabulary, e.g. `delivered_awaiting: 'Delivered – awaiting you'`, `🟡`).
- [ ] **Step 2: Write `config.ts`** — `loadConfig` reads `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `GOOGLE_SA_JSON`, `SHEET_ID`, `SHEET_RANGE` (default `A1:Z200`), `COCKPIT_ALLOWLIST` (split on `,`, trim), throwing a clear error if any required var is missing.
- [ ] **Step 3: Commit** — `git commit -am "feat(cockpit): domain types + typed config"`

---

## Task 3: Status normalizer + company health (pure, TDD)

**Files:**
- Create: `src/normalize.ts`
- Test: `tests/normalize.test.ts`

**Interfaces:**
- Consumes: `CanonicalStatus`, `CompanyRollup` from `model.ts`.
- Produces:
  - `normalizeStatus(raw: string): CanonicalStatus`
  - `companyHealth(tasks: Task[]): CompanyRollup['health']`
  - `rollupCounts(tasks: Task[]): CompanyRollup['counts']`

- [ ] **Step 1: Write the failing test** (`tests/normalize.test.ts`)

```ts
import { describe, expect, test } from 'vitest'
import { normalizeStatus, companyHealth } from '../src/normalize.js'

describe('normalizeStatus (priority-ordered, first match wins)', () => {
  test.each([
    ['waiting on client to approve delivery', 'delivered_awaiting'],
    ['changes requested by Derek', 'changes_requested'],
    ['blocked — waiting on legal', 'blocked'],
    ['needs your decision on price', 'needs_you'],
    ['done / published', 'done'],
    ['Not Started', 'queued'],
    ['drafting the sequence', 'in_progress'],
    ['some unmapped nonsense', 'in_progress'], // fallback
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeStatus(raw)).toBe(expected)
  })
})

test('companyHealth is blocked when any task is blocked or needs_you', () => {
  const t = (status) => ({ status } as any)
  expect(companyHealth([t('in_progress'), t('blocked')])).toBe('blocked')
  expect(companyHealth([t('in_progress'), t('needs_you')])).toBe('blocked')
  expect(companyHealth([t('in_progress'), t('done')])).toBe('on_track')
})
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test normalize`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `normalize.ts`**

```ts
import type { CanonicalStatus, CompanyRollup, Task } from './model.js'

export function normalizeStatus(raw: string): CanonicalStatus {
  const s = (raw ?? '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!·]+$/, '')
  if (/chang|revis|rework/.test(s)) return 'changes_requested'
  if (/block|stuck|waiting on (legal|client|3rd|api|access|credential)|dependency/.test(s)) return 'blocked'
  if (/await|for review|review needed|pending approval|needs sign|ready for derek|delivered/.test(s) && !/done/.test(s)) return 'delivered_awaiting'
  if (/need.*(input|decision|you|direction|answer)|your call|question for/.test(s)) return 'needs_you'
  if (/(done|complete|approved|shipped|closed|published)/.test(s) && !/await/.test(s)) return 'done'
  if (/not started|backlog|queued|todo|planned/.test(s)) return 'queued'
  if (/in progress|wip|working|drafting|building|underway/.test(s)) return 'in_progress'
  return 'in_progress' // fallback (also flagged for tuning log by caller)
}

export function companyHealth(tasks: Task[]): CompanyRollup['health'] {
  if (tasks.some(t => t.status === 'blocked' || t.status === 'needs_you')) return 'blocked'
  if (tasks.some(t => t.status === 'delivered_awaiting' || t.status === 'changes_requested')) return 'at_risk'
  return 'on_track'
}

export function rollupCounts(tasks: Task[]): CompanyRollup['counts'] {
  return {
    inProgress: tasks.filter(t => t.status === 'in_progress' || t.status === 'queued').length,
    awaiting: tasks.filter(t => t.status === 'delivered_awaiting' || t.status === 'needs_you').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
  }
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm test normalize`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(cockpit): status normalizer + company health (TDD)"`

---

## Task 4: Google Sheet adapter (pure parse + I/O split, TDD)

**Files:**
- Create: `src/sheets.ts`
- Test: `tests/sheets.test.ts`

**Interfaces:**
- Consumes: `normalizeStatus`, `Task`.
- Produces:
  - `parseRows(rows: string[][]): Task[]` — pure; maps by header row; only Business ∈ {JRS, Brightly} for v0.
  - `fetchTasks(cfg: Config): Promise<Task[]>` — Sheets v4 read then `parseRows`.

- [ ] **Step 1: Write the failing test** (`tests/sheets.test.ts`)

```ts
import { expect, test } from 'vitest'
import { parseRows } from '../src/sheets.js'

const rows = [
  ['Task#','Business','Task','Owner','Dependency/Blocker','Working Status','Deliverable Link','Last Updated'],
  ['41','JRS','School contacts — 62 Tucson principals','Agent M42','','Delivered - awaiting review','https://docs.google.com/spreadsheets/d/1-vmz/edit','2026-06-29'],
  ['99','Acme','Ignore me','x','','done','',''],
]

test('parseRows maps headers, normalizes status, filters to JRS/Brightly', () => {
  const tasks = parseRows(rows)
  expect(tasks).toHaveLength(1)
  expect(tasks[0].taskNum).toBe('41')
  expect(tasks[0].company).toBe('JRS')
  expect(tasks[0].status).toBe('delivered_awaiting')
  expect(tasks[0].deliverableDriveUrl).toContain('docs.google.com')
})
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test sheets`.
- [ ] **Step 3: Implement `sheets.ts`** — `parseRows` reads the header row, builds a column index, iterates data rows, keeps `Business ∈ {JRS, Brightly}`, calls `normalizeStatus(Working Status)`, classifies `Deliverable Link` into `deliverableDriveUrl` (contains `google.com`) vs `deliverableSlackUrl` (contains `slack.com`), parses `Last Updated` into `lastUpdatedTs` (`Date.parse`, guarded). `fetchTasks` builds a `google.auth.GoogleAuth` from the SA JSON (scope `spreadsheets.readonly`), calls `sheets.spreadsheets.values.get({ spreadsheetId, range })`, and passes `res.data.values` to `parseRows`.
- [ ] **Step 4: Run to verify pass** — `pnpm test sheets`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(cockpit): google sheet adapter (parseRows TDD + fetchTasks)"`

---

## Task 5: Allowlist gate (TDD)

**Files:**
- Create: `src/allowlist.ts`
- Test: `tests/allowlist.test.ts`

**Interfaces:**
- Produces: `isAllowed(userId: string, allowlist: string[]): boolean`; `buildPrivateView(): HomeView` (a `{ type:'home', blocks:[…] }` with a neutral "This app is private." message).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'vitest'
import { isAllowed, buildPrivateView } from '../src/allowlist.js'

test('isAllowed matches exact user ids only', () => {
  expect(isAllowed('U1', ['U1','U2'])).toBe(true)
  expect(isAllowed('U9', ['U1','U2'])).toBe(false)
})
test('private view is a home view with no task data', () => {
  const v = buildPrivateView()
  expect(v.type).toBe('home')
  expect(JSON.stringify(v)).toContain('private')
})
```

- [ ] **Step 2: Run — fail. Step 3: Implement.** `isAllowed = (id, list) => list.includes(id)`. `buildPrivateView` returns a home view: `header` "Agent M42" + `section` "🔒 This app is private." + `context` "Ask Claudio for access."
- [ ] **Step 4: Run — pass. Step 5: Commit** — `git commit -am "feat(cockpit): in-app allowlist privacy gate (TDD)"`

---

## Task 6: View builders — Home, Company, Task modal (TDD on invariants)

**Files:**
- Create: `src/text.ts`, `src/views/home.ts`, `src/views/company.ts`, `src/views/taskModal.ts`
- Test: `tests/views.test.ts`

**Interfaces:**
- Consumes: `Task`, `ViewState`, `STATUS_LABEL/EMOJI`, `companyHealth`, `rollupCounts`.
- Produces:
  - `clamp(s: string, max: number): string`, `truncateTitle(s: string): string` (≤24, `…`), `countLine(c: CompanyRollup['counts']): string`
  - `buildHomeView(tasks: Task[], state: ViewState): HomeView`
  - `buildCompanyView(tasks: Task[], companyId: string, state): HomeView`
  - `buildTaskModal(task: Task): ModalView`

- [ ] **Step 1: Write the failing test** (invariants that encode the Block Kit fidelity rules)

```ts
import { expect, test } from 'vitest'
import { countLine, truncateTitle } from '../src/text.js'
import { buildHomeView } from '../src/views/home.js'
import { buildTaskModal } from '../src/views/taskModal.js'

const t = (o) => ({ taskNum:'1', company:'JRS', title:'x', owner:'a', status:'in_progress', rawStatus:'', ...o })

test('countLine uses single spaces + middot (Slack collapses multi-space)', () => {
  const line = countLine({ inProgress:4, awaiting:2, blocked:0 })
  expect(line).not.toMatch(/ {2,}/)
  expect(line).toContain('·')
})
test('truncateTitle caps at 24 chars with ellipsis', () => {
  expect(truncateTitle('School contacts — 62 Tucson principals').length).toBeLessThanOrEqual(24)
})
test('home view pins Needs You (delivered_awaiting/needs_you) above portfolio', () => {
  const tasks = [t({status:'in_progress'}), t({taskNum:'2', status:'delivered_awaiting', title:'ready'})]
  const v = buildHomeView(tasks, { kind:'portfolio' })
  const json = JSON.stringify(v)
  expect(json.indexOf('Needs You')).toBeLessThan(json.indexOf('Portfolio Health'))
})
test('task modal clamps description and never emits a URL button without a URL', () => {
  const v = buildTaskModal(t({ description:'x'.repeat(5000), deliverableDriveUrl: undefined }))
  const json = JSON.stringify(v)
  expect(json).not.toContain('"url"') // no drive/slack url present -> no url button
  expect(json.length).toBeLessThan(20000)
})
```

- [ ] **Step 2: Run — fail. Step 3: Implement `text.ts` then the three view builders** per spec §6:
  - `home.ts`: header → provenance/legend `context` → Refresh `actions` → filter/sort `actions` row (company `static_select`, status `static_select`, sort `static_select`, 🔍 Search button) → `divider` → "🔔 Needs You" header → ≤5 `section` rows (tasks with status ∈ {delivered_awaiting, needs_you, changes_requested}, sorted needs_you > changes_requested > delivered_awaiting) each with an "Open" primary button accessory (`action_id: open_task:<taskNum>`) → overflow `context` → `divider` → "📊 Portfolio Health" header → per company: `section` (health dot + `*Company*` + status word + `View →` accessory `open_company:<id>`) then a `context` `countLine` → `divider` → read-only footer `context`.
  - `company.ts`: header `"<Company> · Tasks"` → `actions` (`← Portfolio` `back_to_home` + status filter select) → rollup `context` → tasks chunked by status group (bold `section` sub-header per group) each task a `section` + "Open" accessory → pagination `context`+`Load more` if >20 → footer.
  - `taskModal.ts`: `views.open` modal, `title` = `truncateTitle(task.title)`, `blocks`: `section` `fields` (Status|Company, Task ID|Owner) → `divider` → `section` "*Deliverable*\n<badge> *title*" → `context` source badge → `actions` with URL buttons ONLY for the URLs that exist → `divider` → `section` "*Description*" (`clamp(desc, 2900)`) → `section` "*What's left*" (from `dependency`) → `context` "Actions (approve · request changes · comment) coming in v1".
- [ ] **Step 4: Run — pass. Step 5: Commit** — `git commit -am "feat(cockpit): home/company/task views with Block Kit fidelity (TDD)"`

---

## Task 7: Per-user view-state + task cache

**Files:**
- Create: `src/state.ts`

**Interfaces:**
- Produces: `getState(userId): ViewState` (default `{kind:'portfolio'}`), `setState(userId, ViewState)`, `getTasks(cfg): Promise<Task[]>` (cache with 60s TTL wrapping `fetchTasks`), `invalidate()`.

- [ ] **Step 1:** Implement an in-memory `Map<string, ViewState>` for view-state and a single `{ tasks, at }` cache for tasks with a 60s TTL; `getTasks` returns cache if fresh else refetches. **Step 2:** No dedicated test (thin I/O wrapper; covered via handler integration). **Step 3: Commit** — `git commit -am "feat(cockpit): per-user view-state + 60s task cache"`

---

## Task 8: Bolt app wiring (Socket Mode) + handlers

**Files:**
- Create: `src/handlers.ts`, `src/index.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `registerHandlers(app, cfg)`; `index.ts` boots `new App({ token, appToken, socketMode: true })`, calls `registerHandlers`, `await app.start()`.

- [ ] **Step 1: `handlers.ts`** register:
  - `app.event('app_home_opened')` → if `!isAllowed(user, cfg.allowlist)` publish `buildPrivateView()`; else set/keep state, `getTasks`, `views.publish` `buildHomeView(tasks, state)`.
  - `app.action('refresh_home')` → `ack()`, `invalidate()`, re-publish the user's **current** state (portfolio or company).
  - `app.action(/^open_company:/)` → `ack()`, `setState(user, {kind:'company', companyId})`, publish `buildCompanyView`.
  - `app.action('back_to_home')` → `ack()`, `setState(user, {kind:'portfolio'})`, publish home.
  - `app.action(/^open_task:/)` → `ack()`, `views.open({ trigger_id, view: buildTaskModal(task) })`.
  - `app.action('filter_company' | 'filter_status' | 'sort')` → `ack()`, merge into state, re-publish current view.
  - `app.action(/^url_/)` (URL buttons) → `ack()` only (link opens client-side).
- [ ] **Step 2: `index.ts`** boot + start; log "⚡ Agent M42 cockpit running (socket mode)".
- [ ] **Step 3: Manual live check** — with Phase 0 tokens in `.env.cockpit`, run `pnpm dev`, open the app's Home in Slack as an allowlisted user → see the portfolio; as a non-allowlisted user → see the private view. Verify drill-down + modal + filters.
- [ ] **Step 4: Commit** — `git commit -am "feat(cockpit): bolt socket-mode wiring + interaction handlers"`

---

## Task 9: Search (button → modal → results)

**Files:**
- Create: `src/views/search.ts`; Modify: `src/handlers.ts`

**Interfaces:**
- Produces: `buildSearchModal(): ModalView` (a `plain_text_input` `search_query` + Submit); `buildSearchResults(tasks, query): HomeView`-style blocks; a `searchTasks(tasks, query)` pure filter over `title + description + deliverableTitle`.

- [ ] **Step 1: Test** `searchTasks` — case-insensitive substring over title/description/deliverable returns matching tasks. **Step 2: Implement.** Handler: `app.action('open_search')` → `views.open(buildSearchModal())`; `app.view('search_submit')` → `ack()`, `views.publish` results (each row an Open button back into the task modal). **Step 3: Commit** — `git commit -am "feat(cockpit): search modal over description + deliverable"`

---

## Task 10: Dockerize + compose service + deploy notes

**Files:**
- Create: `docker/slack-cockpit/Dockerfile`
- Modify: `docker-compose.yml` (add service)

**Interfaces:**
- Produces: a `slack-cockpit` container that builds independently of the server.

- [ ] **Step 1: Dockerfile** — `node:22-slim`, copy package + `pnpm i --prod=false`, `pnpm build`, `CMD ["node","dist/index.js"]`.
- [ ] **Step 2: compose service**

```yaml
  slack-cockpit:
    build: ./docker/slack-cockpit
    restart: unless-stopped
    env_file: .env.cockpit
    networks: [ default ]
    # no ports: Socket Mode needs only outbound
```

- [ ] **Step 3: Deploy** — on the VPS: create `/opt/apps/paperclip/.env.cockpit` with the Phase 0 values, then `docker compose up -d --build slack-cockpit` (independent of the server build). Verify `docker compose logs slack-cockpit` shows the socket-mode start line.
- [ ] **Step 4: Commit** — `git commit -m "feat(cockpit): dockerfile + compose sibling service + deploy notes"`

---

## Self-review (done)

- **Spec coverage:** by-company (home portfolio + company view), by-status (normalizer + groups + filter), drill-down (home→company→modal, Tasks 6/8), deliverable card (Task 6), Needs-You triage (Task 6), read-only (no write paths anywhere), privacy (Task 5), English (all copy), filters/sort/search (Tasks 8/9), Block Kit fidelity rules (Task 6 invariants + Global Constraints), data from Sheet incl. new columns (Task 4). Deferred by design: comments/act layer + @mentions → **Plan 2** (needs decision D1).
- **Placeholder scan:** none — each task has concrete files, interfaces, and code for its substantive logic.
- **Type consistency:** `Task`, `CanonicalStatus`, `ViewState`, `CompanyRollup` defined in Task 2 and used verbatim in Tasks 3/4/6/7/8/9; `open_task:` / `open_company:` / `back_to_home` / `refresh_home` action_ids consistent across Tasks 6 and 8.
