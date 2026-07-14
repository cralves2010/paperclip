import { expect, test } from 'vitest'
import { buildPrivateView, isAllowed } from '../src/allowlist.js'

test('isAllowed matches exact user ids only', () => {
  expect(isAllowed('U1', ['U1', 'U2'])).toBe(true)
  expect(isAllowed('U9', ['U1', 'U2'])).toBe(false)
})

test('private view is a home view with no task data', () => {
  const v = buildPrivateView()
  expect(v.type).toBe('home')
  expect(JSON.stringify(v).toLowerCase()).toContain('private')
})
