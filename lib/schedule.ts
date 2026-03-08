/**
 * Schedule proposal algorithm.
 *
 * When admin triggers "Propose Schedule" for a month, this function:
 *  1. Finds all valid school days (excludes holidays + weekends)
 *  2. For each school day, calculates attending students per class
 *  3. For each class per day, calculates the volunteer slot count (parents_needed)
 *  4. Calculates each family's required shift count for the month
 *  5. Filters to families that submitted availability
 *  6. Greedily assigns families to slots, distributing load evenly
 *  7. Respects conflict pairs — tries to avoid, but flags rather than hard-blocks
 *
 * Pure function — no database calls. All data is passed in.
 * Output is a DRAFT; admin reviews and edits before publishing.
 */

import { getParentsNeeded, getAttendingStudentCount } from './ratios'
import { getRequiredShifts } from './shifts'
import { getSchoolDaysInMonth } from './dropins'
import type {
  ChildRow,
  ClassRow,
  FamilyRow,
  FamilyConflictRow,
  AvailabilityRow,
  PlannedAbsence,
} from './types'

export interface ProposedShift {
  date: string // ISO date (YYYY-MM-DD)
  class_id: string
  family_id: string
  /** True if this assignment pairs two conflict-flagged families on the same day */
  conflict_warning: boolean
}

export interface ScheduleProposalInput {
  year: number
  month: number // 1-based (1 = January)
  classes: ClassRow[]
  /** All enrolled children (used to determine coverage needs and absence lookup) */
  children: ChildRow[]
  /** All families to consider for scheduling */
  families: FamilyRow[]
  /** Availability submissions for this month */
  availability: AvailabilityRow[]
  /** Conflict pairs — both directions are implied by each row */
  conflicts: FamilyConflictRow[]
  /** Holiday dates as a Set of YYYY-MM-DD strings */
  holidayDates: Set<string>
  /**
   * Already-approved drop-in counts keyed by `${class_id}:${date}`.
   * Used when re-proposing after drop-ins have been approved.
   */
  dropinCounts?: Record<string, number>
}

export interface ScheduleProposalResult {
  shifts: ProposedShift[]
  /** Family IDs that submitted availability but could not be fully scheduled */
  unmetFamilies: string[]
  /** Slots where no eligible family was available */
  unfilledSlots: {
    date: string
    class_id: string
    needed: number
    assigned: number
  }[]
}

/**
 * Proposes a draft monthly schedule.
 * Returns a ScheduleProposalResult that the admin reviews before publishing.
 */
export function proposeSchedule(input: ScheduleProposalInput): ScheduleProposalResult {
  const {
    year,
    month,
    classes,
    children,
    families,
    availability,
    conflicts,
    holidayDates,
    dropinCounts = {},
  } = input

  // ── 1. Valid school days ──────────────────────────────────────────────────────
  const schoolDays = getSchoolDaysInMonth(year, month, holidayDates)

  // ── 2. Conflict map: family_id → Set of conflicting family_ids ───────────────
  const conflictMap = new Map<string, Set<string>>()
  for (const c of conflicts) {
    if (!conflictMap.has(c.family_a_id)) conflictMap.set(c.family_a_id, new Set())
    if (!conflictMap.has(c.family_b_id)) conflictMap.set(c.family_b_id, new Set())
    conflictMap.get(c.family_a_id)!.add(c.family_b_id)
    conflictMap.get(c.family_b_id)!.add(c.family_a_id)
  }

  // ── 3. Availability map: family_id → Set of available dates ──────────────────
  const availMap = new Map<string, Set<string>>()
  for (const avail of availability) {
    availMap.set(avail.family_id, new Set(avail.available_dates))
  }

  // ── 3b. Preferred dates map: family_id → Set of preferred dates ───────────────
  const preferredMap = new Map<string, Set<string>>()
  for (const avail of availability) {
    if (avail.preferred_dates?.length) {
      preferredMap.set(avail.family_id, new Set(avail.preferred_dates))
    }
  }

  // ── 4. Planned absence map: `${class_id}:${date}` → absent child IDs ─────────
  const absenceMap = new Map<string, string[]>()
  for (const avail of availability) {
    for (const absence of avail.planned_absences as PlannedAbsence[]) {
      const child = children.find(c => c.id === absence.child_id)
      if (!child) continue
      const key = `${child.class_id}:${absence.date}`
      if (!absenceMap.has(key)) absenceMap.set(key, [])
      absenceMap.get(key)!.push(absence.child_id)
    }
  }

  // ── 5. Required shifts per family ─────────────────────────────────────────────
  // Group children by family
  const familyChildren = new Map<string, ChildRow[]>()
  for (const child of children) {
    if (!familyChildren.has(child.family_id)) familyChildren.set(child.family_id, [])
    familyChildren.get(child.family_id)!.push(child)
  }

  // Only schedule families that submitted availability this month
  const schedulableFamilies = families.filter(f => availMap.has(f.id))

  const requiredShifts = new Map<string, number>()
  for (const family of schedulableFamilies) {
    const kids = familyChildren.get(family.id) ?? []
    const req = getRequiredShifts(family, kids)
    if (req !== null && req > 0) requiredShifts.set(family.id, req)
  }

  // ── 6. Greedy assignment ───────────────────────────────────────────────────────
  // Track state across all days
  const assignedCount = new Map<string, number>() // family_id → shifts assigned so far
  const assignedDates = new Map<string, Set<string>>() // family_id → dates already assigned

  const resultShifts: ProposedShift[] = []
  const unfilledSlots: ScheduleProposalResult['unfilledSlots'] = []

  for (const date of schoolDays) {
    // Track who gets assigned on this date — needed to detect conflict pairs
    const assignedOnThisDate: string[] = []

    for (const cls of classes) {
      // Calculate how many volunteers are needed for this class on this date
      const enrolledInClass = children
        .filter(c => c.class_id === cls.id)
        .map(c => c.id)
      const absentChildIds = absenceMap.get(`${cls.id}:${date}`) ?? []
      const dropinCount = dropinCounts[`${cls.id}:${date}`] ?? 0
      const attending = getAttendingStudentCount(enrolledInClass, absentChildIds, dropinCount)
      const needed = getParentsNeeded(attending, cls.student_teacher_ratio)

      let assigned = 0

      for (let slot = 0; slot < needed; slot++) {
        // Build candidate list: available on this date, still has quota remaining,
        // not already assigned on this date
        const candidates = schedulableFamilies
          .filter(f => {
            if (!availMap.get(f.id)?.has(date)) return false
            const req = requiredShifts.get(f.id) ?? 0
            if ((assignedCount.get(f.id) ?? 0) >= req) return false
            if (assignedDates.get(f.id)?.has(date)) return false
            return true
          })
          .sort((a, b) => {
            // 1. Slack ascending — most constrained family first
            //    slack = available_days - required_shifts
            const slackA = (availMap.get(a.id)?.size ?? 0) - (requiredShifts.get(a.id) ?? 0)
            const slackB = (availMap.get(b.id)?.size ?? 0) - (requiredShifts.get(b.id) ?? 0)
            if (slackA !== slackB) return slackA - slackB

            // 2. Required remaining descending — more shifts owed = higher priority
            const remainA = (requiredShifts.get(a.id) ?? 0) - (assignedCount.get(a.id) ?? 0)
            const remainB = (requiredShifts.get(b.id) ?? 0) - (assignedCount.get(b.id) ?? 0)
            if (remainA !== remainB) return remainB - remainA

            // 3. Preferred date tiebreaker
            const aPref = preferredMap.get(a.id)?.has(date) ? 1 : 0
            const bPref = preferredMap.get(b.id)?.has(date) ? 1 : 0
            return bPref - aPref
          })

        if (candidates.length === 0) break

        // Prefer a non-conflicting candidate; fall back to any candidate if needed
        const conflictFree = candidates.filter(f => {
          const fConflicts = conflictMap.get(f.id) ?? new Set<string>()
          return !assignedOnThisDate.some(otherId => fConflicts.has(otherId))
        })

        const pick = conflictFree[0] ?? candidates[0]

        // Determine if this assignment triggers a conflict warning
        const pickConflicts = conflictMap.get(pick.id) ?? new Set<string>()
        const hasConflict = assignedOnThisDate.some(otherId => pickConflicts.has(otherId))

        resultShifts.push({
          date,
          class_id: cls.id,
          family_id: pick.id,
          conflict_warning: hasConflict,
        })

        // Update tracking state
        assignedOnThisDate.push(pick.id)
        assignedCount.set(pick.id, (assignedCount.get(pick.id) ?? 0) + 1)
        if (!assignedDates.has(pick.id)) assignedDates.set(pick.id, new Set())
        assignedDates.get(pick.id)!.add(date)

        assigned++
      }

      if (assigned < needed) {
        unfilledSlots.push({ date, class_id: cls.id, needed, assigned })
      }
    }
  }

  // ── 7. Families that didn't get their full quota ───────────────────────────────
  const unmetFamilies: string[] = []
  for (const [familyId, req] of Array.from(requiredShifts)) {
    if ((assignedCount.get(familyId) ?? 0) < req) {
      unmetFamilies.push(familyId)
    }
  }

  return { shifts: resultShifts, unmetFamilies, unfilledSlots }
}
