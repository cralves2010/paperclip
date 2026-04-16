# iAlvesTEC Custom Modules

Custom packages for this Paperclip fork. All iAlvesTEC-specific code lives here
to keep a clean separation from upstream and minimise merge conflicts.

## Rules

1. **Never modify upstream files** — `server/`, `ui/`, `cli/`, `packages/`,
   `scripts/`, `doc/`, `docs/`, `docker/`, `tests/`, `evals/` are owned by
   upstream. Treat them as read-only.
2. **Import, don't patch** — consume upstream packages via `workspace:*`
   dependencies (e.g. `@paperclipai/shared`, `@paperclipai/db`). Never
   monkey-patch or duplicate upstream code.
3. **Namespace packages** — use the `@ialvestec/` scope for all custom packages
   to avoid name collisions.
4. **One package per concern** — each subfolder under `iAlvesTEC/` is a standalone
   pnpm workspace package with its own `package.json` and `tsconfig.json`.

## Syncing with upstream

```bash
git fetch upstream
git merge upstream/master   # resolve conflicts only in pnpm-workspace.yaml / tsconfig.json
```

Conflicts are limited to the few lines we added in `pnpm-workspace.yaml`
and `tsconfig.json` — both trivially resolvable.
