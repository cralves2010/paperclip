// Best-effort DM helper, isolated so a Slack failure can NEVER roll back a
// Sheet write. Two-way loop (2026-07): Claudio is notified of Derek's comments,
// and Derek is notified of Claudio's replies (his "your move"). Notifying Derek
// is ADDITIVE — a dmUser call with his explicit user id — never a channel post
// and never a repoint of cfg.notifyUserId (that would redirect Claudio's DMs).

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Config } from './config.js'
import { clamp } from './text.js'

function logErr(err: any): void {
  console.error('[cockpit] dm failed:', err?.code || err?.message || err)
}

/**
 * DM any user. Passing a user ID as `channel` auto-opens the IM. Fire-and-forget:
 * a failure is logged and swallowed so the caller's write still succeeds. This is
 * the ONE post helper — dmClaudio and the Derek-facing reply both route through it
 * with an EXPLICIT channel.
 */
export async function dmUser(client: any, channel: string, text: string): Promise<void> {
  try {
    await client.chat.postMessage({ channel, text })
  } catch (err) {
    logErr(err)
  }
}

/** DM Claudio (the operator) at the configured notify target. */
export async function dmClaudio(client: any, cfg: Config, text: string): Promise<void> {
  return dmUser(client, cfg.notifyUserId, text)
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
    // Show Derek's comment IN FULL. The input modal caps him at 3000 chars
    // (Slack plain_text_input ceiling), and a DM `text` field carries ~40k, so a
    // whole comment always fits. The old 400 clamp was self-imposed and hid most
    // of every longer note behind a bare sheet link. (Case 2026-07-08.)
    `> ${clamp(args.text, 3000)}\n` +
    sheetLink(args.sheetId)
  )
}

/**
 * DM to DEREK when Claudio replies in a task's comment thread — the "your move"
 * side of the two-way loop. Sent via dmUser with Derek's explicit user id (see
 * handlers), NEVER by repointing cfg.notifyUserId. Shows the reply in full (the
 * input caps at 3000, which a DM text field carries comfortably).
 */
export function replyToDerekDmText(args: {
  sheetId: string
  taskNum: string
  company: string
  title: string
  text: string
}): string {
  return (
    `💬 New reply on #${args.taskNum} (${args.company} · ${clamp(args.title, 120)}) — *your move*:\n` +
    `> ${clamp(args.text, 3000)}\n` +
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
