// Best-effort DM helper, isolated so a Slack failure can NEVER roll back a
// Sheet write. Only Claudio (cfg.notifyUserId) is ever notified — never Derek,
// never a channel (design rule).

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Config } from './config.js'
import { clamp } from './text.js'

function logErr(err: any): void {
  console.error('[cockpit] dmClaudio failed:', err?.code || err?.message || err)
}

/**
 * DM Claudio. Passing a user ID as `channel` auto-opens the IM. Fire-and-forget:
 * a failure is logged and swallowed so the caller's write still succeeds.
 */
export async function dmClaudio(client: any, cfg: Config, text: string): Promise<void> {
  try {
    await client.chat.postMessage({ channel: cfg.notifyUserId, text })
  } catch (err) {
    logErr(err)
  }
}

function sheetLink(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`
}

export function commentDmText(args: {
  sheetId: string
  taskNum: string
  company: string
  title: string
  author: string
  text: string
}): string {
  return (
    `💬 New comment on #${args.taskNum} (${args.company} · ${clamp(args.title, 120)}) from ${args.author}:\n` +
    `> ${clamp(args.text, 400)}\n` +
    sheetLink(args.sheetId)
  )
}

export function createDmText(args: {
  sheetId: string
  taskNum: number
  title: string
  business: string
  priority: string
  author: string
  warning?: string
}): string {
  const warn = args.warning ? `\n⚠️ ${args.warning}` : ''
  return (
    `➕ New task #${args.taskNum} created by ${args.author} — ${clamp(args.title, 200)} ` +
    `(${args.business}, ${args.priority})${warn}\n` +
    sheetLink(args.sheetId)
  )
}
