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
4. Deploy to VPS (run `.deploy/16-pull-and-rebuild.sh`).

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
- **Canonical deploy script:** `.deploy/16-pull-and-rebuild.sh` (gitignored, local-only). Pulls latest `branding/m42`, auto-bumps `PAPERCLIP_BRAND_REVISION` per HEAD SHA change (counter persisted in `.env.prod` + `.last-deployed-sha` on VPS), rebuilds server, validates. **Do not use other rebuild scripts in `.deploy/`** without reading their header — `17-deploy-with-revision.sh` was archived 2026-05-26 because its `rev-list --count origin/master..HEAD` formula jumped on every weekly upstream rebase.
- **Deploy command:** `ssh root@72.61.6.37` and run the commands in `.deploy/16-pull-and-rebuild.sh` (the file is local on Windows workstation; not present on VPS — paste contents over SSH).
- **Other canonical scripts at `.deploy/` root** (after cleanup): `26-list-final.sh` (DB company inspection), `13-test-routes.sh` (route smoke beyond `/` + `/onboarding`), `41-validate-m42.sh` (greps UI bundle for `M42 Agent` rebrand), `14-debug-branding.sh` (triage when `16` output looks wrong), `20-rebuild-with-opencode.sh` / `21-prepare-opencode-auth.sh` / `22-validate-opencode-auth.sh` (opencode runbook), `40-rebuild-verbose.sh` (full build log), `backup.sh`, bootstrap scripts `02/05/07/10/11/15`. Anything not in this list at root is also canonical-by-default; everything in `.deploy/_archive/` is reference-only.
- **Env vars for branding:** `PAPERCLIP_INSTANCE_BRANDING=true`, `PAPERCLIP_BRAND_NAME=M42 Agent`, `PAPERCLIP_BRAND_SHORT_NAME=M42`, `PAPERCLIP_BRAND_REVISION=<auto-incremented integer>` (in `.env.prod` on the VPS, never in git)
- **DB:** PostgreSQL 17 in Docker (volume `/opt/data/paperclip-db`), backups daily 03:00 in `/opt/backups/` (retention 30 days)

## Claude Runner (SSH execution target)

A sibling Docker container `claude-runner` hosts Claude Code, Codex and OpenCode CLIs plus whatever MCP servers (Slack, Gmail, etc.) are configured. The Paperclip server reaches it over the internal `runner-net` Docker network as `claude-runner:22`; no port is exposed to the host.

- **Why:** When an agent runs in a Paperclip SSH environment, the CLI executes on the SSH target with that target's `$HOME` — so MCPs installed in `/home/runner/.claude/mcp_servers.json` on the runner are inherited automatically (see `reference_paperclip_no_native_oauth_inheritance` memory).
- **Persistent state:** Host volume `/opt/data/claude-runner-home` is bind-mounted to `/home/runner/`. MCP configs, OAuth tokens, and any state Derek installs there survive container rebuilds.
- **SSH key:** Generated by `docker/claude-runner/setup.sh` on first run; private key stored at `/opt/data/claude-runner-keys/paperclip-server-to-claude-runner` (chmod 600, never in git). The matching public key is appended to `/opt/data/claude-runner-home/.ssh/authorized_keys`.
- **First boot:** SSH `root@72.61.6.37`, then `cd /opt/apps/paperclip && bash docker/claude-runner/setup.sh`. Prints the private key once for pasting into Paperclip → Settings → Environments (driver SSH, host `claude-runner`, port 22, username `runner`, remote workspace path `/home/runner/workspace`).
- **Rebuilds:** Included in the standard `docker compose ... up -d --build` cycle. The runner build step is independent of the server build — failures there don't block server deploys (`docker compose up -d --build server` rebuilds only server).
- **Adding MCPs:** SSH into the runner via the host (`docker compose exec claude-runner bash` from `/opt/apps/paperclip` as root), edit `/home/runner/.claude/mcp_servers.json`, install any MCP npm packages, restart the runner if needed.

## Secrets and operational details

Production secrets (`BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, Slack/Google MCP tokens, etc.) live exclusively in `/opt/apps/paperclip/.env.prod` and `/opt/data/paperclip/.config/opencode/opencode.json` on the VPS. There is no local mirror — recover by `ssh root@72.61.6.37 'cat /opt/apps/paperclip/.env.prod'` if needed. `.deploy/` on this workstation is gitignored and holds only ops scripts.

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
| Knowledge base | `c:\Users\cralv\dev\Obsidian\Wiki\Projetos\Paperclip-Fork\` | The human operator (long-term memory) |
| Local observability dashboard | `.deploy/observability/` (gitignored — collector + HTML dashboard) | The human operator |

Keep `.cursor/rules`, `CLAUDE.md`, and the Obsidian Wiki in sync when policy changes.
