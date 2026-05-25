import { getInstanceBrandName, getInstanceBrandShortName } from "./instance-branding";

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

// Module-time constants for convenience. These are evaluated once at import
// time and are safe to use anywhere meta tags are already in <head> (i.e.
// inside the React tree).
export const BRAND_NAME = getBrandName();
export const BRAND_SHORT_NAME = getBrandShortName();
