import { expect, test } from 'vitest'
import { taskRef } from '../src/text.js'

test('taskRef joins company + task number as "COMPANY-N"', () => {
  expect(taskRef({ company: 'JRS', taskNum: '43' })).toBe('JRS-43')
  expect(taskRef({ company: 'Brightly', taskNum: '7' })).toBe('Brightly-7')
})
