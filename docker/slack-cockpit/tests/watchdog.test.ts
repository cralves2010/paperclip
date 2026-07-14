import { expect, test } from 'vitest'
import { socketDownTooLong } from '../src/watchdog.js'

const S = 1000

test('socketDownTooLong: a healthy link (downSince null) never exits', () => {
  expect(socketDownTooLong(null, 1_000_000, 120 * S)).toBe(false)
})

test('socketDownTooLong: a just-registered disconnect does not exit immediately', () => {
  const now = 1_000_000
  expect(socketDownTooLong(now, now, 120 * S)).toBe(false)
})

test('socketDownTooLong: under grace keeps running; at/over grace exits', () => {
  const now = 1_000_000
  expect(socketDownTooLong(now - 119 * S, now, 120 * S)).toBe(false)
  expect(socketDownTooLong(now - 120 * S, now, 120 * S)).toBe(true)
  expect(socketDownTooLong(now - 600 * S, now, 120 * S)).toBe(true)
})
