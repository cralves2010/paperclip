// All act-layer modals + their pure helpers, grouped so handlers stay thin.

import { plainInput, section, selectInput, type ModalView } from '../blocks.js'
import { distinctBusinesses, distinctPriorities } from '../filters.js'
import type { Task } from '../model.js'
import { clamp, truncateTitle } from '../text.js'

/** Where a comment modal was opened from (drives the post-submit refresh). */
export type CommentOrigin = 'home' | 'modal'

export interface CommentMetadata {
  taskNum: string
  origin: CommentOrigin
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** JSON round-trip for the comment modal's private_metadata. */
export function buildCommentMetadata(meta: CommentMetadata): string {
  return JSON.stringify({ taskNum: meta.taskNum, origin: meta.origin })
}

export function parseCommentMetadata(raw: string | undefined): CommentMetadata {
  try {
    const o = JSON.parse(raw ?? '{}')
    const origin: CommentOrigin = o?.origin === 'modal' ? 'modal' : 'home'
    return { taskNum: String(o?.taskNum ?? ''), origin }
  } catch {
    return { taskNum: '', origin: 'home' }
  }
}

/** Returns an error string when the comment is empty after trim, else null. */
export function validateComment(text: string): string | null {
  return (text ?? '').trim().length === 0 ? 'Comment cannot be empty.' : null
}

/**
 * Author attribution with zero extra Slack scope: `@name (Uxxxx)` when a
 * display name is known, else the raw user id. A friendly-name map can layer
 * on later without changing the stored format's shape.
 */
export function attributeAuthor(userId: string, userName?: string): string {
  return userName ? `@${userName} (${userId})` : userId
}

// ── View builders ───────────────────────────────────────────────────────────

const PRIORITY_FALLBACK = ['P0', 'P1', 'P2', 'P3']

export function buildCommentModal(args: {
  taskNum: string
  title: string
  company: string
  origin: CommentOrigin
}): ModalView {
  return {
    type: 'modal',
    callback_id: 'comment_submit',
    title: { type: 'plain_text', text: truncateTitle(`💬 #${args.taskNum}`) },
    submit: { type: 'plain_text', text: 'Post' },
    close: { type: 'plain_text', text: 'Cancel' },
    private_metadata: buildCommentMetadata({ taskNum: args.taskNum, origin: args.origin }),
    blocks: [
      section(`*${clamp(args.title, 200)}*\n\`${args.company}-${args.taskNum}\``),
      plainInput('comment', 'Comment', 'comment_text', {
        multiline: true,
        maxLength: 1000,
        placeholder: 'Add a comment for the team working this task…',
      }),
    ],
  }
}

export function buildCreateModal(tasks: Task[]): ModalView {
  const businesses = distinctBusinesses(tasks)
  const priorities = distinctPriorities(tasks)
  const priorityOptions = (priorities.length > 0 ? priorities : PRIORITY_FALLBACK).map((p) => ({ text: p, value: p }))
  const businessOptions = businesses.map((b) => ({ text: b, value: b }))

  return {
    type: 'modal',
    callback_id: 'create_task_submit',
    title: { type: 'plain_text', text: '➕ New task' },
    submit: { type: 'plain_text', text: 'Create' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      selectInput('business', 'Business', 'business_select', businessOptions, {
        placeholder: 'Pick a business',
      }),
      plainInput('title', 'Task title', 'title_text', { maxLength: 300, placeholder: 'What needs doing?' }),
      selectInput('priority', 'Priority', 'priority_select', priorityOptions, {
        placeholder: 'Pick a priority tier',
      }),
      plainInput('notes', 'Next action (optional)', 'notes_text', {
        multiline: true,
        maxLength: 500,
        optional: true,
        placeholder: 'Optional first next-action / notes',
      }),
    ],
  }
}

export function buildDemoNoticeModal(kind: 'comment' | 'create'): ModalView {
  const what = kind === 'comment' ? 'Comments' : 'Task creation'
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Demo mode' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      section(`🧪 *Demo mode is on.*\n${what} is disabled here — this cockpit is showing a sample fixture, not the live tracker.`),
      section('Switch off `COCKPIT_DEMO` (live mode) to act on real tasks.'),
    ],
  }
}

export function buildActErrorModal(msg: string): ModalView {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Something went wrong' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [section(`⚠️ *${clamp(msg, 2900)}*`)],
  }
}

export function buildDeniedModal(): ModalView {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Agent M42' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [section('🔒 *This app is private.*\nYou do not have access to act here.')],
  }
}
