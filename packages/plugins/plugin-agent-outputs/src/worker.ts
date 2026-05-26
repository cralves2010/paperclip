import {
  definePlugin,
  runWorker,
  type PluginApiRequestInput,
  type PluginContext,
} from "@paperclipai/plugin-sdk";
import {
  buildQueryForKind,
  listFilterOptions,
  listOutputs,
} from "./outputs/core.js";
import type {
  MimeGroup,
  OutputDetail,
  OutputFilters,
  OutputKind,
  OutputRow,
  RawUnifiedRow,
} from "./outputs/types.js";

let activeContext: PluginContext | null = null;

function requireContext(): PluginContext {
  if (!activeContext) throw new Error("Agent Outputs plugin has not been set up");
  return activeContext;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function intField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const VALID_KINDS: readonly OutputKind[] = ["document", "comment", "asset", "interaction"];
const VALID_MIME_GROUPS: readonly MimeGroup[] = ["image", "document", "code", "other"];

function parseKindsParam(value: unknown): OutputKind[] | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const tokens = value.split(",").map((token) => token.trim());
  const accepted = tokens.filter((token): token is OutputKind =>
    VALID_KINDS.includes(token as OutputKind),
  );
  return accepted.length > 0 ? accepted : undefined;
}

function parseMimeGroup(value: unknown): MimeGroup | undefined {
  if (typeof value !== "string") return undefined;
  return VALID_MIME_GROUPS.includes(value as MimeGroup) ? (value as MimeGroup) : undefined;
}

function buildFilters(input: PluginApiRequestInput): OutputFilters {
  const query = input.query as Record<string, unknown>;
  return {
    companyId: input.companyId,
    projectId: stringField(query.projectId ?? query.project),
    from: stringField(query.from),
    to: stringField(query.to),
    kinds: parseKindsParam(query.kind ?? query.kinds),
    agentId: stringField(query.agentId ?? query.agent),
    mimeGroup: parseMimeGroup(query.mime ?? query.mimeGroup),
    search: stringField(query.q ?? query.search),
    cursor: stringField(query.cursor),
    limit: intField(query.limit),
  };
}

async function fetchDetail(
  ctx: PluginContext,
  companyId: string,
  kind: OutputKind,
  id: string,
): Promise<OutputDetail | null> {
  // Reuse the per-kind builder with a tight filter, then look up the row by id manually.
  // For detail we re-run the kind's full query without paging (limit 1) and filter by row_id in TypeScript.
  // This avoids adding an "id" parameter to the SQL builder (single source of truth).
  // Detail rows are small in volume, so a per-call query is fine.
  switch (kind) {
    case "document": {
      const rows = await ctx.db.query<RawUnifiedRow & { body: string | null }>(
        `SELECT 'document'::text AS kind,
                d.id::text AS row_id,
                d.title AS preview_label,
                d.latest_body AS preview_snippet,
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
                NULL::uuid AS attachment_id,
                d.latest_body AS body
           FROM public.documents d
           JOIN public.issue_documents idoc ON idoc.document_id = d.id
           JOIN public.issues i ON i.id = idoc.issue_id
      LEFT JOIN public.projects p ON p.id = i.project_id
      LEFT JOIN public.agents ag ON ag.id = d.created_by_agent_id
          WHERE d.company_id = $1 AND d.id::text = $2`,
        [companyId, id],
      );
      return rows[0] ? toDetail(rows[0], rows[0].body, null) : null;
    }
    case "comment": {
      const rows = await ctx.db.query<RawUnifiedRow & { body: string | null }>(
        `SELECT 'comment'::text AS kind,
                ic.id::text AS row_id,
                NULL::text AS preview_label,
                ic.body AS preview_snippet,
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
                NULL::uuid AS attachment_id,
                ic.body AS body
           FROM public.issue_comments ic
           JOIN public.issues i ON i.id = ic.issue_id
      LEFT JOIN public.projects p ON p.id = i.project_id
      LEFT JOIN public.agents ag ON ag.id = ic.author_agent_id
          WHERE ic.company_id = $1 AND ic.id::text = $2`,
        [companyId, id],
      );
      return rows[0] ? toDetail(rows[0], rows[0].body, null) : null;
    }
    case "asset": {
      const rows = await ctx.db.query<RawUnifiedRow>(
        `SELECT 'asset'::text AS kind,
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
          WHERE att.company_id = $1 AND att.id::text = $2`,
        [companyId, id],
      );
      if (!rows[0]) return null;
      return toDetail(rows[0], null, `/api/attachments/${rows[0].attachment_id}/content`);
    }
    case "interaction": {
      const rows = await ctx.db.query<RawUnifiedRow & { payload: unknown }>(
        `SELECT 'interaction'::text AS kind,
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
                NULL::uuid AS attachment_id,
                iti.payload AS payload
           FROM public.issue_thread_interactions iti
           JOIN public.issues i ON i.id = iti.issue_id
      LEFT JOIN public.projects p ON p.id = i.project_id
      LEFT JOIN public.agents ag ON ag.id = iti.created_by_agent_id
          WHERE iti.company_id = $1 AND iti.id::text = $2`,
        [companyId, id],
      );
      if (!rows[0]) return null;
      const detail = toDetail(rows[0], rows[0].preview_snippet, null);
      detail.payload = rows[0].payload;
      return detail;
    }
  }
}

function toDetail(raw: RawUnifiedRow, body: string | null, contentUrl: string | null): OutputDetail {
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
    body,
    contentUrl,
    payload: null,
  };
}

function readCompanyId(params: Record<string, unknown>): string {
  const value = params.companyId;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("companyId is required");
  }
  return value;
}

function buildFiltersFromParams(params: Record<string, unknown>): OutputFilters {
  return {
    companyId: readCompanyId(params),
    projectId: stringField(params.projectId ?? params.project),
    from: stringField(params.from),
    to: stringField(params.to),
    kinds: parseKindsParam(params.kind ?? params.kinds),
    agentId: stringField(params.agentId ?? params.agent),
    mimeGroup: parseMimeGroup(params.mime ?? params.mimeGroup),
    search: stringField(params.q ?? params.search),
    cursor: stringField(params.cursor),
    limit: intField(params.limit),
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    activeContext = ctx;

    // UI bridge handlers — invoked by usePluginData() hooks in the React UI.
    ctx.data.register("list", async (params) => {
      return listOutputs(ctx, buildFiltersFromParams(params));
    });

    ctx.data.register("detail", async (params) => {
      const companyId = readCompanyId(params);
      const kindRaw = stringField(params.kind);
      const id = stringField(params.id);
      if (!kindRaw || !VALID_KINDS.includes(kindRaw as OutputKind)) {
        throw new Error("invalid kind");
      }
      if (!id) throw new Error("missing id");
      const detail = await fetchDetail(ctx, companyId, kindRaw as OutputKind, id);
      if (!detail) throw new Error("not found");
      return detail;
    });

    ctx.data.register("filter-options", async (params) => {
      return listFilterOptions(ctx, readCompanyId(params));
    });

    ctx.logger.info("Agent Outputs plugin setup complete");
  },

  async onHealth() {
    return { status: "ok", message: "Agent Outputs plugin ready" };
  },

  async onApiRequest(input: PluginApiRequestInput) {
    const ctx = requireContext();

    if (input.routeKey === "list") {
      const filters = buildFilters(input);
      return { body: await listOutputs(ctx, filters) };
    }

    if (input.routeKey === "detail") {
      const kindParam = input.params.kind as string | undefined;
      const id = input.params.id as string | undefined;
      if (!kindParam || !VALID_KINDS.includes(kindParam as OutputKind)) {
        return { status: 400, body: { error: "invalid kind" } };
      }
      if (!id) {
        return { status: 400, body: { error: "missing id" } };
      }
      const detail = await fetchDetail(ctx, input.companyId, kindParam as OutputKind, id);
      if (!detail) {
        return { status: 404, body: { error: "not found" } };
      }
      return { body: detail };
    }

    if (input.routeKey === "filter-options") {
      return { body: await listFilterOptions(ctx, input.companyId) };
    }

    return { status: 404, body: { error: `unknown route: ${input.routeKey}` } };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

// Re-export buildQueryForKind so tests in the consumer monorepo can validate query shape.
export { buildQueryForKind, listFilterOptions, listOutputs };
export type { OutputFilters, OutputKind, OutputRow };
