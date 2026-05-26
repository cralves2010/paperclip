export type OutputKind = "document" | "comment" | "asset" | "interaction";

export type MimeGroup = "image" | "document" | "code" | "other";

export interface OutputFilters {
  companyId: string;
  projectId?: string;
  from?: string;
  to?: string;
  kinds?: OutputKind[];
  agentId?: string;
  mimeGroup?: MimeGroup;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface OutputRow {
  kind: OutputKind;
  rowId: string;
  previewLabel: string | null;
  previewSnippet: string | null;
  contentType: string | null;
  byteSize: number | null;
  createdAt: string;
  agent: { id: string; name: string | null } | null;
  user: { id: string } | null;
  issue: {
    id: string;
    identifier: string | null;
    title: string | null;
  };
  project: {
    id: string;
    name: string | null;
    color: string | null;
  } | null;
  attachmentId: string | null;
}

export interface OutputListPage {
  rows: OutputRow[];
  nextCursor: string | null;
}

export interface OutputDetail extends OutputRow {
  body: string | null;
  contentUrl: string | null;
  payload: unknown;
}

export interface FilterOptions {
  projects: Array<{ id: string; name: string | null; color: string | null }>;
  agents: Array<{ id: string; name: string | null }>;
  totalAgentRows: number;
}

export interface RawUnifiedRow {
  kind: OutputKind;
  row_id: string;
  preview_label: string | null;
  preview_snippet: string | null;
  content_type: string | null;
  byte_size: number | string | null;
  created_at: string;
  agent_id: string | null;
  agent_name: string | null;
  user_id: string | null;
  issue_id: string;
  issue_identifier: string | null;
  issue_title: string | null;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  attachment_id: string | null;
}
