import { describe, expect, it } from "vitest";
import { buildQueryForKind, classifyMime } from "../src/outputs/core.js";
import type { OutputFilters, OutputKind } from "../src/outputs/types.js";

const FILTER_BASE: OutputFilters = {
  companyId: "00000000-0000-0000-0000-000000000001",
};

const KINDS: OutputKind[] = ["document", "comment", "asset", "interaction"];

const FULL_FILTER: OutputFilters = {
  companyId: "11111111-1111-1111-1111-111111111111",
  projectId: "22222222-2222-2222-2222-222222222222",
  from: "2026-01-01T00:00:00Z",
  to: "2026-12-31T00:00:00Z",
  agentId: "33333333-3333-3333-3333-333333333333",
  search: "foo",
  mimeGroup: "image",
  cursor: "2026-05-01T00:00:00Z|44444444-4444-4444-4444-444444444444",
};

describe("plugin-agent-outputs core SQL builder", () => {
  describe("safety: each query embeds company_id = $1 filter", () => {
    it.each(KINDS)("query for %s contains parameterized company_id filter", (kind) => {
      const { sql } = buildQueryForKind(kind, FILTER_BASE, 50);
      expect(sql).toMatch(/company_id\s*=\s*\$1/);
    });

    it.each(KINDS)("query for %s with full filters retains company_id filter", (kind) => {
      const { sql } = buildQueryForKind(kind, FULL_FILTER, 50);
      expect(sql).toMatch(/company_id\s*=\s*\$1/);
    });
  });

  describe("safety: each kind filters by agent authorship", () => {
    it("documents require created_by_agent_id IS NOT NULL", () => {
      const { sql } = buildQueryForKind("document", FILTER_BASE, 50);
      expect(sql).toContain("d.created_by_agent_id IS NOT NULL");
    });

    it("comments require author_agent_id IS NOT NULL", () => {
      const { sql } = buildQueryForKind("comment", FILTER_BASE, 50);
      expect(sql).toContain("ic.author_agent_id IS NOT NULL");
    });

    it("assets require created_by_agent_id IS NOT NULL", () => {
      const { sql } = buildQueryForKind("asset", FILTER_BASE, 50);
      expect(sql).toContain("a.created_by_agent_id IS NOT NULL");
    });

    it("interactions require created_by_agent_id IS NOT NULL", () => {
      const { sql } = buildQueryForKind("interaction", FILTER_BASE, 50);
      expect(sql).toContain("iti.created_by_agent_id IS NOT NULL");
    });
  });

  describe("parameter wiring", () => {
    it.each(KINDS)("parameter slots are sequential and contiguous for %s", (kind) => {
      const { sql, params } = buildQueryForKind(kind, FULL_FILTER, 25);
      for (let i = 1; i <= params.length; i += 1) {
        expect(sql).toContain(`$${i}`);
      }
      const lastParam = params[params.length - 1];
      expect(lastParam).toBe(25);
    });

    it.each(KINDS)("minimal filter only binds companyId + limit for %s", (kind) => {
      const { params } = buildQueryForKind(kind, FILTER_BASE, 10);
      expect(params.length).toBe(2);
      expect(params[0]).toBe(FILTER_BASE.companyId);
      expect(params[1]).toBe(10);
    });
  });

  describe("classifyMime", () => {
    it.each([
      ["image/png", "image"],
      ["image/jpeg", "image"],
      ["application/pdf", "document"],
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
      ["text/markdown", "document"],
      ["text/plain", "document"],
      ["text/typescript", "code"],
      ["application/json", "code"],
      ["application/zip", "other"],
      [null, "other"],
      [undefined, "other"],
    ])("classifies %s as %s", (input, expected) => {
      expect(classifyMime(input as string | null | undefined)).toBe(expected);
    });
  });

  describe("project filter", () => {
    it("includes i.project_id when projectId is set", () => {
      const { sql, params } = buildQueryForKind(
        "document",
        { ...FILTER_BASE, projectId: "PROJ" },
        25,
      );
      expect(sql).toContain("i.project_id = $2");
      expect(params).toContain("PROJ");
    });

    it("omits project filter when projectId is unset", () => {
      const { sql } = buildQueryForKind("document", FILTER_BASE, 25);
      expect(sql).not.toContain("i.project_id =");
    });
  });

  describe("mime group filter (asset only)", () => {
    it("applies LIKE 'image/%' when mimeGroup=image", () => {
      const { sql } = buildQueryForKind("asset", { ...FILTER_BASE, mimeGroup: "image" }, 25);
      expect(sql).toContain("a.content_type LIKE 'image/%'");
    });

    it("excludes typical types when mimeGroup=other", () => {
      const { sql } = buildQueryForKind("asset", { ...FILTER_BASE, mimeGroup: "other" }, 25);
      expect(sql).toContain("NOT LIKE 'image/%'");
    });
  });
});
