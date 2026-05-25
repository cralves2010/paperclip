import { describe, expect, it } from "vitest";
import {
  applyUiBranding,
  getInstanceUiBranding,
  getWorktreeUiBranding,
  isInstanceUiBrandingEnabled,
  isWorktreeUiBrandingEnabled,
  renderFaviconLinks,
  renderInstanceBrandingMeta,
  renderRuntimeBrandingMeta,
} from "../ui-branding.js";

const TEMPLATE = `<!doctype html>
<head>
    <meta name="apple-mobile-web-app-title" content="Paperclip" />
    <title>Paperclip</title>
    <!-- PAPERCLIP_RUNTIME_BRANDING_START -->
    <!-- PAPERCLIP_RUNTIME_BRANDING_END -->
    <!-- PAPERCLIP_FAVICON_START -->
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <!-- PAPERCLIP_FAVICON_END -->
</head>`;

describe("ui branding", () => {
  it("detects worktree mode from PAPERCLIP_IN_WORKTREE", () => {
    expect(isWorktreeUiBrandingEnabled({ PAPERCLIP_IN_WORKTREE: "true" })).toBe(true);
    expect(isWorktreeUiBrandingEnabled({ PAPERCLIP_IN_WORKTREE: "1" })).toBe(true);
    expect(isWorktreeUiBrandingEnabled({ PAPERCLIP_IN_WORKTREE: "false" })).toBe(false);
  });

  it("resolves name, color, and text color for worktree branding", () => {
    const branding = getWorktreeUiBranding({
      PAPERCLIP_IN_WORKTREE: "true",
      PAPERCLIP_WORKTREE_NAME: "paperclip-pr-432",
      PAPERCLIP_WORKTREE_COLOR: "#4f86f7",
    });

    expect(branding.enabled).toBe(true);
    expect(branding.name).toBe("paperclip-pr-432");
    expect(branding.color).toBe("#4f86f7");
    expect(branding.textColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(branding.faviconHref).toContain("data:image/svg+xml,");
  });

  it("renders a dynamic worktree favicon when enabled", () => {
    const links = renderFaviconLinks(
      getWorktreeUiBranding({
        PAPERCLIP_IN_WORKTREE: "true",
        PAPERCLIP_WORKTREE_NAME: "paperclip-pr-432",
        PAPERCLIP_WORKTREE_COLOR: "#4f86f7",
      }),
    );
    expect(links).toContain("data:image/svg+xml,");
    expect(links).toContain('rel="shortcut icon"');
  });

  it("renders runtime branding metadata for the ui", () => {
    const meta = renderRuntimeBrandingMeta(
      getWorktreeUiBranding({
        PAPERCLIP_IN_WORKTREE: "true",
        PAPERCLIP_WORKTREE_NAME: "paperclip-pr-432",
        PAPERCLIP_WORKTREE_COLOR: "#4f86f7",
      }),
    );
    expect(meta).toContain('name="paperclip-worktree-name"');
    expect(meta).toContain('content="paperclip-pr-432"');
    expect(meta).toContain('name="paperclip-worktree-color"');
  });

  it("rewrites the favicon and runtime branding blocks for worktree instances only", () => {
    const branded = applyUiBranding(TEMPLATE, {
      PAPERCLIP_IN_WORKTREE: "true",
      PAPERCLIP_WORKTREE_NAME: "paperclip-pr-432",
      PAPERCLIP_WORKTREE_COLOR: "#4f86f7",
    });
    expect(branded).toContain("data:image/svg+xml,");
    expect(branded).toContain('name="paperclip-worktree-name"');
    expect(branded).not.toContain('href="/favicon.svg"');

    const defaultHtml = applyUiBranding(TEMPLATE, {});
    expect(defaultHtml).toContain('href="/favicon.svg"');
    expect(defaultHtml).not.toContain('name="paperclip-worktree-name"');
  });

  // Instance-level (white-label) branding tests
  it("detects instance branding via PAPERCLIP_BRAND_NAME or PAPERCLIP_INSTANCE_BRANDING", () => {
    expect(isInstanceUiBrandingEnabled({ PAPERCLIP_BRAND_NAME: "M42 Agent" })).toBe(true);
    expect(isInstanceUiBrandingEnabled({ PAPERCLIP_INSTANCE_BRANDING: "true" })).toBe(true);
    expect(isInstanceUiBrandingEnabled({})).toBe(false);
  });

  it("resolves brand name and short name", () => {
    const branding = getInstanceUiBranding({
      PAPERCLIP_BRAND_NAME: "M42 Agent",
      PAPERCLIP_BRAND_SHORT_NAME: "M42",
    });
    expect(branding.enabled).toBe(true);
    expect(branding.name).toBe("M42 Agent");
    expect(branding.shortName).toBe("M42");
  });

  it("falls back short name to full name when only brand name is set", () => {
    const branding = getInstanceUiBranding({ PAPERCLIP_BRAND_NAME: "M42 Agent" });
    expect(branding.shortName).toBe("M42 Agent");
  });

  it("renders instance branding meta tags", () => {
    const meta = renderInstanceBrandingMeta(
      getInstanceUiBranding({ PAPERCLIP_BRAND_NAME: "M42 Agent", PAPERCLIP_BRAND_SHORT_NAME: "M42" }),
    );
    expect(meta).toContain('name="paperclip-instance-branding-enabled"');
    expect(meta).toContain('name="paperclip-instance-brand-name"');
    expect(meta).toContain('content="M42 Agent"');
    expect(meta).toContain('content="M42"');
  });

  it("rewrites HTML title and apple-mobile-web-app-title when instance branding is enabled", () => {
    const branded = applyUiBranding(TEMPLATE, { PAPERCLIP_BRAND_NAME: "M42 Agent" });
    expect(branded).toContain("<title>M42 Agent</title>");
    expect(branded).toContain('content="M42 Agent"');
    expect(branded).toContain('name="paperclip-instance-brand-name"');
  });

  it("leaves HTML title untouched when instance branding is not configured", () => {
    const defaultHtml = applyUiBranding(TEMPLATE, {});
    expect(defaultHtml).toContain("<title>Paperclip</title>");
    expect(defaultHtml).not.toContain('name="paperclip-instance-brand-name"');
  });

  it("combines worktree and instance branding metas in a single block", () => {
    const branded = applyUiBranding(TEMPLATE, {
      PAPERCLIP_IN_WORKTREE: "true",
      PAPERCLIP_WORKTREE_NAME: "wt-1",
      PAPERCLIP_BRAND_NAME: "M42 Agent",
    });
    expect(branded).toContain('name="paperclip-worktree-name"');
    expect(branded).toContain('name="paperclip-instance-brand-name"');
  });

  it("escapes HTML in brand name to prevent injection", () => {
    const branded = applyUiBranding(TEMPLATE, { PAPERCLIP_BRAND_NAME: `Evil <script>"&` });
    expect(branded).toContain("Evil &lt;script&gt;&quot;&amp;");
    expect(branded).not.toContain("<script>");
  });

  // Fork-local revision suffix tests
  it("includes revision meta when PAPERCLIP_BRAND_REVISION is set", () => {
    const branded = applyUiBranding(TEMPLATE, {
      PAPERCLIP_BRAND_NAME: "M42 Agent",
      PAPERCLIP_BRAND_REVISION: "7",
    });
    // Numeric revisions are zero-padded to 2 digits server-side
    expect(branded).toContain('name="paperclip-instance-brand-revision"');
    expect(branded).toContain('content="07"');
  });

  it("preserves non-numeric revision (e.g. short SHA) untouched", () => {
    const branded = applyUiBranding(TEMPLATE, {
      PAPERCLIP_BRAND_NAME: "M42 Agent",
      PAPERCLIP_BRAND_REVISION: "abc123",
    });
    expect(branded).toContain('content="abc123"');
  });

  it("omits revision meta when PAPERCLIP_BRAND_REVISION is unset", () => {
    const branded = applyUiBranding(TEMPLATE, { PAPERCLIP_BRAND_NAME: "M42 Agent" });
    expect(branded).not.toContain('name="paperclip-instance-brand-revision"');
  });
});
