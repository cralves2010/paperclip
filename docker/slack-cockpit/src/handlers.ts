import type { App } from '@slack/bolt'
import type { Config } from './config.js'
import { buildPrivateView, isAllowed } from './allowlist.js'
import { getState, getTasks, invalidate, setState } from './state.js'
import { buildHomeView } from './views/home.js'
import { buildCompanyView } from './views/company.js'
import { buildTaskModal } from './views/taskModal.js'
import { buildSearchModal, buildSearchResults, searchTasks } from './views/search.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

async function publishForUser(client: any, cfg: Config, userId: string): Promise<void> {
  if (!isAllowed(userId, cfg.allowlist)) {
    await client.views.publish({ user_id: userId, view: buildPrivateView() })
    return
  }
  const tasks = await getTasks(cfg)
  const state = getState(userId)
  const view = state.kind === 'company' ? buildCompanyView(tasks, state.companyId, state) : buildHomeView(tasks, state)
  await client.views.publish({ user_id: userId, view })
}

export function registerHandlers(app: App, cfg: Config): void {
  app.event('app_home_opened', async ({ event, client }: any) => {
    await publishForUser(client, cfg, event.user)
  })

  app.action('refresh_home', async ({ ack, body, client }: any) => {
    await ack()
    invalidate()
    await publishForUser(client, cfg, body.user.id)
  })

  app.action(/^open_company:/, async ({ ack, action, body, client }: any) => {
    await ack()
    const companyId = String(action.action_id).split(':')[1]
    setState(body.user.id, { kind: 'company', companyId })
    await publishForUser(client, cfg, body.user.id)
  })

  app.action('back_to_home', async ({ ack, body, client }: any) => {
    await ack()
    setState(body.user.id, { kind: 'portfolio' })
    await publishForUser(client, cfg, body.user.id)
  })

  app.action(/^open_task:/, async ({ ack, action, body, client }: any) => {
    await ack()
    const taskNum = String(action.action_id).split(':')[1]
    const tasks = await getTasks(cfg)
    const task = tasks.find((t) => t.taskNum === taskNum)
    if (task) await client.views.open({ trigger_id: body.trigger_id, view: buildTaskModal(task) })
  })

  app.action('open_search', async ({ ack, body, client }: any) => {
    await ack()
    await client.views.open({ trigger_id: body.trigger_id, view: buildSearchModal() })
  })

  // URL buttons open client-side; still must be acked.
  app.action(/^url_/, async ({ ack }: any) => {
    await ack()
  })

  // v0: filters/sort are acked; the primary drill path is company view. Full
  // filter application lands with the persisted-filter wiring (kept minimal here).
  app.action('filter_company', async ({ ack }: any) => {
    await ack()
  })
  app.action('filter_status', async ({ ack }: any) => {
    await ack()
  })
  app.action('sort', async ({ ack }: any) => {
    await ack()
  })

  app.view('search_submit', async ({ ack, view, body, client }: any) => {
    await ack()
    const query = view.state.values?.q?.search_query?.value ?? ''
    const tasks = await getTasks(cfg)
    const results = searchTasks(tasks, query)
    await client.views.publish({ user_id: body.user.id, view: buildSearchResults(results, query) })
  })
}
