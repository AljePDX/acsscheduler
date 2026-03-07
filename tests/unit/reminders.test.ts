import { describe, it, expect } from 'vitest'

// ── Helper (mirrors logic in admin dashboard page) ────────────────────────────

function getNextMonthStart(currentDate: Date): string {
  const nm = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)
  return `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}-01`
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getNextMonthStart', () => {
  it('returns next month from January', () => {
    expect(getNextMonthStart(new Date('2026-01-15'))).toBe('2026-02-01')
  })

  it('returns next month from March (current month in this project)', () => {
    expect(getNextMonthStart(new Date('2026-03-05'))).toBe('2026-04-01')
  })

  it('handles December → January year rollover', () => {
    expect(getNextMonthStart(new Date('2026-12-10'))).toBe('2027-01-01')
  })

  it('handles end of month (last day)', () => {
    expect(getNextMonthStart(new Date('2026-03-31'))).toBe('2026-04-01')
  })

  it('always returns the 1st of the month', () => {
    const result = getNextMonthStart(new Date('2026-06-15'))
    expect(result.endsWith('-01')).toBe(true)
  })

  it('produces YYYY-MM-01 format', () => {
    const result = getNextMonthStart(new Date('2026-09-01'))
    expect(result).toMatch(/^\d{4}-\d{2}-01$/)
  })
})
