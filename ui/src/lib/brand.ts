import { getInstanceBrandName, getInstanceBrandRevision, getInstanceBrandShortName } from "./instance-branding";

const DEFAULT_BRAND_NAME = "Paperclip";

// Brand name resolution. Source of truth is the server-injected meta tag
// (see server/src/ui-branding.ts), which reads PAPERCLIP_BRAND_NAME and
// PAPERCLIP_BRAND_SHORT_NAME env vars at boot. When no white-label is
// configured, both names fall back to the default product name "Paperclip".
//
// Use these in user-facing copy (JSX strings, toasts, document.title, etc.).
// Do NOT use for technical identifiers, package names, or upstream URLs.

let cachedBrandName: string | null = null;
let cachedBrandShortName: string | null = null;
let cachedBrandRevision: string | null | undefined = undefined;

export function getBrandName(): string {
  if (cachedBrandName === null) {
    cachedBrandName = getInstanceBrandName() ?? DEFAULT_BRAND_NAME;
  }
  return cachedBrandName;
}

export function getBrandShortName(): string {
  if (cachedBrandShortName === null) {
    cachedBrandShortName = getInstanceBrandShortName() ?? DEFAULT_BRAND_NAME;
  }
  return cachedBrandShortName;
}

// Optional fork-local revision suffix (e.g. "07"). null when no instance
// branding is configured so unbranded deployments render the upstream semver
// unchanged.
export function getBrandRevision(): string | null {
  if (cachedBrandRevision === undefined) {
    cachedBrandRevision = getInstanceBrandRevision();
  }
  return cachedBrandRevision;
}

// Builds a version label that combines the upstream semver with the optional
// fork revision. Format: `v0.3.1 07` (space-separated) when revision is set,
// or `v0.3.1` when no fork revision is present. Upstream semver is never
// modified — the suffix is purely additive.
export function formatBrandedVersion(upstreamVersion: string): string {
  const base = `v${upstreamVersion}`;
  const revision = getBrandRevision();
  return revision ? `${base} ${revision}` : base;
}

// Module-time constants for convenience. These are evaluated once at import
// time and are safe to use anywhere meta tags are already in <head> (i.e.
// inside the React tree).
export const BRAND_NAME = getBrandName();
export const BRAND_SHORT_NAME = getBrandShortName();
export const BRAND_REVISION = getBrandRevision();
