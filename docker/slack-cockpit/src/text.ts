// Text helpers that encode Slack Block Kit fidelity rules.

/**
 * The human-readable task reference shown on every surface, e.g. "JRS-43".
 * Single source of truth so the company + number always render together.
 */
export function taskRef(t: { company: string; taskNum: string }): string {
  return `${t.company}-${t.taskNum}`
}

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

const MIN_MS = 60_000

/**
 * Freshness dot from the age of the data: 🟢 fresh (<30m), 🟡 getting stale
 * (30–60m), 🔴 stale (≥60m). Ages to yellow/red exactly when the sidecar can't
 * reach the tracker and is serving stale-while-error cache — a real "the sync
 * is broken" signal, not decoration.
 */
export function freshnessDot(ageMs: number): string {
  if (ageMs < 30 * MIN_MS) return '🟢'
  if (ageMs < 60 * MIN_MS) return '🟡'
  return '🔴'
}

/** Human relative age of the data: "just now", "3m ago", "1h 20m ago". */
export function relativeAge(ageMs: number): string {
  const mins = Math.floor(Math.max(0, ageMs) / MIN_MS)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  const r = mins % 60
  return r ? `${h}h ${r}m ago` : `${h}h ago`
}

/**
 * Coarser age for "shipped a while ago" — drops minute precision noise
 * ("26h 24m ago" → "yesterday"). Kept separate from relativeAge, which the
 * freshness line needs at minute granularity to signal a stalled sync.
 */
export function coarseAge(ageMs: number): string {
  const mins = Math.floor(Math.max(0, ageMs) / MIN_MS)
  if (mins < 60) return 'just now'
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** Absolute clock in Derek's timezone, e.g. "Jul 5, 2:32 PM MST". */
export function formatSyncClock(ms: number, tz = 'America/Phoenix'): string {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/**
 * The cockpit's live freshness line, e.g.
 *   "🟢 *Last synced Jul 5, 2:32 PM MST* · just now · from M42 Central Task Tracker".
 * Computed at render time; `now` is injectable for tests.
 */
export function liveProvenance(syncedAtMs?: number, now: number = Date.now()): string {
  const synced = syncedAtMs ?? now
  const age = Math.max(0, now - synced)
  return `${freshnessDot(age)} *Last synced ${formatSyncClock(synced)}* · ${relativeAge(age)} · from M42 Central Task Tracker`
}
