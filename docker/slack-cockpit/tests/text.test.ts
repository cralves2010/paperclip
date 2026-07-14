import { expect, test } from 'vitest'
import { coarseAge, taskRef } from '../src/text.js'

test('taskRef joins company + task number as "COMPANY-N"', () => {
  expect(taskRef({ company: 'JRS', taskNum: '43' })).toBe('JRS-43')
  expect(taskRef({ company: 'Brightly', taskNum: '7' })).toBe('Brightly-7')
})

test('coarseAge drops minute precision: just now / Xh ago / yesterday / N days ago', () => {
  const MIN = 60_000
  expect(coarseAge(5 * MIN)).toBe('just now') // < 1h
  expect(coarseAge(59 * MIN)).toBe('just now')
  expect(coarseAge(3 * 60 * MIN)).toBe('3h ago') // 3h, no minutes
  expect(coarseAge((26 * 60 + 24) * MIN)).toBe('yesterday') // the "26h 24m ago" case
  expect(coarseAge(3 * 24 * 60 * MIN)).toBe('3 days ago')
  expect(coarseAge(-100)).toBe('just now') // clamps negative
})
