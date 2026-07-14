// One-time OAuth refresh-token minter for the cockpit's Phase 2 Google Doc feature.
// Run AS hello@m42hq.com. A Service Account cannot own/create Docs (403
// storageQuotaExceeded), so per-task Docs are created by an OAuth-as-human client;
// this mints the durable refresh token that client uses.
//
// Prereqs (see the Phase 2 runbook): a GCP project (created while logged in as
// hello@) with the Docs API + Drive API enabled, an "Internal" OAuth consent
// screen (Internal => no verification, sensitive scopes OK, token never expires),
// and a "Desktop app" OAuth client. Desktop clients allow a loopback redirect, so
// there is nothing to pre-register.
//
// Usage (PowerShell, from docker/slack-cockpit where node_modules/googleapis lives):
//   $env:GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
//   $env:GOOGLE_CLIENT_SECRET="GOCSPX-..."
//   node tools/mint-oauth-token.mjs
// Open the printed URL logged in as hello@, approve; the token prints in the terminal.

import http from 'node:http'
import { google } from 'googleapis'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const PORT = 5599
const REDIRECT = `http://localhost:${PORT}/oauth2callback`
const SCOPES = [
  'https://www.googleapis.com/auth/documents', // create/read/write Google Docs
  'https://www.googleapis.com/auth/drive.file', // manage (create + share) app-created files only
]

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars — set them first (see the header).')
  process.exit(1)
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT)
const authUrl = oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES })

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith('/oauth2callback')) {
    res.writeHead(404)
    res.end()
    return
  }
  const code = new URL(req.url, REDIRECT).searchParams.get('code')
  if (!code) {
    res.writeHead(400)
    res.end('No ?code in the callback.')
    return
  }
  try {
    const { tokens } = await oauth2.getToken(code)
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Done — close this tab and return to the terminal.')
    console.log('\n================ SUCCESS ================')
    if (!tokens.refresh_token) {
      console.log('\n⚠️  No refresh_token returned (Google only returns it on the FIRST consent).')
      console.log('    Revoke the app at https://myaccount.google.com/permissions and re-run.')
    } else {
      console.log('\nPaste these 3 lines into /opt/apps/paperclip/docker/slack-cockpit/.env.cockpit on the VPS:\n')
      console.log(`GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}`)
      console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}`)
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`)
    }
    console.log('\nScopes granted:', tokens.scope)
    console.log('=========================================\n')
  } catch (e) {
    res.writeHead(500)
    res.end('Token exchange failed: ' + (e?.message ?? e))
    console.error('\nToken exchange failed:', e?.message ?? e)
  } finally {
    setTimeout(() => {
      server.close()
      process.exit(0)
    }, 500)
  }
})

server.listen(PORT, () => {
  console.log('\n1. Open this URL in a browser LOGGED IN AS hello@m42hq.com:\n')
  console.log(authUrl)
  console.log('\n2. Approve. This local listener on port ' + PORT + ' will capture the token and print it.\n')
})
