# Agent M42 — Slack Portfolio Cockpit (Design Spec)

- **Date:** 2026-07-02
- **Status:** Draft — awaiting Claudio's review
- **Owner:** Claudio (sole engineer) · reviewer: Claudio, later Derek
- **Sample companies for the prototype:** JRS + Brightly
- **Language of this doc / the product UI:** English (Derek-facing; per the fork's English-only rule)

> This is a design spec, not code. Nothing is built until this doc is approved. It was grounded by an adversarial multi-agent research pass (stack audit + UX/reference-product research + Slack Block Kit feasibility review).

---

## 1. Problem & goal

Derek (non-technical, single owner/admin of ~8–10 companies) tracks work through a flat **Google Sheet** ("M42 Central Task Tracker", ~125 tasks) and lives almost entirely in **Slack**. The Sheet has no by-company/by-status views, no portfolio→company→task drill-down, no place to see each task's **deliverable** (files/links), and is disconnected from Slack.

**Goal:** a **private, read-only cockpit inside Slack** that shows tasks **by company** and **by status**, lets you **drill down** portfolio → company → task, and surfaces each task's **deliverable** (Drive file / Slack link). Built so it can be **promoted to Derek with zero rework** (same app, just grant access), and later extended so Derek can **act** (comment / approve / request changes) — that acting layer is explicitly **out of v0**.

---

## 2. Locked decisions (from the brainstorm, 2026-07-02)

1. **Surface = Slack App Home tab.** NOT the Paperclip/AgentM42 web UI — Derek never uses it.
2. **Decoupled Slack sidecar** with its own bot identity **"Agent M42"** (own signing secret + bot token), separate from Claudio's personal claude.ai Slack connector. It does **NOT** patch Paperclip core (the fork rebases on upstream weekly — a sidecar is rebase-immune).
3. **v0 = read-only.** Monitor, don't act.
4. **No source-of-truth change now.** Read the data that already exists; don't make Derek change habits yet.
5. **Deliverables** are surfaced per task from **Google Drive AND Slack** (both, normally).
6. **English UI** (Derek-facing).
7. **Promotable with zero rework:** same app serves Claudio now (private test) → Derek later by granting access. Derek **acting**, two-way write-back, and the source-of-truth decision are **deferred additive layers**.
8. **First deliverable = a visual mockup** of the Slack Home for Claudio to judge before any build.
9. **Feel like Linear / Asana** (familiar PM patterns) with real UI/UX craft.

---

## 3. Findings that shape the design (read these — two change the plan)

### Finding A — the Sheet's Status column is effectively dead ⚠️
Every JRS and Brightly row's Status value is literally **"Not Started"** — a seed value from when Derek generated the Sheet on 2026-05-29; he has not edited it since. The **real** working state (drafted / gated-on-Derek / needs-legal / done / blocked) lives in the internal vault (the Agent-M42 `Deliverables/` folder + the `INDEX-*` status audits), not in the Sheet.

**Consequence:** a cockpit that reads *only the Sheet's Status column* would show **every task as "Not Started"** — making all companies look untouched when ~17 JRS and ~11 Brightly deliverables are actually drafted/done. So:

- The Sheet gives the **task skeleton** (Task#, Company, Title, Owner, Dependency/Blocker) — good, current, Derek-authored.
- The **real status** and the **deliverable links** must come from the **working layer** (vault today), not the Sheet's Status cell.
- This is actually the cockpit's core value: **show the true state the flat Sheet hides.**

**Open decision (see §11):** where the cockpit reads *live status + deliverable links* from for v0. Recommended: add two maintained columns to the existing Sheet — **`Working Status`** and **`Deliverable Link`** — filled by the same process that already updates the tracker. Keeps a single source (still the Sheet), gives the cockpit real data, changes nothing for Derek.

### Finding B — Slack App Home has NO native per-user privacy ⚠️
Slack cannot restrict a Home tab to specific users. Once the app is installed in the workspace, **any workspace member who opens it sees the Home tab**. The "private to Claudio + Derek + whoever we authorize" promise is real, but it must be **enforced by our sidecar**, not by Slack:

- On `app_home_opened`, check the Slack `user_id` against an **allowlist** (Claudio + Derek + explicitly added users).
- Authorized → publish the cockpit. Everyone else → publish a neutral **"This app is private"** view.
- "Private" therefore means **in-app gate**, not a Slack ACL. This is standard and sufficient for the tiny M42 workspace.

### Finding C — the engine already exists; we deliberately don't touch it
The Paperclip/AgentM42 board already has rich issues (7 statuses, comments that wake the assignee agent, per-company scope, parent/child delegation) — but it's single-company, has zero Slack integration, and **Derek doesn't use it**. v0 does **not** build on top of the board (that would be a Claudio-only tool → rework to reach Derek). We go **sidecar + Slack**. The board stays the agents' engine; the cockpit is Derek's window.

---

## 4. Architecture (v0)

```
                 ┌─────────────────────────────────────────────┐
                 │  "Agent M42" Slack app (decoupled sidecar)   │
   Google Sheet  │  - own bot token + signing secret            │
  (task skeleton)│  - Bolt/HTTP listener on the existing VPS    │   Slack App Home
   + Working     │  - reads data on a schedule + on refresh     │──▶  (Home tab views)
   Status +      │  - normalizes status → human vocabulary      │     private via
   Deliverable   │  - allowlist gate (privacy)                  │     allowlist gate
   Link columns  │  - publishes Block Kit views (read-only)     │
                 └─────────────────────────────────────────────┘
```

- **Decoupled sidecar** on the same Hostinger VPS (co-located with, not patched into, the Paperclip server). Rebase-immune; failures never touch the main app.
- **Read-only**: the sidecar never writes to the Sheet or the board. Only read-safe controls exist (Open-in-Drive/Slack URL buttons, Refresh, View, Back, Load-more, Retry).
- **Data**: task skeleton + working status + deliverable links from the source chosen in §11; cached in the sidecar (cache-first render so the Home is never blank).
- **Publishing**: `views.publish` for the Home/company tiers; `views.open` for the task modal.

---

## 5. Status model & normalization

Canonical, human-language statuses (the **only** strings ever shown to Derek). The **word is authoritative**; the emoji is a redundant, colorblind-safe second channel.

| Canonical | Emoji | Means | Who acts |
|---|---|---|---|
| Queued | ⚪ | Accepted, not started | Team |
| In progress | 🔵 | Team actively working | Team |
| Delivered – awaiting you | 🟡 | Output ready, needs your review/sign-off | **You** |
| Needs you | 🟠 | Blocked on a decision/input from you | **You** |
| Changes requested | 🟣 | You asked for revisions; back with team | Team |
| Blocked | 🔴 | External dependency, not on you | Team/external |
| Done | 🟢 | Approved/closed | — |

- **Company health dot** (portfolio strip, 3-value): 🔴 Blocked (≥1 Blocked or Needs-you) · 🟡 At risk (a Delivered–awaiting item aged > 3 days, or a Changes-requested) · 🟢 On track (else).
- **Normalization** from a free-text status source runs in the sidecar via a priority-ordered keyword matcher (changes → blocked → delivered/awaiting → needs-you → done → queued → in-progress → fallback "In progress"). Low-confidence/fallback rows are logged to a **Claudio-only** tuning list — never shown to Derek as broken/blank. This mapping lives in the app; **no source-of-truth change**.

---

## 6. UX / UI spec (Slack App Home) — with feasibility fixes applied

Three tiers of progressive disclosure: **Home = glance · Company = browse · Task = focus.** Deliberately mirrors **Linear Inbox** (triage) + **Asana Portfolios** (company rollup) + **Height** (deliverable-first) so Derek's existing mental model transfers with zero learning.

### 6.1 Home tab (top → bottom)
1. `header` — "Agent M42 · Portfolio Cockpit"
2. `context` — provenance + legend: "🔄 Synced from *M42 Central Task Tracker* · Updated `<date token>` · Legend: 🟢 On track · 🟡 At risk · 🔴 Blocked"
3. `actions` — [🔄 Refresh]
4. `divider`
5. `header` — "🔔 Needs You" (the hero region, top-left F-pattern hot corner)
6. up to 5 `section` rows, one per task needing **you** (Delivered–awaiting / Needs-you / Changes-requested-at-you), **aggregated across companies**; each with an `Open` primary button accessory
7. `context` — "Showing 3 of 3 · you're all caught up" (or overflow pointer)
8. `divider`
9. `header` — "📊 Portfolio Health"
10. per company: a `section` (health dot + **Company** + status word + `View →` accessory) followed by a `context` count line ("🔵 4 In progress · 🟡 2 Awaiting · 🔴 0 Blocked" — single-space + middot separators, see fix #1)
11. `divider`
12. `context` — footer: "Read-only cockpit (v0) · Actions (approve · request changes · comment) coming in v1 · Data: M42 Central Task Tracker"

### 6.2 Drill-down
- **Home → Company:** `View →` re-publishes the Home tab **in place** as that company's task list (Asana "drill into project" on the primary surface). Has a `← Portfolio` back button + a status filter (`static_select`, default "Open" = hides Done). Tasks **chunked by status group** with bold sub-headers; each task row has an `Open` button. Paginates past ~20 tasks (block-budget safe).
- **Company → Task:** `Open` spends the `trigger_id` on `views.open` → a focused **modal** (Linear issue-peek). Opening from Needs-You or from any company list is one code path. Modal Close returns to the underlying Home state (preserved — see fix #5).

### 6.3 Task modal (the deliverable is the star)
- Modal `title` = task title **truncated ≤24 chars** (Slack cap — fix #6); full title repeated in the first section body.
- `section` `fields` (2-col): Status | Company · Task ID | Owner
- `divider`
- `section` "*Deliverable*\n📊 *JRS — July IG Calendar*" (+ thumbnail **only if a direct image URL exists** — fix #3)
- `context` — source badge: "📊 Google Sheet · Updated `<date token>` by Social Media Manager (agent)"
- `actions` — URL buttons: [📄 Open in Drive] [💬 Open in Slack] (render only the ones that exist)
- `divider`
- `section` "*Description*" (clamped ≤ ~2900 chars — fix #9) · `section` "*What's left*"
- `context` — "Actions (approve · request changes · comment) coming in v1" (plain text, **not** a button — see §9)

### 6.4 States (never a blank or broken surface)
- **Empty (no tasks):** friendly placeholder + Refresh.
- **Needs-You clear (common happy path):** "🎉 Nothing needs you right now." (Inbox-Zero reward, not a sad empty box).
- **Loading:** cache-first — publish last-known-good with an "Updating…" pill, re-publish when fresh data lands. Cold start = skeleton view.
- **Error:** stale-with-cache → "⚠️ Couldn't reach the tracker — showing cached data" + Retry; hard fail → honest "Can't load right now / may need re-auth" + Retry + "ping Claudio". No stack traces.
- **No deliverable yet:** "_No deliverable linked yet._" + status context; **no dead URL button**.

### 6.5 UX techniques applied
Progressive disclosure · chunking (Gestalt proximity) · recognition-over-recall (status words + source-type glyphs + pinned legend) · color semantics **with** non-color text/shape redundancy (accessibility) · F-pattern (Needs-You top-left; action buttons in a consistent right accessory slot) · Fitts's law (large, consistently-placed buttons; primary style on the likeliest action) · sensible defaults (Needs-You pinned; company view defaults to "Open"; cache-first) · scannable mrkdwn typography · Jakob's law (mirrors Linear/Asana) · system-status feedback (provenance, Refresh, stale banners) · error prevention (never a URL button without a URL; no fake-disabled buttons) · Miller's law (capped pinned list + pagination).

### 6.6 Block Kit feasibility — fixes folded in
Verdict from the platform review: **feasible with fixes**; three-tier nav and read-only scope are sound. Corrections applied above:
1. **No multi-space column alignment** (Slack collapses runs of spaces) — counts use single-space + middot, or a `fields` grid.
2. **Privacy = in-app allowlist gate**, not a Slack ACL (Finding B).
3. **Thumbnails only with a direct, publicly-fetchable image URL** (Drive share/preview URLs won't render); otherwise omit.
4. **Relative timestamps freeze at publish** — pair "Updated X ago" with a Slack `<!date^…>` token for the absolute value; let the stale-cache banner carry freshness truth.
5. **Track per-user view-state** (portfolio vs company:<id> vs page) keyed by Slack user_id, so a background refresh re-publishes the state the user is currently on — it never yanks them back to the portfolio mid-read.
6. **Modal title ≤24 chars** (truncate; full title in the body).
7. `input` blocks **are** allowed on Home tabs + modals (only messages disallow them) — keeps the v1 comment-box option open on either surface.
8. **Single section = 2 zones** (left text + right accessory), no addressable middle — counts live on the following context line, not "between" name and button.
9. **Clamp Sheet-sourced strings** (description ≤ ~2900, fields ≤ ~1900) to avoid `invalid_blocks`.
10. **URL buttons still emit an interaction** — the handler must ack with an empty 200.
11. **Divider has one fixed style** — no thin/heavy variants.

---

## 7. Real sample data (for the mockup — JRS + Brightly)

Verbatim Sheet status is "Not Started" for all rows; the **Working status** below is the true state from the vault audits (this contrast is the whole point of the cockpit).

**JRS (12 of 41 tasks shown):**

| Task# | Title | Working status | Deliverable | Where |
|---|---|---|---|---|
| 41 | School sourcing system + contact tracker | Delivered – awaiting you | 62 verified Tucson/TUSD principals (Google Sheet) | **Drive** (shared 06-29) |
| 65 | Testimonials from storytellers/schools/authors | Delivered – awaiting you | Live Google Form + tracking sheet | **Drive** (shared 06-29) |
| 52 | Schedule 48 social posts in Metricool | Done | 48 posts scheduled on JRS account | Metricool app (no Drive/Slack link) |
| 40 | Fix JRS website positioning | In progress (drafted, gated) | Positioning audit + page-copy rewrite | vault draft (not shared) |
| 42 | School outreach email sequence | Delivered – awaiting you (approval) | 5-email sequence, merge-ready | vault draft |
| 43 | Schools→JRS→storyteller payments | Needs you | Payment-flow map (setup is human-only) | vault draft |
| 44/45 | Storyteller nurture + profile updates | Blocked (credential) | Nurture flow (needs Wix→GHL field map) | vault draft |
| 46 | LinkedIn storyteller sourcing | Needs you | 5-message flow + tracker (Derek sends) | vault draft |
| 47 | Webinar with Jason | Needs you (date/link) | Webinar kit | vault draft |
| 49/50 | TikTok Shop + Amazon | Needs you (owner-only) | Channel setup kit + listing metadata | vault draft |

**Brightly (12 of 27 tasks shown):**

| Task# | Title | Working status | Deliverable | Where |
|---|---|---|---|---|
| 13 | Confirm website ready to convert | Delivered – awaiting you (price decision) | Conversion-readiness audit | vault draft |
| 15 | Final policies (Privacy/Terms/SMS) | Done / needs-legal review | Legal pages live + walkthrough video | **Slack** (05-26 / 06-15) |
| 16 | Test signup/app/Airtable handoff | In progress (drafted) | Launch QA test script | vault draft |
| 17 | Bank account + insurance | Needs you (human-only) | LLC filings (Articles, EIN) | **Drive** folder |
| 18 | Technician contractor agreement | Blocked (needs-legal) | Draft outline (attorney must finalize) | vault draft |
| 20 | Checkr background-check process | Delivered – awaiting you (vendor decision) | Checkr research (steps/pricing) | vault draft |
| 30 | Vet referral partners | Needs you (price list) | Referral kit + Scottsdale STR mgmt list | **Slack** CSV + vault |
| 32 | Contact service providers | In progress (gated) | Scottsdale Licensed STR Registry — 3,008 leads | **Slack** file |
| 22 | Amazon Associate page | Needs you (account+tag) | Storefront copy + product research | vault draft |
| 24 | NHWA certification | In progress (drafted) | Requirements + deadlines tracker | vault draft |

**Hero blockers to feature in the mockup:** JRS #43 (payments) as "Needs you"; Brightly's single canonical-price decision (gates the whole Brightly launch chain) as the "at risk / blocked" driver.

---

## 8. First deliverable — the visual mockup

A single high-fidelity **PNG** (~1600×1100, Slack light theme), titled *"Agent M42 — Slack App Home cockpit (v0 read-only preview)"*, two panels side by side, authentic Slack chrome (aubergine rail, Apps group with "Agent M42" selected, App Home tabs Messages | About | **Home**):

- **Panel A — Home tab:** header → provenance/legend context → 🔔 Needs You (3 real rows from the sample: JRS #41 Delivered–awaiting, Brightly price/palette Needs-you, Brightly website Blocked) → 📊 Portfolio Health (JRS 🟢 On track, Brightly 🔴 Blocked, each with counts) → read-only footer.
- **Panel B — Task modal** (floating over dimmed Home): 2-col fields, deliverable card with source badge + Open-in-Drive/Slack buttons, description, what's-left, and the plain-text "Actions … coming in v1" line (visually proving the read-only decision).
- Caption strip: "v0 = read-only · same app promotes to Derek by granting access · sample data: JRS + Brightly".

Rendered with single-space count spacing and a truncated modal title so Claudio approves a layout Slack can actually reproduce. Produced via a frontend/canvas render **after this spec is approved**.

---

## 9. Scope — v0 vs v1 vs deferred (the zero-rework path)

| Layer | In v0? | Notes |
|---|---|---|
| See tasks by company / status | ✅ | Portfolio Health strip |
| Drill-down portfolio→company→task | ✅ | 3-tier |
| See each task's deliverable (Drive/Slack) | ✅ | Deliverable card |
| "Needs You" triage | ✅ | Pinned home section |
| Read-only, private (allowlist) | ✅ | In-app gate |
| Derek **acts**: comment / approve / request-changes | ➕ v1 | The modal footer slot is pre-shaped; v1 swaps the text line for an `actions` block (+ comment `input`). **No redesign.** |
| Two-way Slack write-back (message → task) | ➕ v1+ | Additive |
| Source-of-truth change (board canonical, Sheet as mirror) | ⏸ deferred | Only matters when Derek acts; not before |

**Buttons in v0:** the act-buttons are **hidden** (not greyed) — Block Kit has no true disabled state, so a fake-disabled button is a dead-end click. A single text line communicates the roadmap without a broken affordance. Only genuinely-working read-only buttons appear.

---

## 10. Privacy & access
- Enforced in-app via a **user_id allowlist** (Claudio + Derek + explicitly added). Non-authorized workspace members get a neutral "private app" view.
- Promotion to Derek = **add his user_id** to the allowlist. Nothing else changes. (This is the "no rework" promise made concrete.)

---

## 11. Open decisions for Claudio
1. **Live-status source for v0 (the important one, from Finding A).** Recommended: add **`Working Status`** + **`Deliverable Link`** columns to the existing Sheet, filled by the process that already maintains the tracker — cockpit reads those. Alternative: cockpit reads the board issues / a vault-derived export. *Rec: Sheet columns (simplest, single source, promotable).*
2. **Doc location.** This spec is in the paperclip repo under `docs/superpowers/specs/`. OK, or mirror to the Obsidian `Wiki/Projetos/Paperclip-Fork/` instead? (Not committed to git yet — your call.)
3. **Mockup go-ahead.** Produce the PNG now (next step) so you judge the look before any build?

---

## 12. Milestones / next steps
1. ✅ Brainstorm → this spec.
2. ⏭ **You review this spec** (and answer §11).
3. Produce the **visual mockup** (Panel A + B) → you judge.
4. If approved → write the implementation plan (writing-plans skill): sidecar scaffold, allowlist gate, data adapter (§11 source), status normalizer, Home/company/modal views, deploy on the VPS.
5. Private test on JRS + Brightly (just Claudio) → evaluate → decide on Derek.

---

## 13. Scope update — post-mockup (2026-07-02)

After Claudio approved the mockup he added requirements. Triaged against Slack feasibility:

- **Filter by company / by status** — ✅ v0. `static_select` filter row on the Home tab.
- **Sort (incl. "most recent" by last activity)** — ✅ v0. `static_select` sort menu. Requires a per-task **`Last Updated`** value in the data source (add alongside `Working Status` / `Deliverable Link`).
- **Search by description or deliverable** — ✅ v0, but **not a live search bar** (App Home has none): a **🔍 Search** button opens a modal with a text `input` + submit → results list (or a `/m42 <query>` slash command).
- **Notes / comments that become context the agent reads and acts on** — ✅ but this is the **act layer (Plan 2)**, not read-only v0. It reactivates the deferred source-of-truth question (see decision below).
- **@mention a Slack user in a comment (notifies them)** — ✅ Plan 2. Comments surface as Slack messages; `@user` notifies natively.

**Decision D1 (comment routing) — recommended, pending Claudio's confirm:** cockpit comments/requests are written to the **AgentM42 board issue** for that task (native "comment wakes the assignee agent" → the agent reads it as context and continues). The **Sheet stays Derek's read-facing list; the board becomes where acting happens.** Two comment kinds: **📝 Note** (context only, does not wake an agent) vs **💬 Comment/Request** (wakes the agent). For tasks not yet board issues, the cockpit creates the issue on first comment (`status='todo'`, per the issue-creation gotcha).

**Build split:** Plan 1 = v0 read-only cockpit + filters/sort/search (unblocked). Plan 2 = act layer (D1) + @mentions (after Claudio confirms D1).

**Human prerequisite (Phase 0, only Claudio/Derek can do it):** create the "Agent M42" Slack app in the M42 workspace and provide its tokens. See Plan 1 Phase 0.

---

### Appendix — reference patterns emulated (don't reinvent)
Asana Portfolios (company rollup + traffic-light status) · Linear Inbox (Needs-You triage) · Linear issue-peek (task modal) · Linear human-readable status pills · Height deliverable-first/agent-native framing · Inbox-Zero reward (empty Needs-You). Asana's native **Approvals** object is the reference for the v1 "request changes to delivered" control — implemented ourselves, not by buying Asana.
