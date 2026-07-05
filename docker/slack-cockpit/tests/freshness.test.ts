import { expect, test } from 'vitest'
import { freshnessDot, liveProvenance, relativeAge } from '../src/text.js'

const M = 60_000

test('freshnessDot: 🟢 <30m · 🟡 30–60m · 🔴 ≥60m', () => {
  expect(freshnessDot(0)).toBe('🟢')
  expect(freshnessDot(29 * M)).toBe('🟢')
  expect(freshnessDot(30 * M)).toBe('🟡')
  expect(freshnessDot(59 * M)).toBe('🟡')
  expect(freshnessDot(60 * M)).toBe('🔴')
  expect(freshnessDot(300 * M)).toBe('🔴')
})

test('relativeAge: "just now" under 1m, then Xm / Xh Ym ago', () => {
  expect(relativeAge(0)).toBe('just now')
  expect(relativeAge(59_000)).toBe('just now')
  expect(relativeAge(1 * M)).toBe('1m ago')
  expect(relativeAge(45 * M)).toBe('45m ago')
  expect(relativeAge(60 * M)).toBe('1h ago')
  expect(relativeAge(80 * M)).toBe('1h 20m ago')
})

test('liveProvenance: fresh → 🟢 + "Last synced"; stale → 🔴 (tracker-unreachable signal)', () => {
  const now = 1_700_000_000_000
  const fresh = liveProvenance(now - 1 * M, now)
  expect(fresh).toContain('🟢')
  expect(fresh).toContain('Last synced')
  expect(fresh).toContain('1m ago')
  expect(fresh).not.toContain('synced just now')
  expect(fresh).not.toContain('*LIVE*')

  expect(liveProvenance(now - 40 * M, now)).toContain('🟡')

  const stale = liveProvenance(now - 130 * M, now)
  expect(stale).toContain('🔴')
  expect(stale).toContain('2h 10m ago')
})
