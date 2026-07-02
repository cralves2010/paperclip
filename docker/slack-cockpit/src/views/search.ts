import { button, context, divider, header, plainInput, section, type Block, type HomeView, type ModalView } from '../blocks.js'
import { STATUS_EMOJI, STATUS_LABEL, type Task } from '../model.js'
import { clamp } from '../text.js'

/** Pure: case-insensitive substring over title + description + deliverable title. */
export function searchTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return tasks.filter((t) =>
    `${t.title} ${t.description ?? ''} ${t.deliverableTitle ?? ''}`.toLowerCase().includes(q),
  )
}

export function buildSearchModal(): ModalView {
  return {
    type: 'modal',
    callback_id: 'search_submit',
    title: { type: 'plain_text', text: 'Search tasks' },
    submit: { type: 'plain_text', text: 'Search' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [plainInput('q', 'Description or deliverable', 'search_query')],
  }
}

export function buildSearchResults(results: Task[], query: string): HomeView {
  const blocks: Block[] = [
    header(`🔍 Results for “${query}”`),
    context(`${results.length} match${results.length === 1 ? '' : 'es'}`),
    divider(),
  ]
  if (results.length === 0) {
    blocks.push(section('_No tasks matched._'))
  } else {
    for (const t of results.slice(0, 20)) {
      blocks.push(
        section(`*${clamp(t.title, 200)}*\n\`${t.company}-${t.taskNum}\` · ${STATUS_EMOJI[t.status]} ${STATUS_LABEL[t.status]}`, button('Open', `open_task:${t.taskNum}`)),
      )
    }
  }
  blocks.push(divider(), button('← Portfolio', 'back_to_home'))
  return { type: 'home', blocks }
}
