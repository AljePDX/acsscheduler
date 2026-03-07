/**
 * Drop-in slot availability logic.
 *
 * A drop-in slot is available for a class on a date when ALL of the following are true:
 *  1. It is a valid school day (not a holiday, not a weekend)
 *  2. At least one enrolled child has a planned absence in that class on that day
 *  3. Adding one drop-in child would NOT increase the parents_needed count
 *     (i.e. the attending + 1 stays within the same ratio bracket)
 *  4. The date has not already reached its drop-in capacity
 *     (caller passes existingDropinCount; this function checks condition 3 inclusive of it)
 */

import { getParentsNeeded } from './ratios'

/** ISO date string (YYYY-MM-DD) */
type ISODate = string

export interface DropinAvailabilityInput {
  date: ISODate
  /** IDs of all students enrolled in this class who attend on this day of week */
  enrolledStudentIds: string[]
  /** IDs of children (in this class) with a planned absence on this date */
  plannedAbsenceChildIds: string[]
  /** Number of drop-ins already approved for this class on this date */
  existingDropinCount: number
  /** The class student:teacher ratio */
  ratio: number
  /** Set of holiday date strings (YYYY-MM-DD) */
  holidayDates: Set<ISODate>
}

/**
 * Returns whether a drop-in slot is available for a class on a given date.
 * Checks all four conditions defined in the spec.
 */
export function isDropinAvailable(input: DropinAvailabilityInput): boolean {
  const {
    date,
    enrolledStudentIds,
    plannedAbsenceChildIds,
    existingDropinCount,
    ratio,
    holidayDates,
  } = input

  // 1. Must be a valid school day
  if (!isSchoolDay(date, holidayDates)) return false

  // 2. At least one enrolled child in this class must have a planned absence on this date
  const absenceSet = new Set(plannedAbsenceChildIds)
  const hasAbsenceInClass = enrolledStudentIds.some(id => absenceSet.has(id))
  if (!hasAbsenceInClass) return false

  // 3. Adding one more drop-in must NOT increase parents_needed
  const currentAttending =
    enrolledStudentIds.filter(id => !absenceSet.has(id)).length + existingDropinCount
  const parentsNeededBefore = getParentsNeeded(currentAttending, ratio)
  const parentsNeededAfter = getParentsNeeded(currentAttending + 1, ratio)
  if (parentsNeededAfter > parentsNeededBefore) return false

  return true
}

/**
 * Returns whether a date is a valid school day (not a weekend, not a holiday).
 *
 * @param date - ISO date string (YYYY-MM-DD)
 * @param holidayDates - Set of holiday date strings
 */
export function isSchoolDay(date: ISODate, holidayDates: Set<ISODate>): boolean {
  if (holidayDates.has(date)) return false
  // Parse as local date to avoid UTC-offset day-of-week errors
  const d = new Date(date + 'T00:00:00')
  const dow = d.getDay()
  return dow !== 0 && dow !== 6 // 0 = Sunday, 6 = Saturday
}

/**
 * Returns all valid school days in a given month (excludes weekends and holidays).
 *
 * @param year - Full year (e.g. 2026)
 * @param month - 1-based month number (1 = January, 12 = December)
 * @param holidayDates - Set of holiday date strings in YYYY-MM-DD format
 */
export function getSchoolDaysInMonth(
  year: number,
  month: number,
  holidayDates: Set<ISODate>
): ISODate[] {
  const days: ISODate[] = []
  // Using day 0 of next month gives last day of current month
  const lastDay = new Date(year, month, 0).getDate()
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (isSchoolDay(dateStr, holidayDates)) {
      days.push(dateStr)
    }
  }
  return days
}

export interface DropinSlot {
  date: string
  classId: string
  className: string
}

export interface DropinSlotsInput {
  year: number
  month: number
  classes: { id: string; name: string; student_teacher_ratio: number }[]
  /** Map of classId → enrolled children (with days_of_week for filtering) */
  childrenByClass: Record<string, { id: string; days_of_week: string[] | null }[]>
  /** Map of classId → { child_id, date } absences for this month */
  absencesByClass: Record<string, { child_id: string; date: string }[]>
  /** Map of classId → count of approved drop-ins keyed by date */
  approvedDropinsByClass: Record<string, Record<string, number>>
  holidayDates: Set<string>
}

/**
 * Returns all available drop-in slots for every class in the given month.
 * A slot is available if isDropinAvailable() returns true for that class+date.
 */
export function getAvailableDropinSlots(input: DropinSlotsInput): DropinSlot[] {
  const { year, month, classes, childrenByClass, absencesByClass, approvedDropinsByClass, holidayDates } = input
  const schoolDays = getSchoolDaysInMonth(year, month, holidayDates)
  const slots: DropinSlot[] = []

  for (const cls of classes) {
    const enrolled = childrenByClass[cls.id] ?? []
    const absences = absencesByClass[cls.id] ?? []
    const absencesByDate = new Map<string, string[]>()
    for (const a of absences) {
      const list = absencesByDate.get(a.date) ?? []
      list.push(a.child_id)
      absencesByDate.set(a.date, list)
    }
    const dropinCounts = approvedDropinsByClass[cls.id] ?? {}

    for (const date of schoolDays) {
      const dow = new Date(date + 'T00:00:00').getDay() // 0=Sun
      // Filter enrolled children attending on this day of week
      const attendingEnrolled = enrolled.filter(c => {
        if (!c.days_of_week) return dow >= 1 && dow <= 5 // null = all weekdays
        const DAY_ABBRS = ['', 'M', 'T', 'W', 'Th', 'Fr']
        return c.days_of_week.includes(DAY_ABBRS[dow] ?? '')
      })

      const available = isDropinAvailable({
        date,
        enrolledStudentIds: attendingEnrolled.map(c => c.id),
        plannedAbsenceChildIds: absencesByDate.get(date) ?? [],
        existingDropinCount: dropinCounts[date] ?? 0,
        ratio: cls.student_teacher_ratio,
        holidayDates,
      })

      if (available) slots.push({ date, classId: cls.id, className: cls.name })
    }
  }

  return slots
}
