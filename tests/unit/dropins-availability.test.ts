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

  it('excludes part-time child who does not attend on the day', () => {
    // c1 attends M/W/Th only; Apr 1 2026 is Wednesday so they attend
    // c2 attends M/T/W only; Apr 1 is Wednesday so they also attend
    // With 2 enrolled attending and 1 absent (but c1 is the absent one leaving 1 attending)
    // Check that days_of_week filtering works: c3 attends T/Th/Fr only (not Wednesday)
    const slots = getAvailableDropinSlots({
      year: 2026, month: 4,
      classes: [{ id: 'cls-daisy', name: 'Daisy', student_teacher_ratio: 3 }],
      childrenByClass: { 'cls-daisy': [
        { id: 'c1', days_of_week: ['M', 'W', 'Th'] },   // attends Wed Apr 1
        { id: 'c2', days_of_week: ['M', 'W', 'Th'] },   // attends Wed Apr 1
        { id: 'c3', days_of_week: ['T', 'Th', 'Fr'] },  // does NOT attend Wed Apr 1
      ]},
      absencesByClass: { 'cls-daisy': [{ child_id: 'c1', date: '2026-04-01' }] },
      approvedDropinsByClass: {},
      holidayDates: new Set<string>(),
    })
    // c1 and c2 attend on Apr 1 (Wed), but c1 is absent → 1 attending
    // c3 does not attend on Wed → not counted
    // With 1 attending and ratio 3: parentsNeeded = ceil(1/3)-1 = 0, floored to 1
    // Adding dropin: 2 attending → parentsNeeded = ceil(2/3)-1 = 0, floored to 1 → no change → slot available
    expect(slots.some(s => s.date === '2026-04-01' && s.classId === 'cls-daisy')).toBe(true)
  })

  it('honours existingDropinCount from approvedDropinsByClass', () => {
    // 6 enrolled, 1 absent = 5 attending regular, ratio 3
    // 1 existing dropin → currentAttending = 6 → parentsNeeded = ceil(6/3)-1 = 1
    // Adding 1 more dropin → 7 attending → parentsNeeded = ceil(7/3)-1 = 2 → INCREASE → no slot
    const slots = getAvailableDropinSlots({
      year: 2026, month: 4,
      classes: [{ id: 'cls-daisy', name: 'Daisy', student_teacher_ratio: 3 }],
      childrenByClass: { 'cls-daisy': [
        { id: 'c1', days_of_week: null },
        { id: 'c2', days_of_week: null },
        { id: 'c3', days_of_week: null },
        { id: 'c4', days_of_week: null },
        { id: 'c5', days_of_week: null },
        { id: 'c6', days_of_week: null },
      ]},
      absencesByClass: { 'cls-daisy': [{ child_id: 'c1', date: '2026-04-01' }] },
      approvedDropinsByClass: { 'cls-daisy': { '2026-04-01': 1 } }, // 1 already approved → currentAttending = 6
      holidayDates: new Set<string>(),
    })
    expect(slots.some(s => s.date === '2026-04-01' && s.classId === 'cls-daisy')).toBe(false)
  })
})
