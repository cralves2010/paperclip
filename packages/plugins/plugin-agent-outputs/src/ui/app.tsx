import {
  MarkdownBlock,
  Spinner,
  StatusBadge,
  usePluginData,
  useHostLocation,
  useHostNavigation,
  type PluginPageProps,
  type PluginSidebarProps,
  type StatusBadgeVariant,
} from "@paperclipai/plugin-sdk/ui";
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
  FilterOptions,
  MimeGroup,
  OutputDetail,
  OutputKind,
  OutputListPage,
  OutputRow,
} from "../outputs/types.js";

const tokens = {
  border: "var(--border, oklch(0.269 0 0))",
  card: "var(--card, oklch(0.205 0 0))",
  bg: "var(--background, oklch(0.145 0 0))",
  fg: "var(--foreground, oklch(0.985 0 0))",
  muted: "var(--muted-foreground, oklch(0.708 0 0))",
  accent: "var(--accent, oklch(0.269 0 0))",
  primary: "var(--primary, oklch(0.985 0 0))",
};

const fontStack = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

const ALL_KINDS: OutputKind[] = ["document", "comment", "asset", "interaction"];
const KIND_LABELS: Record<OutputKind, string> = {
  document: "Document",
  comment: "Comment",
  asset: "File",
  interaction: "Interaction",
};

const MIME_GROUPS: { value: MimeGroup; label: string }[] = [
  { value: "image", label: "Images" },
  { value: "document", label: "Docs" },
  { value: "code", label: "Code/JSON" },
  { value: "other", label: "Other" },
];

function kindVariant(kind: OutputKind): StatusBadgeVariant {
  switch (kind) {
    case "document": return "info";
    case "comment": return "pending";
    case "asset": return "ok";
    case "interaction": return "warning";
  }
}

// ---------------------------------------------------------------------------
// SidebarLink
// ---------------------------------------------------------------------------

export function SidebarLink({ context }: PluginSidebarProps): ReactNode {
  const nav = useHostNavigation();
  const location = useHostLocation();
  if (!context.companyPrefix) return null;
  const target = `/${context.companyPrefix}/outputs`;
  const active = location.pathname.startsWith(target);
  return (
    <button
      type="button"
      onClick={() => nav.navigate(target)}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 6,
        color: active ? tokens.primary : tokens.fg,
        background: active ? tokens.accent : "transparent",
        fontSize: 14,
        fontFamily: fontStack,
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>📂</span>
      <span>Agent Outputs</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// OutputsPage
// ---------------------------------------------------------------------------

interface FilterState {
  projectId: string;
  agentId: string;
  kind: OutputKind | "";
  mime: MimeGroup | "";
  search: string;
  cursor: string;
}

function readFiltersFromUrl(query: URLSearchParams): FilterState {
  return {
    projectId: query.get("projectId") ?? "",
    agentId: query.get("agentId") ?? "",
    kind: (query.get("kind") as OutputKind | null) ?? "",
    mime: (query.get("mime") as MimeGroup | null) ?? "",
    search: query.get("q") ?? "",
    cursor: query.get("cursor") ?? "",
  };
}

function writeFiltersToUrl(filters: Partial<FilterState>, baseQuery: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(baseQuery);
  for (const [key, value] of Object.entries(filters)) {
    const queryKey = key === "search" ? "q" : key;
    if (!value) out.delete(queryKey);
    else out.set(queryKey, value as string);
  }
  return out;
}

export function OutputsPage({ context }: PluginPageProps): ReactNode {
  const nav = useHostNavigation();
  const location = useHostLocation();
  const urlQuery = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const filters = useMemo(() => readFiltersFromUrl(urlQuery), [urlQuery]);

  const { companyId, companyPrefix } = context;
  if (!companyId || !companyPrefix) {
    return (
      <div style={{ padding: 24, fontFamily: fontStack, color: tokens.muted }}>
        Agent Outputs requires an active company context.
      </div>
    );
  }

  const filterOptionsData = usePluginData<FilterOptions>("filter-options", {
    companyId,
  });

  const listParams = useMemo(() => {
    const params: Record<string, string> = { companyId: companyId };
    if (filters.projectId) params.projectId = filters.projectId;
    if (filters.agentId) params.agentId = filters.agentId;
    if (filters.kind) params.kind = filters.kind;
    if (filters.mime) params.mime = filters.mime;
    if (filters.search) params.q = filters.search;
    if (filters.cursor) params.cursor = filters.cursor;
    return params;
  }, [companyId, filters]);

  const listData = usePluginData<OutputListPage>("list", listParams);

  const updateFilter = useCallback(
    (patch: Partial<FilterState>) => {
      const reset = "cursor" in patch ? {} : { cursor: "" };
      const merged = writeFiltersToUrl({ ...patch, ...reset }, urlQuery);
      nav.navigate(`${location.pathname}?${merged.toString()}`, { replace: true });
    },
    [nav, location.pathname, urlQuery],
  );

  const [selectedRow, setSelectedRow] = useState<OutputRow | null>(null);

  return (
    <div style={{ padding: 24, fontFamily: fontStack, color: tokens.fg, background: tokens.bg, minHeight: "100vh" }}>
      <header style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Agent Outputs</h1>
          <p style={{ margin: "4px 0 0", color: tokens.muted, fontSize: 13 }}>
            Documents, comments, attachments and thread interactions authored by AI agents across all company issues.
          </p>
        </div>
        {filterOptionsData.data ? (
          <span style={{ color: tokens.muted, fontSize: 12 }}>
            {filterOptionsData.data.totalAgentRows.toLocaleString()} agent-authored rows
          </span>
        ) : null}
      </header>

      <CoverageNotice />

      <FilterBar
        filters={filters}
        options={filterOptionsData.data ?? undefined}
        onChange={updateFilter}
      />

      <section
        style={{
          marginTop: 16,
          border: `1px solid ${tokens.border}`,
          borderRadius: 8,
          background: tokens.card,
          overflow: "hidden",
        }}
      >
        {listData.loading && !listData.data ? (
          <div style={{ padding: 32, display: "flex", justifyContent: "center" }}>
            <Spinner />
          </div>
        ) : listData.error ? (
          <div style={{ padding: 24, color: tokens.muted }}>Failed to load: {listData.error.message}</div>
        ) : !listData.data || listData.data.rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: tokens.muted, fontSize: 13 }}>
            No agent outputs match the current filters.
          </div>
        ) : (
          <OutputsTable
            rows={listData.data.rows}
            companyPrefix={companyPrefix}
            onRowClick={setSelectedRow}
          />
        )}
      </section>

      <footer style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          type="button"
          disabled={!filters.cursor}
          onClick={() => updateFilter({ cursor: "" })}
          style={buttonStyle(!filters.cursor)}
        >
          ← First
        </button>
        <button
          type="button"
          disabled={!listData.data?.nextCursor}
          onClick={() => updateFilter({ cursor: listData.data?.nextCursor ?? "" })}
          style={buttonStyle(!listData.data?.nextCursor)}
        >
          Next →
        </button>
      </footer>

      {selectedRow ? (
        <PreviewDialog
          row={selectedRow}
          companyId={companyId}
          onClose={() => setSelectedRow(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutputsTable — custom table, since DataTable lacks row-click
// ---------------------------------------------------------------------------

interface OutputsTableProps {
  rows: OutputRow[];
  companyPrefix: string;
  onRowClick: (row: OutputRow) => void;
}

function OutputsTable({ rows, companyPrefix, onRowClick }: OutputsTableProps): ReactNode {
  const headerStyle: CSSProperties = {
    padding: "10px 12px",
    textAlign: "left",
    color: tokens.muted,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: `1px solid ${tokens.border}`,
    background: tokens.bg,
  };
  const cellStyle: CSSProperties = {
    padding: "10px 12px",
    borderBottom: `1px solid ${tokens.border}`,
    verticalAlign: "top",
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          <th style={headerStyle}>Kind</th>
          <th style={headerStyle}>Title / Preview</th>
          <th style={headerStyle}>Agent</th>
          <th style={headerStyle}>Project</th>
          <th style={headerStyle}>Issue</th>
          <th style={headerStyle}>Created</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={`${row.kind}:${row.rowId}`}
            onClick={() => onRowClick(row)}
            style={{ cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = tokens.accent)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <td style={cellStyle}>
              <StatusBadge label={KIND_LABELS[row.kind]} status={kindVariant(row.kind)} />
            </td>
            <td style={cellStyle}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 200, maxWidth: 360 }}>
                <span style={{ fontWeight: 500, color: tokens.fg }}>
                  {row.previewLabel ?? (row.previewSnippet ?? "(no preview)").slice(0, 80)}
                </span>
                {row.previewSnippet && row.previewLabel ? (
                  <span style={{ fontSize: 12, color: tokens.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.previewSnippet}
                  </span>
                ) : null}
              </div>
            </td>
            <td style={cellStyle}>
              <span style={{ color: tokens.fg }}>
                {row.agent?.name ?? row.agent?.id?.slice(0, 8) ?? "—"}
              </span>
            </td>
            <td style={cellStyle}>
              {row.project ? (
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: row.project.color ? `${row.project.color}33` : tokens.accent,
                    color: row.project.color ?? tokens.fg,
                    fontSize: 12,
                  }}
                >
                  {row.project.name ?? "Unnamed"}
                </span>
              ) : (
                <span style={{ color: tokens.muted }}>—</span>
              )}
            </td>
            <td style={cellStyle}>
              <a
                href={`/${companyPrefix}/issues/${row.issue.identifier ?? row.issue.id}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: tokens.primary, fontSize: 13, textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                {row.issue.identifier ?? row.issue.id.slice(0, 8)}
              </a>
            </td>
            <td style={cellStyle}>
              <span style={{ color: tokens.muted, fontSize: 12 }}>
                {formatRelative(row.createdAt)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  filters: FilterState;
  options: FilterOptions | undefined;
  onChange: (patch: Partial<FilterState>) => void;
}

function FilterBar({ filters, options, onChange }: FilterBarProps): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        padding: 12,
        border: `1px solid ${tokens.border}`,
        borderRadius: 8,
        background: tokens.card,
      }}
    >
      <select
        value={filters.kind}
        onChange={(e) => onChange({ kind: (e.target.value || "") as OutputKind | "" })}
        style={selectStyle()}
        aria-label="Filter by kind"
      >
        <option value="">All kinds</option>
        {ALL_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>

      <select
        value={filters.projectId}
        onChange={(e) => onChange({ projectId: e.target.value })}
        style={selectStyle()}
        aria-label="Filter by project"
      >
        <option value="">All projects</option>
        {(options?.projects ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name ?? "Unnamed"}
          </option>
        ))}
      </select>

      <select
        value={filters.agentId}
        onChange={(e) => onChange({ agentId: e.target.value })}
        style={selectStyle()}
        aria-label="Filter by agent"
      >
        <option value="">All agents</option>
        {(options?.agents ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name ?? a.id.slice(0, 8)}
          </option>
        ))}
      </select>

      <select
        value={filters.mime}
        onChange={(e) => onChange({ mime: (e.target.value || "") as MimeGroup | "" })}
        style={selectStyle()}
        aria-label="Filter by file type"
      >
        <option value="">Any file type</option>
        {MIME_GROUPS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      <input
        type="search"
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
        placeholder="Search filename or text…"
        style={{
          ...selectStyle(),
          minWidth: 200,
          padding: "6px 10px",
        }}
        aria-label="Search outputs"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CoverageNotice
// ---------------------------------------------------------------------------

function CoverageNotice(): ReactNode {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "10px 14px",
        border: `1px dashed ${tokens.border}`,
        borderRadius: 6,
        background: "oklch(0.2 0.04 250)",
        color: "oklch(0.85 0.08 250)",
        fontSize: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span>
        Catalog covers <strong>documents</strong>, <strong>comments</strong>, <strong>attachments</strong> and{" "}
        <strong>thread interactions</strong> authored by agents. Pull requests, deploys and workspace files are not indexed yet.
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 4,
          color: tokens.muted,
          fontSize: 11,
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PreviewDialog
// ---------------------------------------------------------------------------

interface PreviewDialogProps {
  row: OutputRow;
  companyId: string;
  onClose: () => void;
}

function PreviewDialog({ row, companyId, onClose }: PreviewDialogProps): ReactNode {
  const detailParams = useMemo(
    () => ({ companyId, kind: row.kind, id: row.rowId }),
    [companyId, row.kind, row.rowId],
  );
  const detail = usePluginData<OutputDetail>("detail", detailParams);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(900px, 90vw)",
          maxHeight: "85vh",
          background: tokens.card,
          border: `1px solid ${tokens.border}`,
          borderRadius: 10,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ padding: 14, borderBottom: `1px solid ${tokens.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <StatusBadge label={KIND_LABELS[row.kind]} status={kindVariant(row.kind)} />
            <span style={{ marginLeft: 10, color: tokens.fg, fontSize: 14 }}>
              {row.previewLabel ?? "(no title)"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ all: "unset", cursor: "pointer", padding: "4px 10px", color: tokens.muted, fontSize: 14 }}
          >
            ✕
          </button>
        </header>
        <div style={{ padding: 16, overflow: "auto", flex: 1, color: tokens.fg, fontSize: 13 }}>
          {detail.loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
              <Spinner />
            </div>
          ) : detail.error ? (
            <div style={{ color: tokens.muted }}>Failed to load: {detail.error.message}</div>
          ) : detail.data ? (
            <PreviewBody detail={detail.data} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PreviewBody({ detail }: { detail: OutputDetail }): ReactNode {
  if (detail.kind === "asset" && detail.contentUrl) {
    const ct = detail.contentType ?? "";
    if (ct.startsWith("image/")) {
      return <img src={detail.contentUrl} alt={detail.previewLabel ?? "attachment"} style={{ maxWidth: "100%" }} />;
    }
    if (ct === "application/pdf") {
      return <iframe src={detail.contentUrl} title={detail.previewLabel ?? "PDF"} style={{ width: "100%", minHeight: 600, border: "none" }} />;
    }
    return (
      <div>
        <p style={{ color: tokens.muted, marginBottom: 12 }}>
          {detail.contentType ?? "unknown type"} · {formatBytes(detail.byteSize)}
        </p>
        <a href={detail.contentUrl} download style={{ color: tokens.primary }}>
          Download {detail.previewLabel ?? "file"}
        </a>
      </div>
    );
  }
  if (detail.kind === "document" || detail.kind === "comment") {
    return <MarkdownBlock content={detail.body ?? detail.previewSnippet ?? ""} />;
  }
  if (detail.kind === "interaction") {
    return (
      <pre
        style={{
          background: tokens.bg,
          padding: 12,
          borderRadius: 6,
          overflow: "auto",
          fontSize: 12,
          color: tokens.fg,
        }}
      >
        {JSON.stringify(detail.payload, null, 2)}
      </pre>
    );
  }
  return <div style={{ color: tokens.muted }}>(no preview available)</div>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function selectStyle(): CSSProperties {
  return {
    appearance: "none",
    padding: "6px 10px",
    background: tokens.bg,
    color: tokens.fg,
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    fontSize: 13,
    fontFamily: fontStack,
    minWidth: 140,
    cursor: "pointer",
  };
}

function buttonStyle(disabled: boolean): CSSProperties {
  return {
    all: "unset",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    padding: "6px 14px",
    background: tokens.card,
    color: tokens.fg,
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    fontSize: 13,
    fontFamily: fontStack,
  };
}
