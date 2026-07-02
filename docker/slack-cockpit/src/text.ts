// Text helpers that encode Slack Block Kit fidelity rules.

/** Clamp to `max` chars with a trailing ellipsis (never exceeds `max`). */
export function clamp(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}

/** Modal titles are plain_text with a hard 24-char cap. */
export function truncateTitle(s: string): string {
  return clamp(s, 24)
}

/**
 * Count line for a company. Single spaces + middot separators ONLY — Slack
 * collapses runs of spaces, so column alignment via multi-space is impossible.
 */
export function countLine(c: { inProgress: number; awaiting: number; blocked: number }): string {
  return `🔵 ${c.inProgress} In progress · 🟡 ${c.awaiting} Awaiting · 🔴 ${c.blocked} Blocked`
}
