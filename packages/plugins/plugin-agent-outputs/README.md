# @m42/plugin-agent-outputs

Unified catalog of everything AI agents have produced inside a Paperclip company. Indexes four sources and exposes a board-only page with filters, search, and previews.

## What it indexes

- **Documents** (`public.documents` + `public.issue_documents`) — markdown plans, specs, continuations written by agents
- **Comments** (`public.issue_comments`) — inline text responses from agents
- **Attachments** (`public.issue_attachments` + `public.assets`) — binary outputs (PDFs, images, exports)
- **Thread interactions** (`public.issue_thread_interactions`) — structured agent suggestions (suggest_tasks, ask_user_questions, request_confirmation)

All four queries filter by `created_by_agent_id IS NOT NULL` (and `author_agent_id` for comments) so the catalog shows agent-authored rows only.

## What it does NOT cover (yet)

- **Work products** (`public.issue_work_products`) — PRs, deploys, releases. The table has no `created_by_agent_id` upstream — needs schema change. Tracked as Phase 1.5.
- **Workspace files** — code/configs that live only in `execution_workspaces` filesystem, not in the database.
- **Document revisions** — deliberately excluded for safety. Revisions can contain content users deleted on purpose.

The UI shows a coverage banner so end users know what's in vs out.

## Endpoints

| Route key | Method | Path | Description |
|---|---|---|---|
| `list` | GET | `/outputs` | Paginated list with filters: project, date range, kind, agent, search |
| `detail` | GET | `/outputs/:kind/:id` | Single row with full preview content |
| `filter-options` | GET | `/filter-options` | Projects and agents populated for the dropdowns |

All routes are `auth: "board"` (board users only — agents are not consumers of this plugin in MVP).

## UI

Sidebar item **Agent Outputs** opens `/:companyPrefix/outputs`. Page layout: filter bar on top, paginated table below, polymorphic preview dialog on row click.

## Database

No own schema — pure index over public tables. Manifest declares `coreReadTables`: `documents`, `issue_documents`, `issue_comments`, `issue_attachments`, `assets`, `issue_thread_interactions`, `issues`, `projects`, `agents`, `companies`.

All queries include `WHERE ... company_id = $1` — enforced by the host's tenant-isolation guard in `validatePluginRuntimeQuery`.

## Build

```bash
pnpm --filter @m42/plugin-agent-outputs build
```

## Development

```bash
pnpm --filter @m42/plugin-agent-outputs dev       # esbuild watch
pnpm --filter @m42/plugin-agent-outputs dev:ui    # UI dev server on :4178
pnpm --filter @m42/plugin-agent-outputs test      # vitest unit tests
```

## Install in a Paperclip instance

This plugin lives in the same monorepo as the Paperclip server. After `pnpm install` at the root:

1. Open the Paperclip board.
2. Navigate to Settings → Plugins → Install local.
3. Point at `packages/plugins/plugin-agent-outputs/`.
4. The "Agent Outputs" item appears in the company sidebar.

## License

MIT.
