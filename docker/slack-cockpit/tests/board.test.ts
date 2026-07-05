import { expect, test } from 'vitest'
import { buildBoardView, taskCardRow } from '../src/views/board.js'
import type { BoardFilters, BoardSort, Task, ViewState } from '../src/model.js'

const t = (o: Partial<Task>): Task => ({
  taskNum: '1',
  company: 'JRS',
  title: 'x',
  owner: 'a',
  status: 'in_progress',
  rawStatus: '',
  ...o,
})

const board = (filters: BoardFilters = {}, sort: BoardSort = 'updated', page = 0): Extract<ViewState, { kind: 'board' }> => ({
  kind: 'board',
  filters,
  sort,
  page,
})

const many = (n: number): Task[] =>
  Array.from({ length: n }, (_, i) => t({ taskNum: String(i + 1), title: `Task ${i + 1}`, lastUpdatedTs: i }))

test('buildBoardView stays under 100 blocks per page', () => {
  const view = buildBoardView(many(200), board())
  expect(view.blocks.length).toBeLessThan(100)
})

test('conditional pager: page 0 has Next only, last page has Prev only, middle has both', () => {
  const tasks = many(200) // 10 pages at PAGE_SIZE 20
  const first = JSON.stringify(buildBoardView(tasks, board({}, 'updated', 0)))
  expect(first).toContain('page_next')
  expect(first).not.toContain('page_prev')

  const last = JSON.stringify(buildBoardView(tasks, board({}, 'updated', 9)))
  expect(last).toContain('page_prev')
  expect(last).not.toContain('page_next')

  const mid = JSON.stringify(buildBoardView(tasks, board({}, 'updated', 5)))
  expect(mid).toContain('page_prev')
  expect(mid).toContain('page_next')
})

test('taskCardRow is exactly one section block with an overflow accessory', () => {
  const block: any = taskCardRow(t({ taskNum: '7' }))
  expect(block.type).toBe('section')
  expect(block.accessory.type).toBe('overflow')
  expect(block.accessory.action_id).toBe('card_menu:7')
})

test('taskCardRow omits deliverable option + 💬 badge when absent, includes both when present', () => {
  const bare: any = taskCardRow(t({ taskNum: '1' }))
  const bareJson = JSON.stringify(bare)
  expect(bareJson).toContain('open:1')
  expect(bareJson).toContain('comment:1')
  expect(bareJson).not.toContain('deliverable:1')
  // The 💬 badge lives in the card text (the overflow always has a 💬 Comment option).
  expect(bare.text.text).not.toContain('💬')

  const rich: any = taskCardRow(t({ taskNum: '2', deliverableDriveUrl: 'https://docs.google.com/x' }), {
    commentCounts: new Map([['2', 3]]),
  })
  const richJson = JSON.stringify(rich)
  expect(richJson).toContain('deliverable:2')
  expect(richJson).toContain('https://docs.google.com/x')
  expect(rich.text.text).toContain('💬 3')
  expect(rich.text.text).toContain('📎')
})

test('empty filter result shows the empty state + clear_filters', () => {
  const json = JSON.stringify(buildBoardView(many(5), board({ business: 'Nonexistent' })))
  expect(json).toContain('No tasks match these filters')
  expect(json).toContain('clear_filters')
})

test('filter/sort selects carry initial_option matching state', () => {
  const json = JSON.stringify(buildBoardView(many(5), board({ business: 'JRS' }, 'priority')))
  expect(json).toContain('initial_option')
  // Sort select reflects the chosen sort.
  expect(json).toContain('Sort: Priority')
})
