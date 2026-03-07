// tests/unit/dropins-availability.test.ts
import { describe, it, expect } from 'vitest'
import { getAvailableDropinSlots } from '@/lib/dropins'

describe('getAvailableDropinSlots', () => {
  const holidays = new Set<string>()

  it('returns a slot when a child is absent and ratio allows it', () => {
    const slots = getAvailableDropinSlots({
      year: 2026, month: 4,
      classes: [{ id: 'cls-daisy', name: 'Daisy', student_teacher_ratio: 3 }],
      childrenByClass: { 'cls-daisy': [
        { id: 'c1', days_of_week: null },
        { id: 'c2', days_of_week: null },
        { id: 'c3', days_of_week: null },
      ]},
      absencesByClass: { 'cls-daisy': [{ child_id: 'c1', date: '2026-04-01' }] },
      approvedDropinsByClass: {},
      holidayDates: holidays,
    })
    // Apr 1 2026 is a Wednesday — valid school day
    // 3 enrolled, 1 absent = 2 attending, ratio 3 → parentsNeeded = ceil(2/3)-1 = 0, floored to 1
    // Adding 1 dropin → 3 attending → parentsNeeded = ceil(3/3)-1 = 0, floored to 1 → no change → slot available
    expect(slots.some(s => s.date === '2026-04-01' && s.classId === 'cls-daisy')).toBe(true)
  })

  it('does not return a slot on a weekend', () => {
    const slots = getAvailableDropinSlots({
      year: 2026, month: 4,
      classes: [{ id: 'cls-daisy', name: 'Daisy', student_teacher_ratio: 3 }],
      childrenByClass: { 'cls-daisy': [{ id: 'c1', days_of_week: null }] },
      absencesByClass: { 'cls-daisy': [{ child_id: 'c1', date: '2026-04-04' }] }, // Saturday
      approvedDropinsByClass: {},
      holidayDates: holidays,
    })
    expect(slots.some(s => s.date === '2026-04-04')).toBe(false)
  })

  it('does not return a slot when no absences exist', () => {
    const slots = getAvailableDropinSlots({
      year: 2026, month: 4,
      classes: [{ id: 'cls-daisy', name: 'Daisy', student_teacher_ratio: 3 }],
      childrenByClass: { 'cls-daisy': [{ id: 'c1', days_of_week: null }] },
      absencesByClass: {},
      approvedDropinsByClass: {},
      holidayDates: holidays,
    })
    expect(slots.length).toBe(0)
  })
})
