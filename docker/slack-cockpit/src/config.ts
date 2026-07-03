// Typed configuration loaded from environment (see .env.cockpit on the VPS).

export interface Config {
  slackBotToken: string
  slackAppToken: string
  demo: boolean
  googleSaJsonPath: string
  sheetId: string
  sheetRange: string
  allowlist: string[]
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
  return {
    slackBotToken: req(env, 'SLACK_BOT_TOKEN'),
    slackAppToken: req(env, 'SLACK_APP_TOKEN'),
    demo,
    googleSaJsonPath: demo ? opt(env, 'GOOGLE_SA_JSON') : req(env, 'GOOGLE_SA_JSON'),
    sheetId: demo ? opt(env, 'SHEET_ID') : req(env, 'SHEET_ID'),
    // Unbounded rows by default: a bounded range silently truncates once the
    // tracker outgrows it (pivot Day-0 hardening, 2026-07-03).
    sheetRange: opt(env, 'SHEET_RANGE', 'A1:Z'),
    allowlist: req(env, 'COCKPIT_ALLOWLIST')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}
