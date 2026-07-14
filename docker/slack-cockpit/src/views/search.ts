import { actions, button, context, divider, header, plainInput, section, type Block, type HomeView, type ModalView } from '../blocks.js'
import type { Task } from '../model.js'
import { paginate } from '../filters.js'
import { buildPager, taskCardRow, type BoardOpts } from './board.js'

/** Pure: case-insensitive substring over title + description + deliverable title + company. */
export function searchTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return tasks.filter((t) =>
    `${t.title} ${t.description ?? ''} ${t.deliverableTitle ?? ''} ${t.company}`.toLowerCase().includes(q),
  )
}

export function buildSearchModal(): ModalView {
  return {
    type: 'modal',
    callback_id: 'search_submit',
    title: { type: 'plain_text', text: 'Search tasks' },
    submit: { type: 'plain_text', text: 'Search' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [plainInput('q', 'Title, next action, or business', 'search_query')],
  }
}

export function buildSearchResults(results: Task[], query: string, page = 0, opts: BoardOpts = {}): HomeView {
  const paged = paginate(results, page)
  const blocks: Block[] = [
    header(`🔍 Results for “${query}”`),
    context(`${results.length} match${results.length === 1 ? '' : 'es'}`),
    actions([button('← Portfolio', 'back_to_home'), button('🔍 New search', 'open_search')]),
    divider(),
  ]
  if (results.length === 0) {
    blocks.push(section('_No tasks matched._'))
  } else {
    for (const t of paged.slice) blocks.push(taskCardRow(t, opts))
    blocks.push(...buildPager(paged))
  }
  return { type: 'home', blocks }
}
