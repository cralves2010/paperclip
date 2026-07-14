import { expect, test } from 'vitest'
import { loadConfig } from '../src/config.js'

// Minimal live-mode env (COCKPIT_DEMO unset). req() fields: SLACK_BOT_TOKEN,
// SLACK_APP_TOKEN, COCKPIT_ALLOWLIST, plus GOOGLE_SA_JSON + SHEET_ID in live.
const base: NodeJS.ProcessEnv = {
  SLACK_BOT_TOKEN: 'xoxb',
  SLACK_APP_TOKEN: 'xapp',
  COCKPIT_ALLOWLIST: 'U1,U2',
  GOOGLE_SA_JSON: '/sa.json',
  SHEET_ID: 'SID',
}

test('live: the 3 GOOGLE_OAUTH_* populate when present', () => {
  const c = loadConfig({
    ...base,
    GOOGLE_OAUTH_CLIENT_ID: 'cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'sec',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'rt',
  })
  expect(c.googleOauthClientId).toBe('cid')
  expect(c.googleOauthClientSecret).toBe('sec')
  expect(c.googleOauthRefreshToken).toBe('rt')
})

test('live: a MISSING OAuth var does NOT throw (opt-in-live) — the board still boots', () => {
  // No GOOGLE_OAUTH_* at all — opt, not req, so loadConfig must succeed.
  const c = loadConfig({ ...base })
  expect(c.googleOauthClientId).toBe('')
  expect(c.googleOauthRefreshToken).toBe('')
})

test('docShareEmails: comma-split + trimmed; unset → []', () => {
  expect(loadConfig({ ...base, COCKPIT_DOC_SHARE_EMAILS: 'a@x.com, b@y.com ' }).docShareEmails).toEqual([
    'a@x.com',
    'b@y.com',
  ])
  expect(loadConfig({ ...base }).docShareEmails).toEqual([])
})
