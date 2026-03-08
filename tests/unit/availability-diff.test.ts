import { describe, it, expect } from 'vitest'
import { computeAvailabilityDiff } from '@/lib/availability-utils'

describe('computeAvailabilityDiff', () => {
  it('detects added and removed dates', () => {
    const diff = computeAvailabilityDiff(
      { availableDates: ['2026-04-01', '2026-04-02'], absences: [] },
      { availableDates: ['2026-04-02', '2026-04-03'], absences: [] }
    )
    expect(diff.addedDates).toEqual(['2026-04-03'])
    expect(diff.removedDates).toEqual(['2026-04-01'])
  })

  it('detects added and removed absences', () => {
    const diff = computeAvailabilityDiff(
      { availableDates: [], absences: [{ child_id: 'c1', date: '2026-04-05' }] },
      { availableDates: [], absences: [{ child_id: 'c1', date: '2026-04-07' }] }
    )
    expect(diff.addedAbsences).toBe(1)
    expect(diff.removedAbsences).toBe(1)
  })

  it('returns isEmpty=true when nothing changed', () => {
    const diff = computeAvailabilityDiff(
      { availableDates: ['2026-04-01'], absences: [] },
      { availableDates: ['2026-04-01'], absences: [] }
    )
    expect(diff.isEmpty).toBe(true)
  })
})
