import type { App } from '@slack/bolt'
import type { Config } from './config.js'
import { buildPrivateView, isAllowed } from './allowlist.js'
import { getComments, getState, getTasks, invalidate, lastSyncAt, setState } from './state.js'
import { commentCountByTask } from './sheets.js'
import { appendComment, createTask } from './sheets-write.js'
import { dmClaudio, createDmText } from './notify.js'
import { classifyAndCompose } from './classify.js'
import { section, type ModalView } from './blocks.js'
import { taskRef } from './text.js'
import { buildErrorView, buildHomeView } from './views/home.js'
import { buildBoardView } from './views/board.js'
import { buildTaskModal } from './views/taskModal.js'
import { resolveViewer } from './views/didactic.js'
import { buildSearchModal, buildSearchResults, searchTasks } from './views/search.js'
import {
  attributeAuthor,
  buildActErrorModal,
  buildCommentModal,
  buildCreateModal,
  buildDemoNoticeModal,
  buildDeniedModal,
  parseCommentMetadata,
  validateComment,
} from './views/actModals.js'
import type { BoardSort, StatusFilter, Task, ViewState } from './model.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

function logErr(where: string, err: any): void {
  console.error(`[cockpit] ${where} failed:`, err?.code || err?.message, err?.data?.error || err?.errors?.[0]?.message || '')
}

type BoardState = Extract<ViewState, { kind: 'board' }>

function boardState(userId: string): BoardState {
  const s = getState(userId)
  return s.kind === 'board' ? { ...s, filters: { ...s.filters } } : { kind: 'board', filters: {}, sort: 'updated', page: 0 }
}

function authorFor(body: any): string {
  return attributeAuthor(body?.user?.id ?? '', body?.user?.username || body?.user?.name || undefined)
}

async function publishForUser(client: any, cfg: Config, userId: string): Promise<void> {
  if (!isAllowed(userId, cfg.allowlist)) {
    await client.views.publish({ user_id: userId, view: buildPrivateView() })
    return
  }
  try {
    const [tasks, comments] = await Promise.all([getTasks(cfg), getComments(cfg)])
    const commentCounts = commentCountByTask(comments)
    const state = getState(userId)
    const syncedAtMs = lastSyncAt() ?? undefined
    let view
    if (state.kind === 'board') {
      view = buildBoardView(tasks, state, { demo: cfg.demo, commentCounts, allTasks: tasks, syncedAtMs })
    } else if (state.kind === 'search') {
      view = buildSearchResults(searchTasks(tasks, state.query), state.query, state.page, { commentCounts })
    } else {
      view = buildHomeView(tasks, state, { demo: cfg.demo, commentCounts, syncedAtMs })
    }
    await client.views.publish({ user_id: userId, view })
  } catch (err) {
    // Never leave the Home a silent blank: publish a visible error state.
    logErr('publishForUser', err)
    await client.views.publish({ user_id: userId, view: buildErrorView() }).catch(() => {})
  }
}

/** Build a task modal for `taskNum` with its comments; returns null if not found. */
async function taskModalFor(cfg: Config, taskNum: string, userId: string): Promise<ModalView | null> {
  const [tasks, comments] = await Promise.all([getTasks(cfg), getComments(cfg)])
  const task = tasks.find((t) => t.taskNum === taskNum)
  return task ? buildTaskModal(task, comments, resolveViewer(userId, cfg)) : null
}

export function registerHandlers(app: App, cfg: Config): void {
  const guard = (userId: string): boolean => isAllowed(userId, cfg.allowlist)

  // ── Navigation ────────────────────────────────────────────────────────────

  app.event('app_home_opened', async ({ event, client }: any) => {
    await publishForUser(client, cfg, event.user)
  })

  app.action('refresh_home', async ({ ack, body, client }: any) => {
    await ack()
    invalidate()
    await publishForUser(client, cfg, body.user.id)
  })

  app.action('open_board', async ({ ack, body, client }: any) => {
    await ack()
    setState(body.user.id, { kind: 'board', filters: {}, sort: 'updated', page: 0 })
    await publishForUser(client, cfg, body.user.id)
  })

  app.action(/^open_company:/, async ({ ack, action, body, client }: any) => {
    await ack()
    const biz = String(action.action_id).split(':').slice(1).join(':')
    setState(body.user.id, { kind: 'board', filters: { business: biz }, sort: 'updated', page: 0 })
    await publishForUser(client, cfg, body.user.id)
  })

  app.action('back_to_home', async ({ ack, body, client }: any) => {
    await ack()
    setState(body.user.id, { kind: 'portfolio' })
    await publishForUser(client, cfg, body.user.id)
  })

  // ── Board filters / sort / paging ─────────────────────────────────────────

  app.action('filter_business', async ({ ack, action, body, client }: any) => {
    await ack()
    const v = action.selected_option?.value
    const b = boardState(body.user.id)
    b.filters.business = v && v !== '__all__' ? v : undefined
    b.page = 0
    setState(body.user.id, b)
    await publishForUser(client, cfg, body.user.id)
  })

  app.action('filter_status', async ({ ack, action, body, client }: any) => {
    await ack()
    const v = action.selected_option?.value as StatusFilter | undefined
    const b = boardState(body.user.id)
    b.filters.status = v && v !== 'all' ? v : undefined
    b.page = 0
    setState(body.user.id, b)
    await publishForUser(client, cfg, body.user.id)
  })

  app.action('filter_priority', async ({ ack, action, body, client }: any) => {
    await ack()
    const v = action.selected_option?.value
    const b = boardState(body.user.id)
    b.filters.priority = v && v !== '__all__' ? v : undefined
    b.page = 0
    setState(body.user.id, b)
    await publishForUser(client, cfg, body.user.id)
  })

  app.action('sort_by', async ({ ack, action, body, client }: any) => {
    await ack()
    const v = action.selected_option?.value as BoardSort
    const b = boardState(body.user.id)
    b.sort = v ?? 'updated'
    b.page = 0
    setState(body.user.id, b)
    await publishForUser(client, cfg, body.user.id)
  })

  app.action('clear_filters', async ({ ack, body, client }: any) => {
    await ack()
    const b = boardState(body.user.id)
    b.filters = {}
    b.page = 0
    setState(body.user.id, b)
    await publishForUser(client, cfg, body.user.id)
  })

  const pageBy = (delta: number) => async ({ ack, body, client }: any) => {
    await ack()
    const s = getState(body.user.id)
    if (s.kind === 'board') setState(body.user.id, { ...s, page: Math.max(0, s.page + delta) })
    else if (s.kind === 'search') setState(body.user.id, { ...s, page: Math.max(0, s.page + delta) })
    await publishForUser(client, cfg, body.user.id)
  }
  app.action('page_prev', pageBy(-1))
  app.action('page_next', pageBy(1))

  // ── Task detail (hero row Open button) ────────────────────────────────────

  app.action(/^open_task:/, async ({ ack, action, body, client }: any) => {
    await ack()
    const taskNum = String(action.action_id).split(':')[1]
    await openTaskModal(client, cfg, body.trigger_id, taskNum, body.user.id)
  })

  // ── Board card overflow menu ──────────────────────────────────────────────

  app.action(/^card_menu:/, async ({ ack, action, body, client }: any) => {
    // ALWAYS ack (a deliverable option opens its url client-side).
    await ack()
    try {
      if (!guard(body.user.id)) return
      const value: string = action.selected_option?.value ?? ''
      const [kind, taskNum] = value.split(':')
      if (kind === 'open') {
        await openTaskModal(client, cfg, body.trigger_id, taskNum, body.user.id)
      } else if (kind === 'comment') {
        await openCommentModal(client, cfg, body.trigger_id, taskNum, 'home', false)
      }
      // 'deliverable' -> no-op; the overflow url opened it client-side.
    } catch (err) {
      logErr('card_menu', err)
    }
  })

  // ── Add-comment button inside the task modal ──────────────────────────────

  app.action(/^comment:/, async ({ ack, action, body, client }: any) => {
    await ack()
    try {
      if (!guard(body.user.id)) return
      const taskNum = String(action.action_id).split(':')[1]
      await openCommentModal(client, cfg, body.trigger_id, taskNum, 'modal', true)
    } catch (err) {
      logErr('comment_button', err)
    }
  })

  // ── Search ────────────────────────────────────────────────────────────────

  app.action('open_search', async ({ ack, body, client }: any) => {
    await ack()
    try {
      if (!guard(body.user.id)) return
      await client.views.open({ trigger_id: body.trigger_id, view: buildSearchModal() })
    } catch (err) {
      logErr('open_search', err)
    }
  })

  app.view('search_submit', async ({ ack, view, body, client }: any) => {
    // Defense-in-depth: gate uniformly with the other act handlers. (publishForUser
    // already re-checks the allowlist, but keep every handler self-guarding.)
    if (!guard(body.user.id)) {
      await ack({ response_action: 'update', view: buildDeniedModal() })
      return
    }
    const query = (view.state.values?.q?.search_query?.value ?? '').trim()
    if (!query) {
      await ack({ response_action: 'errors', errors: { q: 'Type something to search.' } })
      return
    }
    await ack()
    setState(body.user.id, { kind: 'search', query, page: 0 })
    await publishForUser(client, cfg, body.user.id)
  })

  // ── Create task ───────────────────────────────────────────────────────────

  app.action('open_create_task', async ({ ack, body, client }: any) => {
    await ack()
    if (!guard(body.user.id)) return
    // Open a loading modal from the fresh trigger_id FIRST (no awaited I/O in
    // between, which could blow the ~3s trigger_id window on a cold cache), then
    // hydrate with the derived business/priority options.
    let opened
    try {
      opened = await client.views.open({ trigger_id: body.trigger_id, view: loadingModal('⏳ Loading…') })
    } catch (err) {
      logErr('open_create_task.open', err)
      return
    }
    try {
      const tasks = await getTasks(cfg)
      const viewId = opened?.view?.id
      if (viewId) await client.views.update({ view_id: viewId, view: buildCreateModal(tasks) })
    } catch (err) {
      logErr('open_create_task.hydrate', err)
    }
  })

  // ── URL buttons (open client-side; still acked) ───────────────────────────

  app.action(/^url_/, async ({ ack }: any) => {
    await ack()
  })

  // ── View submissions ──────────────────────────────────────────────────────

  app.view('comment_submit', async ({ ack, view, body, client }: any) => {
    if (!guard(body.user.id)) {
      await ack({ response_action: 'update', view: buildDeniedModal() })
      return
    }
    const { taskNum, origin } = parseCommentMetadata(view.private_metadata)
    const text = view.state.values?.comment?.comment_text?.value ?? ''
    const invalid = validateComment(text)
    if (invalid) {
      await ack({ response_action: 'errors', errors: { comment: invalid } })
      return
    }
    if (cfg.demo) {
      await ack({ response_action: 'update', view: buildDemoNoticeModal('comment') })
      return
    }
    // Ack FIRST (updating the current view in place) so the multi-round-trip
    // Sheets write never races the hard 3s view_submission deadline. We then
    // update the SAME view id with the result — an empty ack on a pushed modal
    // tears the stack down, so views.update on root_view_id would no-op.
    await ack({ response_action: 'update', view: workingModal('💬 Posting comment…') })
    const viewId: string | undefined = body.view?.id
    const author = authorFor(body)
    try {
      await appendComment(cfg, { taskNum, author, text: text.trim() }, undefined)
    } catch (err) {
      logErr('comment_submit.append', err)
      if (viewId) {
        await client.views
          .update({ view_id: viewId, view: buildActErrorModal("Couldn't save — tracker unreachable. Try again or ping Claudio.") })
          .catch((e: any) => logErr('comment_submit.errUpdate', e))
      }
      return
    }
    // Bust the read caches so the refreshed modal + Home reflect the new comment.
    invalidate()
    // Resolve the task once — shared by the confirm modal (for the full
    // `COMPANY-N` ref) and the best-effort DM below.
    let task: Task | undefined
    try {
      const tasks = await getTasks(cfg)
      task = tasks.find((t) => t.taskNum === taskNum)
    } catch (err) {
      logErr('comment_submit.lookup', err)
    }
    const ref = task ? taskRef(task) : `#${taskNum}`
    // Success: refresh the SAME view in place. From a task modal, show the
    // refreshed task detail (with the new comment); from Home, a short confirm.
    try {
      if (viewId) {
        const view = origin === 'modal' ? (await taskModalFor(cfg, taskNum, body.user.id)) ?? commentPostedModal(ref) : commentPostedModal(ref)
        await client.views.update({ view_id: viewId, view })
      }
    } catch (err) {
      logErr('comment_submit.refresh', err)
    }
    // Best-effort DM to Claudio (never rolls back the write). Enriched with a
    // classification when COCKPIT_CLASSIFY is on; falls back to the raw DM
    // otherwise or on any classifier failure (the notification never depends on
    // the LLM succeeding). Runs post-ack, so it can't touch the 3s deadline.
    try {
      const base = { sheetId: cfg.sheetId, taskNum, company: task?.company ?? '—', title: task?.title ?? '—', author, text: text.trim() }
      const dm = await classifyAndCompose(cfg, { authorId: body?.user?.id ?? '', base, task, prior: [] })
      await dmClaudio(client, cfg, dm)
    } catch (err) {
      logErr('comment_submit.dm', err)
    }
    await publishForUser(client, cfg, body.user.id)
  })

  app.view('create_task_submit', async ({ ack, view, body, client }: any) => {
    if (!guard(body.user.id)) {
      await ack({ response_action: 'update', view: buildDeniedModal() })
      return
    }
    if (cfg.demo) {
      await ack({ response_action: 'update', view: buildDemoNoticeModal('create') })
      return
    }
    const v = view.state.values
    const business = v?.business?.business_select?.selected_option?.value ?? ''
    const title = (v?.title?.title_text?.value ?? '').trim()
    const priority = v?.priority?.priority_select?.selected_option?.value ?? ''
    const notes = (v?.notes?.notes_text?.value ?? '').trim()
    if (!title) {
      await ack({ response_action: 'errors', errors: { title: 'Task title cannot be empty.' } })
      return
    }
    // Ack FIRST with a working view so the read+append+re-read round-trips never
    // race the 3s view_submission deadline (a late ack makes Slack show Derek an
    // error and he retries -> a duplicate task row). Then update the SAME view id
    // with the outcome.
    await ack({ response_action: 'update', view: workingModal('➕ Creating task…') })
    const viewId: string | undefined = body.view?.id
    let res
    try {
      res = await createTask(cfg, { business, priority, title, notes: notes || undefined }, undefined)
    } catch (err) {
      logErr('create_task_submit', err)
      if (viewId) {
        await client.views
          .update({ view_id: viewId, view: buildActErrorModal("Couldn't create the task — tracker unreachable. Try again or ping Claudio.") })
          .catch((e: any) => logErr('create_task_submit.errUpdate', e))
      }
      return
    }
    const warn = res.warning ? `\n⚠️ ${res.warning}` : ''
    if (viewId) {
      await client.views
        .update({ view_id: viewId, view: successModal(`✅ *Task ${business}-${res.taskNum} created* — Not Started${warn}`) })
        .catch((e: any) => logErr('create_task_submit.okUpdate', e))
    }
    const author = authorFor(body)
    await dmClaudio(client, cfg, createDmText({ sheetId: cfg.sheetId, taskNum: res.taskNum, title, business, priority, author, warning: res.warning }))
    invalidate()
    await publishForUser(client, cfg, body.user.id)
  })
}

/**
 * Open a task-detail modal without letting Sheets I/O race the trigger_id: open
 * a loading modal from the fresh trigger_id FIRST (no awaited I/O), then hydrate
 * the SAME view id with the resolved task detail.
 */
async function openTaskModal(client: any, cfg: Config, triggerId: string, taskNum: string, userId: string): Promise<void> {
  let opened
  try {
    opened = await client.views.open({ trigger_id: triggerId, view: loadingModal('⏳ Loading task…') })
  } catch (err) {
    logErr('openTaskModal.open', err)
    return
  }
  try {
    const modal = await taskModalFor(cfg, taskNum, userId)
    const viewId = opened?.view?.id
    if (viewId) await client.views.update({ view_id: viewId, view: modal ?? buildActErrorModal(`Task ${taskNum} not found.`) })
  } catch (err) {
    logErr('openTaskModal.hydrate', err)
  }
}

/**
 * Open (or push) the comment modal for a task. Open/push a loading modal FIRST
 * from the fresh trigger_id (no awaited I/O in between — a cold-cache getTasks
 * could otherwise blow the ~3s trigger_id window and the modal silently never
 * opens), then hydrate with the real comment form.
 */
async function openCommentModal(
  client: any,
  cfg: Config,
  triggerId: string,
  taskNum: string,
  origin: 'home' | 'modal',
  push: boolean,
): Promise<void> {
  const loading = loadingModal('💬 Loading…')
  let opened
  try {
    opened = push
      ? await client.views.push({ trigger_id: triggerId, view: loading })
      : await client.views.open({ trigger_id: triggerId, view: loading })
  } catch (err) {
    logErr('openCommentModal.open', err)
    return
  }
  try {
    const tasks = await getTasks(cfg)
    const task = tasks.find((t) => t.taskNum === taskNum)
    const view = buildCommentModal({
      taskNum,
      title: task?.title ?? `Task ${taskNum}`,
      company: task?.company ?? '—',
      origin,
    })
    const viewId = opened?.view?.id
    if (viewId) await client.views.update({ view_id: viewId, view })
  } catch (err) {
    logErr('openCommentModal.hydrate', err)
  }
}

/** A minimal placeholder modal shown instantly while data is fetched. */
function loadingModal(text: string): ModalView {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Agent M42' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [section(text)],
  }
}

/** Shown after a submit is acked while the Sheet write completes. */
function workingModal(text: string): ModalView {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Working…' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [section(`${text}\n_Keep this open a moment…_`)],
  }
}

function commentPostedModal(ref: string): ModalView {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Comment posted' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [section(`✅ *Comment added to ${ref}.*\nClaudio has been notified.`)],
  }
}

function successModal(text: string): ModalView {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Task created' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [section(text)],
  }
}
