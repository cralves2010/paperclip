import type { PluginContext } from "@paperclipai/plugin-sdk";
import type {
  FilterOptions,
  MimeGroup,
  OutputFilters,
  OutputKind,
  OutputListPage,
  OutputRow,
  RawUnifiedRow,
} from "./types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ALL_KINDS: readonly OutputKind[] = ["document", "comment", "asset", "interaction"];

export function classifyMime(contentType: string | null | undefined): MimeGroup {
  if (!contentType) return "other";
  const lower = contentType.toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (
    lower === "application/pdf" ||
    lower === "application/msword" ||
    lower.includes("officedocument") ||
    lower === "text/plain" ||
    lower === "text/markdown"
  ) {
    return "document";
  }
  if (lower.startsWith("text/") || lower === "application/json") return "code";
  return "other";
}

function clampLimit(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

function selectedKinds(filter: OutputFilters): readonly OutputKind[] {
  if (!filter.kinds || filter.kinds.length === 0) return ALL_KINDS;
  return filter.kinds;
}

function parseCursor(cursor: string | undefined): { createdAt: string; rowId: string } | null {
  if (!cursor) return null;
  const [createdAt, rowId] = cursor.split("|");
  if (!createdAt || !rowId) return null;
  return { createdAt, rowId };
}

function makeCursor(row: { createdAt: string; rowId: string }): string {
  return `${row.createdAt}|${row.rowId}`;
}

function compareDesc(a: RawUnifiedRow, b: RawUnifiedRow): number {
  if (a.created_at < b.created_at) return 1;
  if (a.created_at > b.created_at) return -1;
  if (a.row_id < b.row_id) return 1;
  if (a.row_id > b.row_id) return -1;
  return 0;
}

interface QueryBuilder {
  sql: string;
  params: unknown[];
}

function buildDocumentQuery(filter: OutputFilters, limit: number): QueryBuilder {
  const params: unknown[] = [filter.companyId];
  const where: string[] = ["d.company_id = $1", "d.created_by_agent_id IS NOT NULL"];
  if (filter.projectId) {
    params.push(filter.projectId);
    where.push(`i.project_id = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    where.push(`d.created_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to);
    where.push(`d.created_at < $${params.length}`);
  }
  if (filter.agentId) {
    params.push(filter.agentId);
    where.push(`d.created_by_agent_id = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    where.push(`(d.title ILIKE $${params.length} OR d.latest_body ILIKE $${params.length})`);
  }
  const cursor = parseCursor(filter.cursor);
  if (cursor) {
    params.push(cursor.createdAt);
    params.push(cursor.rowId);
    where.push(`(d.created_at, d.id::text) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }
  params.push(limit);

  const sql = `
    SELECT 'document'::text AS kind,
           d.id::text AS row_id,
           d.title AS preview_label,
           LEFT(d.latest_body, 240) AS preview_snippet,
           NULL::text AS content_type,
           NULL::bigint AS byte_size,
           d.created_at::text AS created_at,
           d.created_by_agent_id AS agent_id,
           ag.name AS agent_name,
           d.created_by_user_id AS user_id,
           idoc.issue_id,
           i.identifier AS issue_identifier,
           i.title AS issue_title,
           i.project_id,
           p.name AS project_name,
           p.color AS project_color,
           NULL::uuid AS attachment_id
      FROM public.documents d
      JOIN public.issue_documents idoc ON idoc.document_id = d.id
      JOIN public.issues i ON i.id = idoc.issue_id
 LEFT JOIN public.projects p ON p.id = i.project_id
 LEFT JOIN public.agents ag ON ag.id = d.created_by_agent_id
     WHERE ${where.join(" AND ")}
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT $${params.length}`;
  return { sql, params };
}

function buildCommentQuery(filter: OutputFilters, limit: number): QueryBuilder {
  const params: unknown[] = [filter.companyId];
  const where: string[] = ["ic.company_id = $1", "ic.author_agent_id IS NOT NULL"];
  if (filter.projectId) {
    params.push(filter.projectId);
    where.push(`i.project_id = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    where.push(`ic.created_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to);
    where.push(`ic.created_at < $${params.length}`);
  }
  if (filter.agentId) {
    params.push(filter.agentId);
    where.push(`ic.author_agent_id = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    where.push(`ic.body ILIKE $${params.length}`);
  }
  const cursor = parseCursor(filter.cursor);
  if (cursor) {
    params.push(cursor.createdAt);
    params.push(cursor.rowId);
    where.push(`(ic.created_at, ic.id::text) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }
  params.push(limit);

  const sql = `
    SELECT 'comment'::text AS kind,
           ic.id::text AS row_id,
           NULL::text AS preview_label,
           LEFT(ic.body, 240) AS preview_snippet,
           NULL::text AS content_type,
           NULL::bigint AS byte_size,
           ic.created_at::text AS created_at,
           ic.author_agent_id AS agent_id,
           ag.name AS agent_name,
           NULL::text AS user_id,
           ic.issue_id,
           i.identifier AS issue_identifier,
           i.title AS issue_title,
           i.project_id,
           p.name AS project_name,
           p.color AS project_color,
           NULL::uuid AS attachment_id
      FROM public.issue_comments ic
      JOIN public.issues i ON i.id = ic.issue_id
 LEFT JOIN public.projects p ON p.id = i.project_id
 LEFT JOIN public.agents ag ON ag.id = ic.author_agent_id
     WHERE ${where.join(" AND ")}
     ORDER BY ic.created_at DESC, ic.id DESC
     LIMIT $${params.length}`;
  return { sql, params };
}

function buildAssetQuery(filter: OutputFilters, limit: number): QueryBuilder {
  const params: unknown[] = [filter.companyId];
  const where: string[] = ["att.company_id = $1", "a.created_by_agent_id IS NOT NULL"];
  if (filter.projectId) {
    params.push(filter.projectId);
    where.push(`i.project_id = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    where.push(`a.created_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to);
    where.push(`a.created_at < $${params.length}`);
  }
  if (filter.agentId) {
    params.push(filter.agentId);
    where.push(`a.created_by_agent_id = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    where.push(`a.original_filename ILIKE $${params.length}`);
  }
  if (filter.mimeGroup === "image") {
    where.push("a.content_type LIKE 'image/%'");
  } else if (filter.mimeGroup === "document") {
    where.push(
      "(a.content_type = 'application/pdf' OR a.content_type LIKE '%officedocument%' OR a.content_type IN ('text/plain','text/markdown','application/msword'))",
    );
  } else if (filter.mimeGroup === "code") {
    where.push("(a.content_type LIKE 'text/%' OR a.content_type = 'application/json')");
  } else if (filter.mimeGroup === "other") {
    where.push(
      "a.content_type NOT LIKE 'image/%' AND a.content_type NOT LIKE 'text/%' AND a.content_type NOT IN ('application/pdf','application/json','application/msword') AND a.content_type NOT LIKE '%officedocument%'",
    );
  }
  const cursor = parseCursor(filter.cursor);
  if (cursor) {
    params.push(cursor.createdAt);
    params.push(cursor.rowId);
    where.push(`(a.created_at, att.id::text) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }
  params.push(limit);

  const sql = `
    SELECT 'asset'::text AS kind,
           att.id::text AS row_id,
           a.original_filename AS preview_label,
           NULL::text AS preview_snippet,
           a.content_type,
           a.byte_size,
           a.created_at::text AS created_at,
           a.created_by_agent_id AS agent_id,
           ag.name AS agent_name,
           a.created_by_user_id AS user_id,
           att.issue_id,
           i.identifier AS issue_identifier,
           i.title AS issue_title,
           i.project_id,
           p.name AS project_name,
           p.color AS project_color,
           att.id AS attachment_id
      FROM public.issue_attachments att
      JOIN public.assets a ON a.id = att.asset_id
      JOIN public.issues i ON i.id = att.issue_id
 LEFT JOIN public.projects p ON p.id = i.project_id
 LEFT JOIN public.agents ag ON ag.id = a.created_by_agent_id
     WHERE ${where.join(" AND ")}
     ORDER BY a.created_at DESC, att.id DESC
     LIMIT $${params.length}`;
  return { sql, params };
}

function buildInteractionQuery(filter: OutputFilters, limit: number): QueryBuilder {
  const params: unknown[] = [filter.companyId];
  const where: string[] = ["iti.company_id = $1", "iti.created_by_agent_id IS NOT NULL"];
  if (filter.projectId) {
    params.push(filter.projectId);
    where.push(`i.project_id = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    where.push(`iti.created_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to);
    where.push(`iti.created_at < $${params.length}`);
  }
  if (filter.agentId) {
    params.push(filter.agentId);
    where.push(`iti.created_by_agent_id = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    where.push(`(iti.title ILIKE $${params.length} OR iti.summary ILIKE $${params.length})`);
  }
  const cursor = parseCursor(filter.cursor);
  if (cursor) {
    params.push(cursor.createdAt);
    params.push(cursor.rowId);
    where.push(`(iti.created_at, iti.id::text) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }
  params.push(limit);

  const sql = `
    SELECT 'interaction'::text AS kind,
           iti.id::text AS row_id,
           iti.title AS preview_label,
           iti.summary AS preview_snippet,
           iti.kind AS content_type,
           NULL::bigint AS byte_size,
           iti.created_at::text AS created_at,
           iti.created_by_agent_id AS agent_id,
           ag.name AS agent_name,
           iti.created_by_user_id AS user_id,
           iti.issue_id,
           i.identifier AS issue_identifier,
           i.title AS issue_title,
           i.project_id,
           p.name AS project_name,
           p.color AS project_color,
           NULL::uuid AS attachment_id
      FROM public.issue_thread_interactions iti
      JOIN public.issues i ON i.id = iti.issue_id
 LEFT JOIN public.projects p ON p.id = i.project_id
 LEFT JOIN public.agents ag ON ag.id = iti.created_by_agent_id
     WHERE ${where.join(" AND ")}
     ORDER BY iti.created_at DESC, iti.id DESC
     LIMIT $${params.length}`;
  return { sql, params };
}

export function buildQueryForKind(kind: OutputKind, filter: OutputFilters, limit: number): QueryBuilder {
  switch (kind) {
    case "document": return buildDocumentQuery(filter, limit);
    case "comment": return buildCommentQuery(filter, limit);
    case "asset": return buildAssetQuery(filter, limit);
    case "interaction": return buildInteractionQuery(filter, limit);
  }
}

function mapRow(raw: RawUnifiedRow): OutputRow {
  return {
    kind: raw.kind,
    rowId: raw.row_id,
    previewLabel: raw.preview_label,
    previewSnippet: raw.preview_snippet,
    contentType: raw.content_type,
    byteSize: typeof raw.byte_size === "string" ? Number(raw.byte_size) : raw.byte_size,
    createdAt: raw.created_at,
    agent: raw.agent_id ? { id: raw.agent_id, name: raw.agent_name } : null,
    user: raw.user_id ? { id: raw.user_id } : null,
    issue: {
      id: raw.issue_id,
      identifier: raw.issue_identifier,
      title: raw.issue_title,
    },
    project: raw.project_id
      ? { id: raw.project_id, name: raw.project_name, color: raw.project_color }
      : null,
    attachmentId: raw.attachment_id,
  };
}

export async function listOutputs(
  ctx: PluginContext,
  filter: OutputFilters,
): Promise<OutputListPage> {
  const limit = clampLimit(filter.limit);
  const kinds = selectedKinds(filter);
  // Asset queries respect mimeGroup; for other kinds, mimeGroup is ignored.
  const effectiveKinds = filter.mimeGroup ? (kinds.includes("asset") ? (["asset"] as const) : []) : kinds;
  if (effectiveKinds.length === 0) {
    return { rows: [], nextCursor: null };
  }

  const fetched: RawUnifiedRow[][] = [];
  for (const kind of effectiveKinds) {
    const built = buildQueryForKind(kind, filter, limit + 1);
    const rows = await ctx.db.query<RawUnifiedRow>(built.sql, built.params);
    fetched.push(rows);
  }

  const merged = fetched.flat().sort(compareDesc);
  const hasMore = merged.length > limit;
  const trimmed = merged.slice(0, limit);
  const last = trimmed[trimmed.length - 1];
  const nextCursor = hasMore && last ? makeCursor({ createdAt: last.created_at, rowId: last.row_id }) : null;

  return { rows: trimmed.map(mapRow), nextCursor };
}

export async function listFilterOptions(
  ctx: PluginContext,
  companyId: string,
): Promise<FilterOptions> {
  const projects = await ctx.db.query<{ id: string; name: string | null; color: string | null }>(
    `SELECT p.id::text AS id, p.name, p.color
       FROM public.projects p
      WHERE p.company_id = $1
      ORDER BY p.name ASC NULLS LAST
      LIMIT 200`,
    [companyId],
  );
  const agents = await ctx.db.query<{ id: string; name: string | null }>(
    `SELECT ag.id::text AS id, ag.name
       FROM public.agents ag
      WHERE ag.company_id = $1
      ORDER BY ag.name ASC NULLS LAST
      LIMIT 200`,
    [companyId],
  );
  const countRows = await ctx.db.query<{ total: string }>(
    `SELECT (
         (SELECT COUNT(*) FROM public.documents d WHERE d.company_id = $1 AND d.created_by_agent_id IS NOT NULL)
       + (SELECT COUNT(*) FROM public.issue_comments ic WHERE ic.company_id = $1 AND ic.author_agent_id IS NOT NULL)
       + (SELECT COUNT(*) FROM public.issue_attachments att JOIN public.assets a ON a.id = att.asset_id WHERE att.company_id = $1 AND a.created_by_agent_id IS NOT NULL)
       + (SELECT COUNT(*) FROM public.issue_thread_interactions iti WHERE iti.company_id = $1 AND iti.created_by_agent_id IS NOT NULL)
       )::text AS total`,
    [companyId],
  );

  return {
    projects,
    agents,
    totalAgentRows: Number(countRows[0]?.total ?? 0),
  };
}
