import type { Config } from './config.js'
import type { Task, ViewState } from './model.js'
import { fetchTasks } from './sheets.js'

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
  if (cache && now - cache.at < TTL_MS) return cache.tasks
  const tasks = await fetchTasks(cfg)
  cache = { tasks, at: now }
  return tasks
}

export function invalidate(): void {
  cache = null
}
