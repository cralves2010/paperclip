import { expect, test } from 'vitest'
import {
  distinctBusinesses,
  distinctPriorities,
  filterTasks,
  paginate,
  parsePriorityRank,
  sortTasks,
} from '../src/filters.js'
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

test('filterTasks: business exact', () => {
  const tasks = [t({ company: 'JRS' }), t({ company: 'Brightly' })]
  expect(filterTasks(tasks, { business: 'JRS' })).toHaveLength(1)
})

test('filterTasks: status open hides done, all keeps all, canonical matches', () => {
  const tasks = [t({ status: 'in_progress' }), t({ status: 'done' }), t({ status: 'blocked' })]
  expect(filterTasks(tasks, { status: 'open' })).toHaveLength(2)
  expect(filterTasks(tasks, { status: 'all' })).toHaveLength(3)
  expect(filterTasks(tasks, { status: 'blocked' })).toHaveLength(1)
})

test('filterTasks: priority exact', () => {
  const tasks = [t({ priority: 'P0' }), t({ priority: 'P1' }), t({ priority: undefined })]
  expect(filterTasks(tasks, { priority: 'P0' })).toHaveLength(1)
})

test('sortTasks: updated desc, undefined timestamp last', () => {
  const tasks = [
    t({ taskNum: '1', lastUpdatedTs: 100 }),
    t({ taskNum: '2', lastUpdatedTs: undefined }),
    t({ taskNum: '3', lastUpdatedTs: 300 }),
  ]
  expect(sortTasks(tasks, 'updated').map((x) => x.taskNum)).toEqual(['3', '1', '2'])
})

test('sortTasks: priority natural so P0<P1<P10, undefined last', () => {
  const tasks = [
    t({ taskNum: '1', priority: 'P10' }),
    t({ taskNum: '2', priority: 'P1' }),
    t({ taskNum: '3', priority: undefined }),
    t({ taskNum: '4', priority: 'P0' }),
  ]
  expect(sortTasks(tasks, 'priority').map((x) => x.taskNum)).toEqual(['4', '2', '1', '3'])
})

test('sortTasks: task_num numeric asc; ties broken by numeric taskNum', () => {
  const tasks = [t({ taskNum: '10' }), t({ taskNum: '2' }), t({ taskNum: '1' })]
  expect(sortTasks(tasks, 'task_num').map((x) => x.taskNum)).toEqual(['1', '2', '10'])
})

test('sortTasks: equal primary keys break tie by numeric taskNum', () => {
  const tasks = [
    t({ taskNum: '9', lastUpdatedTs: 500 }),
    t({ taskNum: '3', lastUpdatedTs: 500 }),
  ]
  expect(sortTasks(tasks, 'updated').map((x) => x.taskNum)).toEqual(['3', '9'])
})

test('parsePriorityRank handles P-form, Tier-form, undefined', () => {
  expect(parsePriorityRank('P0')).toBe(0)
  expect(parsePriorityRank('Tier 2')).toBe(2)
  expect(parsePriorityRank(undefined)).toBe(Number.POSITIVE_INFINITY)
  expect(parsePriorityRank('no digits')).toBe(Number.POSITIVE_INFINITY)
})

test('paginate: page math + out-of-range clamp', () => {
  const items = Array.from({ length: 45 }, (_, i) => i)
  const p0 = paginate(items, 0, 20)
  expect(p0.slice).toHaveLength(20)
  expect(p0.pageCount).toBe(3)
  expect(p0.from).toBe(1)
  expect(p0.to).toBe(20)

  const p2 = paginate(items, 2, 20)
  expect(p2.slice).toHaveLength(5)
  expect(p2.from).toBe(41)
  expect(p2.to).toBe(45)

  const over = paginate(items, 99, 20)
  expect(over.page).toBe(2) // clamped to last page
  expect(over.slice).toHaveLength(5)

  const empty = paginate([], 0, 20)
  expect(empty.pageCount).toBe(1)
  expect(empty.from).toBe(0)
  expect(empty.to).toBe(0)
  expect(empty.total).toBe(0)
})

test('distinctBusinesses / distinctPriorities sorted + deduped', () => {
  const tasks = [
    t({ company: 'JRS', priority: 'P1' }),
    t({ company: 'Brightly', priority: 'P0' }),
    t({ company: 'JRS', priority: 'P1' }),
    t({ company: 'M42', priority: undefined }),
  ]
  expect(distinctBusinesses(tasks)).toEqual(['Brightly', 'JRS', 'M42'])
  expect(distinctPriorities(tasks)).toEqual(['P0', 'P1'])
})
