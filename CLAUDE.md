# CLAUDE.md — M42 Agent fork (cralves2010/paperclip)

Project-level guidance for Claude Code CLI and any other agent that opens this repo. The Cursor IDE reads its own copy at `.cursor/rules/m42-fork-strategy.mdc`; this file mirrors that contract for non-Cursor surfaces. Keep them in sync when changing one.

> If you read this file and the AGENTS.md from upstream both: AGENTS.md describes how to develop **inside the upstream paperclip repo**; THIS file describes how this **fork** differs and the operational rules for our white-label deployment. Where they conflict, this file wins for fork-only concerns (branding, sync, deploy).

## What this fork is

Commercial white-label fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip) rebranded as **M42 Agent**, deployed to a Hostinger VPS at https://agent.m42ai.tech.

## Branches — hard rules

| Branch | Role | Who edits |
|---|---|---|
| `master` | Mirror of upstream `paperclipai/paperclip:master`. **Never commit here.** Only the GH Action does fast-forward from upstream. | GH Action only |
| `branding/m42` | **Production branch.** Contains all our brand/CI/fix patches on top of master. This is what the VPS deploys. | Us (commit + push) |
| `my-customizations` | Local-only dev workspace, not deployed. Mostly empty / aligned with master. | Local only |

Default branch on the fork is `branding/m42` so the cron in `.github/workflows/sync-upstream.yml` fires from it.

## Upstream sync — current state: "Option C" (sync with master)

The GH Action runs **Mondays 06:00 UTC** (≈ 03:00 BRT) plus manual via `workflow_dispatch`:

1. Fast-forward fork `master` ← upstream `master`
2. Rebase `branding/m42` onto fork `master` (with `git rerere` enabled)
3. Push `branding/m42` if rebased; open issue tagged `sync,needs-manual` on conflict
4. Detect latest stable upstream tag (`vYYYY.MDD.0`, no canary, no 0.x). When `origin/master` is an ancestor of that tag (i.e. the tag contains everything in our master), open an issue tagged `upstream-tag,ready-to-switch`.

We chose Option C (master) instead of tag-based sync because upstream master is ~30 commits ahead of the latest stable tag (`v2026.517.0` as of 2026-05-25), so switching now would roll back applied DB migrations. We wait for a future tag that includes everything currently in master, then migrate.

## When the "ready to switch" issue appears

Open the issue, then in this repo:

1. Edit `.github/workflows/sync-upstream.yml`, replace `git rebase origin/master` with `git rebase <TAG>` (the tag in the issue title).
2. Commit `ci:` to `branding/m42`.
3. Trigger workflow manually, verify rebase clean.
4. Deploy to VPS (see `.deploy/HANDOVER.md` for the rebuild command).

Do **not** migrate to a tag before the signal — the schema would regress.

## Commit conventions on `branding/m42`

- `brand:` — branding patches (strings, logos, titles)
- `fix:` — bug fixes (ideally upstreamable as PRs back to paperclipai/paperclip)
- `ci:` — workflow / GH Action changes
- `feat:` — fork-specific features that have no upstream counterpart

Keep commits atomic. Each one survives `git rebase` cleanly when upstream evolves.

## Production environment

- **VPS:** Hostinger KVM 4, `72.61.6.37`, Ubuntu 24.04 + Docker
- **URL:** https://agent.m42ai.tech (Caddy + Let's Encrypt)
- **Deploy:** `ssh root@72.61.6.37` → `/opt/apps/paperclip` → `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build server`
- **Env vars for branding:** `PAPERCLIP_INSTANCE_BRANDING=true`, `PAPERCLIP_BRAND_NAME=M42 Agent`, `PAPERCLIP_BRAND_SHORT_NAME=M42` (in `.env.prod` on the VPS, never in git)
- **DB:** PostgreSQL 17 in Docker (volume `/opt/data/paperclip-db`), backups daily 03:00 in `/opt/backups/` (retention 30 days)

## Secrets and operational details

The local file `.deploy/HANDOVER.md` on the Windows workstation (`c:\Users\cralv\dev\paperclip\.deploy\HANDOVER.md`) holds:

- `BETTER_AUTH_SECRET`
- `POSTGRES_PASSWORD`
- VPS SSH details
- Full deploy/restore commands

`.deploy/` is in `.gitignore` — never commit it. The file is not replicated to remote storage; protect it locally.

## Brand surface — where "Paperclip" still appears

After 4 branding batches:

- ✅ Server: `<title>`, meta tags, brand env vars
- ✅ UI: BreadcrumbContext, Auth, Dashboard, sidebar, invites, settings, agents, secrets, routines, system notices
- ❌ NOT rebranded (intentional):
  - Lucide `<Paperclip />` icon imports — it is a paperclip icon, not the brand
  - TS identifiers (`usePaperclipIssueRuntime`, `PaperclipSprite`, etc) — internal symbols
  - Comments / package names (`@paperclipai/*`)
  - Markdown export attribution (`paperclip.ing` link in `ui/src/pages/CompanyExport.tsx`) — fair-use attribution
  - `DOCS_URL` constant in `ui/src/components/SidebarAccountMenu.tsx` (still points to upstream docs)
  - Fixtures, UX-labs pages (`*UxLab.tsx`), Storybook

Use `BRAND_NAME` (long, "M42 Agent") or `BRAND_SHORT_NAME` (short, "M42") from `ui/src/lib/brand.ts` for user-facing copy. Pattern: short name in hyphenated labels (`M42-managed`), long name elsewhere.

## What NOT to do

- Don't commit to `master` (use `branding/m42`)
- Don't push `--force` without `--force-with-lease`
- Don't migrate to tag-based sync before the "ready to switch" issue
- Don't rebase `branding/m42` on a tag that is behind `origin/master`
- Don't touch the legacy regex matchers in `ui/src/lib/successful-run-handoff.ts` — they exist to detect upstream-branded notices in old DB rows
- Don't enable the workflow's "Open issue if conflict" or "Open issue when tag safe" twice in parallel — issues are deduplicated by title

## Where else this context lives

| Surface | File | Audience |
|---|---|---|
| Cursor IDE | `.cursor/rules/m42-fork-strategy.mdc` | Cursor agents (any chat in this workspace) |
| Claude Code CLI / other agents | This file (`CLAUDE.md`) | Anything outside Cursor that reads `CLAUDE.md` |
| Local secrets / runbook | `.deploy/HANDOVER.md` (Windows-only, gitignored) | The human operator |
| Knowledge base | `c:\Users\cralv\dev\Obsidian\Wiki\Projetos\Paperclip-Fork\` | The human operator (long-term memory) |

Keep the three rule files (`.cursor/rules`, `CLAUDE.md`, Obsidian Wiki) in sync when policy changes. The HANDOVER stays separate because it carries secrets.
