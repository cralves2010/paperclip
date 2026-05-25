// Reads instance-level branding emitted by the server (server/src/ui-branding.ts).
// Returns null when no branding is configured, so callers can fall back to the
// default product name "Paperclip" without coupling to the brand value.

function readMetaContent(name: string): string | null {
  if (typeof document === "undefined") return null;
  const element = document.querySelector(`meta[name="${name}"]`);
  const content = element?.getAttribute("content")?.trim();
  return content ? content : null;
}

export function isInstanceBrandingEnabled(): boolean {
  return readMetaContent("paperclip-instance-branding-enabled") === "true";
}

export function getInstanceBrandName(): string | null {
  if (!isInstanceBrandingEnabled()) return null;
  return readMetaContent("paperclip-instance-brand-name");
}

export function getInstanceBrandShortName(): string | null {
  if (!isInstanceBrandingEnabled()) return null;
  return readMetaContent("paperclip-instance-brand-short-name") ?? getInstanceBrandName();
}

// Optional fork-local sequential revision (e.g. "07"). Rendered as a suffix
// next to the upstream semver in version chips so operators can tell which
// branding/m42 commit is deployed without reading the upstream "version" field.
export function getInstanceBrandRevision(): string | null {
  if (!isInstanceBrandingEnabled()) return null;
  return readMetaContent("paperclip-instance-brand-revision");
}
