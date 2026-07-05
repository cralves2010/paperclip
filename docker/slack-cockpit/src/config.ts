// Typed configuration loaded from environment (see .env.cockpit on the VPS).

export interface Config {
  slackBotToken: string
  slackAppToken: string
  demo: boolean
  googleSaJsonPath: string
  sheetId: string
  sheetRange: string
  allowlist: string[]
  // Act layer (v1): all non-secret. Slack user IDs are not secrets.
  notifyUserId: string
  commentsTab: string
  trackerTab: string
  // Comment intelligence (v0): advisory DM enrichment. OFF unless COCKPIT_CLASSIFY
  // is truthy AND anthropicApiKey is set — otherwise the DM is today's raw text.
  classifyEnabled: boolean
  anthropicApiKey: string
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${key}`)
  return v.trim()
}

function opt(env: NodeJS.ProcessEnv, key: string, def = ''): string {
  return (env[key] ?? def).trim()
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Demo mode renders a real JRS+Brightly fixture without any Google setup.
  const demo = /^(1|true|yes)$/i.test((env.COCKPIT_DEMO ?? '').trim())
  const sheetRange = opt(env, 'SHEET_RANGE', 'A1:Z')
  return {
    slackBotToken: req(env, 'SLACK_BOT_TOKEN'),
    slackAppToken: req(env, 'SLACK_APP_TOKEN'),
    demo,
    googleSaJsonPath: demo ? opt(env, 'GOOGLE_SA_JSON') : req(env, 'GOOGLE_SA_JSON'),
    sheetId: demo ? opt(env, 'SHEET_ID') : req(env, 'SHEET_ID'),
    // Unbounded rows by default: a bounded range silently truncates once the
    // tracker outgrows it (pivot Day-0 hardening, 2026-07-03).
    sheetRange,
    allowlist: req(env, 'COCKPIT_ALLOWLIST')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Claudio is the only person notified of comments/new tasks (design rule):
    // never DM Derek or post to a channel.
    notifyUserId: opt(env, 'COCKPIT_NOTIFY_USER', 'U08C8QTNBJ9'),
    commentsTab: opt(env, 'COCKPIT_COMMENTS_TAB', 'Comments'),
    // Writes (create task) must hit the SAME tab the cockpit reads. If
    // SHEET_RANGE carries a tab prefix ("Tracker!A1:Z"), reuse & unquote it;
    // otherwise fall back to the explicit tab env / default 'Tracker'.
    // (The Comments range is NOT derived from sheetRange — it has no prefix.)
    trackerTab: resolveTrackerTab(sheetRange, opt(env, 'COCKPIT_TRACKER_TAB', 'Tracker')),
    classifyEnabled: /^(1|true|yes)$/i.test((env.COCKPIT_CLASSIFY ?? '').trim()),
    anthropicApiKey: opt(env, 'ANTHROPIC_API_KEY'),
  }
}

/** Extract the tab name from a range like "Tracker!A1:Z" or "'My Tab'!A1"; else default. */
function resolveTrackerTab(sheetRange: string, def: string): string {
  const bang = sheetRange.indexOf('!')
  if (bang < 0) return def
  let prefix = sheetRange.slice(0, bang).trim()
  // Unquote a single-quoted tab name and unescape doubled quotes ('' -> ').
  if (prefix.startsWith("'") && prefix.endsWith("'") && prefix.length >= 2) {
    prefix = prefix.slice(1, -1).replace(/''/g, "'")
  }
  return prefix || def
}
