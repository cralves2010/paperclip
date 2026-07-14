import boltPkg from '@slack/bolt'
import { loadConfig } from './config.js'
import { ensureCockpitStateTab } from './cockpit-state.js'
import { registerHandlers } from './handlers.js'
import { installSocketWatchdog } from './watchdog.js'

const { App } = boltPkg

const cfg = loadConfig()
const app = new App({
  token: cfg.slackBotToken,
  appToken: cfg.slackAppToken,
  socketMode: true,
})

registerHandlers(app, cfg)

// Best-effort: ensure the hidden per-user state tab exists (drives the "since you
// were here" digest). Never block startup on it — a failure just means no digest
// until it can be created.
if (!cfg.demo) {
  ensureCockpitStateTab(cfg).catch((e) => console.error('[cockpit] ensureCockpitStateTab failed:', e?.message))
}

await app.start()
console.log('⚡ Agent M42 cockpit running (socket mode)')

// Self-heal a silently-deaf Socket Mode link (the 2026-07-10 4-day freeze):
// turn a dead-but-alive socket into a clean exit so `restart: unless-stopped`
// gives us a fresh connection. See watchdog.ts for the full incident note.
installSocketWatchdog(app)
