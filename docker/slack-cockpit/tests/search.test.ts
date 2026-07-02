import { expect, test } from 'vitest'
import { searchTasks } from '../src/views/search.js'
import type { Task } from '../src/model.js'

const t = (o: Partial<Task>): Task => ({
  taskNum: '1',
  company: 'JRS',
  title: 'x',
  owner: 'a',
  status: 'in_progress',
  rawStatus: '',
  ...o,
})

test('searchTasks matches title / description / deliverable, case-insensitive', () => {
  const tasks = [
    t({ taskNum: '1', title: 'School contacts' }),
    t({ taskNum: '2', title: 'Testimonials', description: 'storyteller reviews' }),
    t({ taskNum: '3', title: 'Amazon', deliverableTitle: 'Listing sheet' }),
  ]
  expect(searchTasks(tasks, 'school').map((x) => x.taskNum)).toEqual(['1'])
  expect(searchTasks(tasks, 'STORYTELLER').map((x) => x.taskNum)).toEqual(['2'])
  expect(searchTasks(tasks, 'listing').map((x) => x.taskNum)).toEqual(['3'])
  expect(searchTasks(tasks, '')).toEqual([])
})
