import { writeFileSync } from 'node:fs'

/** Heartbeat file the Docker healthcheck stat()s for freshness (touched only while the link is believed up). */
export const HEARTBEAT_FILE = '/tmp/cockpit-alive'

/** Minimal structural view of the @slack/socket-mode client we listen on. */
interface SocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void
}

export interface WatchdogOptions {
  /** Exit if the Socket Mode link stays down longer than this (fast path). Default 120s. */
  graceMs?: number
  /** Recycle the process after this uptime regardless — a floor that catches a missed disconnect. Default 4h. */
  maxLifetimeMs?: number
  /** How often to re-touch the heartbeat while the socket is believed up. Default 30s. */
  beatMs?: number
  heartbeatFile?: string
}

/**
 * Pure: has the Socket Mode connection been down long enough to warrant a clean
 * process exit? `downSince` is null while the link is believed healthy.
 */
export function socketDownTooLong(downSince: number | null, now: number, graceMs: number): boolean {
  return downSince != null && now - downSince >= graceMs
}

/**
 * Install the Socket Mode liveness watchdog.
 *
 * Background: on 2026-07-10 the cockpit's Socket Mode WebSocket went deaf (pong
 * timeouts, no reconnect) while the Node process stayed alive — so Slack showed
 * Derek a frozen App Home and a ⚠️ on every button for FOUR days. Two facts made
 * it invisible and unrecoverable: (a) `restart: unless-stopped` only fires on a
 * process EXIT, which never happened; (b) there is no way to prove a Socket Mode
 * link is live without receiving traffic, and there was no health signal.
 *
 * Two defenses, both ending in a clean exit so the restart policy hands us a
 * fresh socket:
 *   1. fast path — exit if the socket drops ('disconnected' / 'reconnecting' /
 *      'close') and does not recover ('connected' / 'slack_event') within graceMs.
 *   2. floor — recycle after maxLifetimeMs so a missed (1), e.g. a wedge with no
 *      event at all, still self-heals within hours instead of days.
 * A heartbeat file (touched only while the link is believed up) gives the Docker
 * healthcheck an honest signal so the NEXT incident is visible in `docker ps`.
 *
 * Called AFTER app.start() resolves, so the socket is connected at install time
 * (downSince starts null); a boot that never connects throws from app.start()
 * and is handled by the restart policy directly.
 */
export function installSocketWatchdog(app: unknown, opts: WatchdogOptions = {}): void {
  const graceMs = opts.graceMs ?? (Number(process.env.COCKPIT_SOCKET_GRACE_MS) || 120_000)
  const maxLifetimeMs = opts.maxLifetimeMs ?? (Number(process.env.COCKPIT_MAX_LIFETIME_MS) || 4 * 60 * 60 * 1000)
  const beatMs = opts.beatMs ?? 30_000
  const heartbeatFile = opts.heartbeatFile ?? HEARTBEAT_FILE

  let downSince: number | null = null // app.start() resolved => the socket is up now
  const beat = (): void => {
    try {
      writeFileSync(heartbeatFile, String(Date.now()))
    } catch {
      /* healthcheck degrades to none — never let a write error touch the app */
    }
  }
  const markUp = (): void => {
    downSince = null
    beat()
  }
  const markDown = (): void => {
    if (downSince == null) downSince = Date.now()
  }

  // (2) max-lifetime floor — never depends on any event firing.
  setTimeout(() => {
    console.log(`[cockpit] max lifetime ${Math.round(maxLifetimeMs / 60_000)}m reached — exiting for a fresh socket`)
    process.exit(0)
  }, maxLifetimeMs).unref()

  const smClient = (app as { receiver?: { client?: SocketLike } })?.receiver?.client
  if (!smClient?.on) {
    console.warn('[cockpit] socket client not exposed — watchdog on max-lifetime floor only')
    beat() // still feed the healthcheck so a present-but-quiet app reads healthy
    return
  }
  smClient.on('connected', markUp)
  smClient.on('slack_event', markUp)
  smClient.on('disconnected', markDown)
  smClient.on('reconnecting', markDown)
  smClient.on('close', markDown) // a lost WebSocket that then reconnects clears via 'connected'

  beat() // seed on startup
  setInterval(() => {
    if (downSince == null) beat()
  }, beatMs).unref()
  setInterval(() => {
    if (socketDownTooLong(downSince, Date.now(), graceMs)) {
      console.error(`[cockpit] Socket Mode down >${Math.round(graceMs / 1000)}s — exiting for a clean restart`)
      process.exit(1)
    }
  }, Math.min(beatMs, 20_000))
}
