import type { App } from '@slack/bolt'
import type { Config } from './config.js'
import { buildPrivateView, isAllowed } from './allowlist.js'
import { getState, getTasks, invalidate, setState } from './state.js'
import { buildErrorView, buildHomeView } from './views/home.js'
import { buildCompanyView } from './views/company.js'
import { buildTaskModal } from './views/taskModal.js'
import { buildSearchModal, buildSearchResults, searchTasks } from './views/search.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

function logErr(where: string, err: any): void {
  console.error(`[cockpit] ${where} failed:`, err?.code || err?.message, err?.data?.error || err?.errors?.[0]?.message || '')
}

async function publishForUser(client: any, cfg: Config, userId: string): Promise<void> {
  if (!isAllowed(userId, cfg.allowlist)) {
    await client.views.publish({ user_id: userId, view: buildPrivateView() })
    return
  }
  try {
    const tasks = await getTasks(cfg)
    const state = getState(userId)
    const view =
      state.kind === 'company'
        ? buildCompanyView(tasks, state.companyId, state)
        : buildHomeView(tasks, state, { demo: cfg.demo })
    await client.views.publish({ user_id: userId, view })
  } catch (err) {
    // Never leave the Home a silent blank: publish a visible error state.
    logErr('publishForUser', err)
    await client.views.publish({ user_id: userId, view: buildErrorView() }).catch(() => {})
  }
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
    const companyId = String(action.action_id).split(':').slice(1).join(':')
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
    try {
      const taskNum = String(action.action_id).split(':')[1]
      const tasks = await getTasks(cfg)
      const task = tasks.find((t) => t.taskNum === taskNum)
      if (task) await client.views.open({ trigger_id: body.trigger_id, view: buildTaskModal(task) })
    } catch (err) {
      logErr('open_task', err)
    }
  })

  app.action('open_search', async ({ ack, body, client }: any) => {
    await ack()
    try {
      await client.views.open({ trigger_id: body.trigger_id, view: buildSearchModal() })
    } catch (err) {
      logErr('open_search', err)
    }
  })

  // URL buttons open client-side; still must be acked.
  app.action(/^url_/, async ({ ack }: any) => {
    await ack()
  })

  // v0: filters/sort are acked; the primary drill path is the company view.
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
    try {
      const query = view.state.values?.q?.search_query?.value ?? ''
      const tasks = await getTasks(cfg)
      const results = searchTasks(tasks, query)
      await client.views.publish({ user_id: body.user.id, view: buildSearchResults(results, query) })
    } catch (err) {
      logErr('search_submit', err)
    }
  })
}
