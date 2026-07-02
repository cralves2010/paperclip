// Typed configuration loaded from environment (see .env.cockpit on the VPS).

export interface Config {
  slackBotToken: string
  slackAppToken: string
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    slackBotToken: req(env, 'SLACK_BOT_TOKEN'),
    slackAppToken: req(env, 'SLACK_APP_TOKEN'),
    googleSaJsonPath: req(env, 'GOOGLE_SA_JSON'),
    sheetId: req(env, 'SHEET_ID'),
    sheetRange: (env.SHEET_RANGE ?? 'A1:Z200').trim(),
    allowlist: req(env, 'COCKPIT_ALLOWLIST')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}
