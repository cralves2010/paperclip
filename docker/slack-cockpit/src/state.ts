import type { Config } from './config.js'
import type { Comment, Task, ViewState } from './model.js'
import { fetchComments, fetchTasks } from './sheets.js'
import { DEMO_COMMENTS, DEMO_TASKS } from './fixture.js'

// Per-user view-state so a background refresh re-publishes the SAME view the
// user is currently on (App Home holds no client-side nav state).
const viewStates = new Map<string, ViewState>()

export function getState(userId: string): ViewState {
  return viewStates.get(userId) ?? { kind: 'portfolio' }
}
export function setState(userId: string, s: ViewState): void {
  viewStates.set(userId, s)
}

// Single shared task cache (read-only data) with a short TTL.
let cache: { tasks: Task[]; at: number } | null = null
const TTL_MS = 60_000

export async function getTasks(cfg: Config, now: number = Date.now()): Promise<Task[]> {
  if (cfg.demo) return DEMO_TASKS
  if (cache && now - cache.at < TTL_MS) return cache.tasks
  try {
    const tasks = await fetchTasks(cfg)
    // Don't cache a suspicious empty parse as success (header/tab/share bug):
    // serve the last good cache if we have one instead of a false "all clear".
    if (tasks.length === 0 && cache && cache.tasks.length > 0) return cache.tasks
    if (tasks.length > 0) cache = { tasks, at: now }
    return tasks
  } catch (err) {
    // Stale-while-error: keep showing the last good data through a transient
    // outage; only surface an error when we have nothing to show.
    if (cache && cache.tasks.length > 0) return cache.tasks
    throw err
  }
}

// Separate comments cache (same TTL). Kept SEPARATE from the task cache so a
// Comments-tab read error can never blank the task board (error isolation).
let commentsCache: { comments: Comment[]; at: number } | null = null

export async function getComments(cfg: Config, now: number = Date.now()): Promise<Comment[]> {
  if (cfg.demo) return DEMO_COMMENTS
  if (commentsCache && now - commentsCache.at < TTL_MS) return commentsCache.comments
  try {
    const comments = await fetchComments(cfg)
    commentsCache = { comments, at: now }
    return comments
  } catch {
    // Never throw from comments: an empty layer degrades gracefully (no badges).
    return commentsCache?.comments ?? []
  }
}

export function invalidate(): void {
  cache = null
  commentsCache = null
}

/**
 * Epoch ms of the last SUCCESSFUL task sync (null before the first read). Drives
 * the cockpit freshness dot: while the sheet is reachable this stays within the
 * TTL (fresh/green); under stale-while-error it stops advancing, so the dot ages
 * to yellow/red — surfacing that the tracker sync is broken.
 */
export function lastSyncAt(): number | null {
  return cache?.at ?? null
}
