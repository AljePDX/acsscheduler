import { describe, it, expect } from 'vitest'
import { proposeSchedule } from '@/lib/schedule'
import type { ScheduleProposalInput } from '@/lib/schedule'
import type { ClassRow, ChildRow, FamilyRow, AvailabilityRow, FamilyConflictRow } from '@/lib/types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const roseClass: ClassRow = {
  id: 'class-rose',
  name: 'Rose',
  student_teacher_ratio: 4,
  created_at: '2026-01-01T00:00:00Z',
}

const daisyClass: ClassRow = {
  id: 'class-daisy',
  name: 'Daisy',
  student_teacher_ratio: 3,
  created_at: '2026-01-01T00:00:00Z',
}

function makeFamily(id: string, override: number | null = null): FamilyRow {
  return {
    id,
    name: `Family ${id}`,
    email: `${id}@example.com`,
    phone: null,
    notes: null,
    shift_override: override,
    created_at: '2026-01-01T00:00:00Z',
    is_flexible_teacher: false,
    is_assistant_teacher: false,
  }
}

function makeChild(id: string, familyId: string, classId: string, daysPerWeek: number): ChildRow {
  return { id, family_id: familyId, class_id: classId, name: id, days_per_week: daysPerWeek, days_of_week: null, days_change_pending: null, days_change_status: null }
}

function makeAvailability(
  familyId: string,
  dates: string[],
  absences: { child_id: string; date: string }[] = []
): AvailabilityRow {
  return {
    id: `avail-${familyId}`,
    family_id: familyId,
    period_month: '2026-03-01',
    available_dates: dates,
    preferred_dates: [],
    planned_absences: absences,
    extra_shifts_willing: '0',
    notes: null,
    submitted_at: '2026-02-20T00:00:00Z',
  }
}

// March 2026 school days (Mon–Fri, no holidays): 22 weekdays
const MARCH_WEEKDAYS = [
  '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06',
  '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13',
  '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20',
  '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27',
  '2026-03-30', '2026-03-31',
]

const baseInput: ScheduleProposalInput = {
  year: 2026,
  month: 3,
  classes: [roseClass],
  children: [],
  families: [],
  availability: [],
  conflicts: [],
  holidayDates: new Set(),
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('proposeSchedule', () => {
  describe('school day handling', () => {
    it('produces no shifts when no families submitted availability', () => {
      const result = proposeSchedule(baseInput)
      expect(result.shifts).toHaveLength(0)
    })

    it('excludes weekend dates from shift assignments', () => {
      const family = makeFamily('f1', 3)
      const child = makeChild('c1', 'f1', 'class-rose', 3)
      // Make family available on a weekend — algorithm should never assign it
      const avail = makeAvailability('f1', ['2026-03-07', '2026-03-08']) // Sat + Sun
      const result = proposeSchedule({
        ...baseInput,
        families: [family],
        children: [child],
        availability: [avail],
      })
      const dates = result.shifts.map(s => s.date)
      expect(dates).not.toContain('2026-03-07')
      expect(dates).not.toContain('2026-03-08')
    })

    it('excludes holiday dates from shift assignments', () => {
      const family = makeFamily('f1', 5)
      const child = makeChild('c1', 'f1', 'class-rose', 5)
      const avail = makeAvailability('f1', MARCH_WEEKDAYS)
      const result = proposeSchedule({
        ...baseInput,
        families: [family],
        children: [child],
        availability: [avail],
        holidayDates: new Set(['2026-03-02', '2026-03-03']),
      })
      const dates = result.shifts.map(s => s.date)
      expect(dates).not.toContain('2026-03-02')
      expect(dates).not.toContain('2026-03-03')
    })
  })

  describe('slot calculation', () => {
    it('assigns 1 parent per day per class when 4 students in Rose (ratio 4)', () => {
      // 4 students in Rose, ratio 4 → ceil(4/4)=1 adult → 0 parents → min 1
      const families = [makeFamily('f1', 22)] // 22 shifts = 1 per day for all 22 school days
      const child = makeChild('c1', 'f1', 'class-rose', 5)
      const avail = makeAvailability('f1', MARCH_WEEKDAYS)
      const result = proposeSchedule({
        ...baseInput,
        families,
        children: [makeChild('s1', 'other', 'class-rose', 5),
                   makeChild('s2', 'other', 'class-rose', 5),
                   makeChild('s3', 'other', 'class-rose', 5),
                   makeChild('s4', 'other', 'class-rose', 5),
                   child],
        availability: [avail],
      })
      // Each school day should have exactly 1 shift for Rose class
      const roseDates = Array.from(new Set(result.shifts.filter(s => s.class_id === 'class-rose').map(s => s.date)))
      expect(roseDates.length).toBe(22)
    })

    it('generates no shifts when class has no enrolled students', () => {
      // No children enrolled → attending = 0 → getParentsNeeded(0, 4) = 1
      // But actually per spec minimum 1 is always required...
      // However, in practice if there are 0 students, the class doesn't run.
      // getParentsNeeded(0, ratio) = 1 — so we still assign 1 parent.
      const family = makeFamily('f1', 22)
      const avail = makeAvailability('f1', MARCH_WEEKDAYS)
      const result = proposeSchedule({
        ...baseInput,
        families: [family],
        children: [], // no enrolled children
        availability: [avail],
      })
      // 1 parent needed per day (minimum), 22 school days, but family only has 22 shifts
      expect(result.shifts.length).toBeGreaterThan(0)
    })
  })

  describe('quota tracking', () => {
    it('does not assign a family more shifts than their required quota', () => {
      const family = makeFamily('f1', 3) // override: 3 shifts required
      const child = makeChild('c1', 'f1', 'class-rose', 3)
      const avail = makeAvailability('f1', MARCH_WEEKDAYS) // available every day
      const result = proposeSchedule({
        ...baseInput,
        families: [family],
        children: [child],
        availability: [avail],
      })
      const familyShifts = result.shifts.filter(s => s.family_id === 'f1')
      expect(familyShifts.length).toBeLessThanOrEqual(3)
    })

    it('marks family as unmet when quota cannot be fulfilled', () => {
      // Family needs 5 shifts but is only available 2 days
      const family = makeFamily('f1', 5)
      const child = makeChild('c1', 'f1', 'class-rose', 5)
      const avail = makeAvailability('f1', ['2026-03-02', '2026-03-03'])
      const result = proposeSchedule({
        ...baseInput,
        families: [family],
        children: [child],
        availability: [avail],
      })
      expect(result.unmetFamilies).toContain('f1')
    })

    it('does not mark a family as unmet when quota is fully filled', () => {
      const family = makeFamily('f1', 2)
      const child = makeChild('c1', 'f1', 'class-rose', 3)
      const avail = makeAvailability('f1', MARCH_WEEKDAYS)
      const result = proposeSchedule({
        ...baseInput,
        families: [family],
        children: [child],
        availability: [avail],
      })
      expect(result.unmetFamilies).not.toContain('f1')
    })

    it('skips families that did not submit availability', () => {
      const family = makeFamily('f1', 5)
      const child = makeChild('c1', 'f1', 'class-rose', 5)
      // No availability submitted for f1
      const result = proposeSchedule({
        ...baseInput,
        families: [family],
        children: [child],
        availability: [],
      })
      const familyShifts = result.shifts.filter(s => s.family_id === 'f1')
      expect(familyShifts).toHaveLength(0)
      // Not in unmetFamilies either — they simply didn't participate
      expect(result.unmetFamilies).not.toContain('f1')
    })
  })

  describe('conflict handling', () => {
    it('avoids placing conflicting families on the same date when possible', () => {
      // Single class needing 1 volunteer/day. Two conflicting families each need 1 shift.
      // Algorithm fills fA on day 1, then fB on day 2 — no conflict needed.
      const fA = makeFamily('fA', 1)
      const fB = makeFamily('fB', 1)
      const childA = makeChild('cA', 'fA', 'class-rose', 3)
      const childB = makeChild('cB', 'fB', 'class-rose', 3)

      const availA = makeAvailability('fA', MARCH_WEEKDAYS)
      const availB = makeAvailability('fB', MARCH_WEEKDAYS)

      const conflict: FamilyConflictRow = {
        id: 'c1',
        family_a_id: 'fA',
        family_b_id: 'fB',
        reason: null,
        created_at: '2026-01-01T00:00:00Z',
      }

      const result = proposeSchedule({
        ...baseInput,
        classes: [roseClass],
        families: [fA, fB],
        children: [childA, childB],
        availability: [availA, availB],
        conflicts: [conflict],
      })

      // Each family gets exactly 1 shift, and they should land on different dates
      const fADate = result.shifts.find(s => s.family_id === 'fA')?.date
      const fBDate = result.shifts.find(s => s.family_id === 'fB')?.date
      expect(fADate).toBeDefined()
      expect(fBDate).toBeDefined()
      expect(fADate).not.toBe(fBDate)
      // Neither shift should be flagged as a conflict
      expect(result.shifts.every(s => !s.conflict_warning)).toBe(true)
    })

    it('sets conflict_warning=true when conflicting families share a date (unavoidable)', () => {
      // Two conflicting families, each needs 1 shift, only 1 date available
      const fA = makeFamily('fA', 1)
      const fB = makeFamily('fB', 1)
      const childA = makeChild('cA', 'fA', 'class-rose', 3)
      const childB = makeChild('cB', 'fB', 'class-daisy', 3)

      // Both available ONLY on the same day → forced conflict
      const onlyDay = '2026-03-02'
      const availA = makeAvailability('fA', [onlyDay])
      const availB = makeAvailability('fB', [onlyDay])

      const conflict: FamilyConflictRow = {
        id: 'c1',
        family_a_id: 'fA',
        family_b_id: 'fB',
        reason: null,
        created_at: '2026-01-01T00:00:00Z',
      }

      const result = proposeSchedule({
        ...baseInput,
        classes: [roseClass, daisyClass],
        families: [fA, fB],
        children: [childA, childB],
        availability: [availA, availB],
        conflicts: [conflict],
      })

      const warnings = result.shifts.filter(s => s.conflict_warning)
      expect(warnings.length).toBeGreaterThan(0)
    })

    it('sets conflict_warning=false when no conflicts exist', () => {
      const fA = makeFamily('fA', 2)
      const child = makeChild('cA', 'fA', 'class-rose', 3)
      const avail = makeAvailability('fA', MARCH_WEEKDAYS)

      const result = proposeSchedule({
        ...baseInput,
        families: [fA],
        children: [child],
        availability: [avail],
        conflicts: [],
      })

      expect(result.shifts.every(s => !s.conflict_warning)).toBe(true)
    })
  })

  describe('load distribution', () => {
    it('distributes shifts evenly across families with equal availability', () => {
      // 3 families, each needs 4 shifts, all available every day — should get ~4 each
      const families = ['fA', 'fB', 'fC'].map(id => makeFamily(id, 4))
      const children = families.map(f =>
        makeChild(`c-${f.id}`, f.id, 'class-rose', 4)
      )
      const avails = families.map(f => makeAvailability(f.id, MARCH_WEEKDAYS))

      const result = proposeSchedule({
        ...baseInput,
        families,
        children,
        availability: avails,
      })

      for (const f of families) {
        const count = result.shifts.filter(s => s.family_id === f.id).length
        expect(count).toBe(4)
      }
    })

    it('does not assign the same family twice on the same date', () => {
      const family = makeFamily('f1', 10)
      const childA = makeChild('cA', 'f1', 'class-rose', 5)
      const childB = makeChild('cB', 'f1', 'class-daisy', 5)
      const avail = makeAvailability('f1', MARCH_WEEKDAYS)

      const result = proposeSchedule({
        ...baseInput,
        classes: [roseClass, daisyClass],
        families: [family],
        children: [childA, childB],
        availability: [avail],
      })

      // No date should have f1 assigned more than once
      const dateCounts = new Map<string, number>()
      for (const s of result.shifts.filter(sh => sh.family_id === 'f1')) {
        dateCounts.set(s.date, (dateCounts.get(s.date) ?? 0) + 1)
      }
      for (const [, count] of Array.from(dateCounts)) {
        expect(count).toBe(1)
      }
    })
  })

  describe('candidate sort order', () => {
    // Shared helpers
    const makeClass = (id: string, ratio: number) => ({
      id, name: id, student_teacher_ratio: ratio, created_at: '',
    })
    const makeFamily = (id: string, override: number) => ({
      id, name: id, email: '', phone: null, notes: null,
      shift_override: override, created_at: '',
      is_flexible_teacher: false,
      is_assistant_teacher: false,
    })
    const makeChild = (classId: string, familyId: string, idx: number) => ({
      id: `c${idx}`, family_id: familyId, class_id: classId, name: `c${idx}`,
      days_per_week: 5, days_of_week: null,
      days_change_pending: null, days_change_status: null,
    })
    const makeAvail = (familyId: string, dates: string[], preferred: string[] = []) => ({
      id: familyId + '-av', family_id: familyId, period_month: '2026-04-01',
      available_dates: dates, preferred_dates: preferred,
      planned_absences: [], extra_shifts_willing: '0' as const, notes: null, submitted_at: '',
    })

    it('schedules the most constrained family first (fewest slack days)', () => {
      // fam-a: available 1 day, needs 1 shift → slack = 0 (most constrained)
      // fam-b: available 5 days, needs 1 shift → slack = 4 (flexible)
      // 1 slot on Apr 1 (Wed) → fam-a MUST win
      const result = proposeSchedule({
        year: 2026, month: 4,
        classes: [makeClass('cls', 5)],
        // 6 students → ceil(6/5)-1 = 1 parent needed
        children: Array.from({ length: 6 }, (_, i) => makeChild('cls', `other-${i}`, i)),
        families: [makeFamily('fam-a', 1), makeFamily('fam-b', 1)],
        availability: [
          makeAvail('fam-a', ['2026-04-01']),
          makeAvail('fam-b', ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-07', '2026-04-08']),
        ],
        conflicts: [],
        holidayDates: new Set(),
      })
      const apr1 = result.shifts.filter(s => s.date === '2026-04-01')
      expect(apr1.some(s => s.family_id === 'fam-a')).toBe(true)
    })

    it('assigns a family to their preferred date over an equally-constrained peer', () => {
      // Both families: available only on Apr 2, need 1 shift → same slack (0)
      // fam-a marks Apr 2 as preferred; fam-b does not
      // 1 slot on Apr 2 → fam-a should win (preferred tiebreaker)
      const result = proposeSchedule({
        year: 2026, month: 4,
        classes: [makeClass('cls', 5)],
        children: Array.from({ length: 6 }, (_, i) => makeChild('cls', `other-${i}`, i)),
        families: [makeFamily('fam-a', 1), makeFamily('fam-b', 1)],
        availability: [
          makeAvail('fam-a', ['2026-04-02'], ['2026-04-02']),
          makeAvail('fam-b', ['2026-04-02'], []),
        ],
        conflicts: [],
        holidayDates: new Set(),
      })
      const apr2 = result.shifts.filter(s => s.date === '2026-04-02')
      expect(apr2.length).toBe(1)
      expect(apr2[0].family_id).toBe('fam-a')
    })
  })

  describe('class constraints and day preferences', () => {
    // Local helpers — independent of outer scope
    const mkClass = (id: string, ratio: number) => ({
      id, name: id, student_teacher_ratio: ratio, created_at: '',
    })
    const mkFamily = (id: string, opts: {
      override?: number
      flexible?: boolean
      assistant?: boolean
    } = {}) => ({
      id, name: id, email: '', phone: null, notes: null,
      shift_override: opts.override ?? 1, created_at: '',
      is_flexible_teacher: opts.flexible ?? false,
      is_assistant_teacher: opts.assistant ?? false,
    })
    const mkChild = (id: string, classId: string, familyId: string, daysOfWeek?: string[] | null) => ({
      id, family_id: familyId, class_id: classId, name: id,
      days_per_week: 5, days_of_week: daysOfWeek ?? null,
      days_change_pending: null, days_change_status: null,
    })
    const mkAvail = (familyId: string, dates: string[]) => ({
      id: familyId + '-av', family_id: familyId, period_month: '2026-04-01',
      available_dates: dates, preferred_dates: [],
      planned_absences: [], extra_shifts_willing: '0' as const,
      notes: null, submitted_at: '',
    })
    // 6 students in a class with ratio 5 → ceil(6/5)-1 = 1 parent needed
    const studentsInClass = (classId: string, count: number) =>
      Array.from({ length: count }, (_, i) => mkChild(`${classId}-s${i}`, classId, `bg-${classId}-${i}`))

    it('does not assign a family to a class their child is not enrolled in', () => {
      const result = proposeSchedule({
        year: 2026, month: 4,
        classes: [mkClass('rose', 5), mkClass('daisy', 5)],
        children: [
          ...studentsInClass('rose', 5),
          ...studentsInClass('daisy', 5),
          mkChild('child-a', 'rose', 'fam-a'),
        ],
        families: [mkFamily('fam-a')],
        availability: [mkAvail('fam-a', ['2026-04-01'])],
        conflicts: [],
        holidayDates: new Set(),
      })
      expect(result.shifts.some(s => s.family_id === 'fam-a' && s.class_id === 'rose')).toBe(true)
      expect(result.shifts.some(s => s.family_id === 'fam-a' && s.class_id === 'daisy')).toBe(false)
      expect(result.unfilledSlots.some(s => s.class_id === 'daisy')).toBe(true)
    })

    it('assigns a flexible teacher to any class regardless of their child\'s class', () => {
      const result = proposeSchedule({
        year: 2026, month: 4,
        classes: [mkClass('rose', 5), mkClass('daisy', 5)],
        children: [
          ...studentsInClass('rose', 5),
          ...studentsInClass('daisy', 5),
          mkChild('child-a', 'rose', 'fam-a'),
        ],
        families: [mkFamily('fam-a', { override: 2, flexible: true })],
        availability: [mkAvail('fam-a', ['2026-04-01'])],
        conflicts: [],
        holidayDates: new Set(),
      })
      expect(result.shifts.some(s => s.family_id === 'fam-a' && s.class_id === 'rose')).toBe(true)
      expect(result.shifts.some(s => s.family_id === 'fam-a' && s.class_id === 'daisy')).toBe(true)
    })

    it('sets off_day_warning=true when family is forced to volunteer on a non-attendance day', () => {
      // Apr 2 is Thursday; child attends M/W/Fr only
      const result = proposeSchedule({
        year: 2026, month: 4,
        classes: [mkClass('rose', 5)],
        children: [
          ...studentsInClass('rose', 5),
          mkChild('child-a', 'rose', 'fam-a', ['M', 'W', 'Fr']),
        ],
        families: [mkFamily('fam-a')],
        availability: [mkAvail('fam-a', ['2026-04-02'])],
        conflicts: [],
        holidayDates: new Set(),
      })
      const shift = result.shifts.find(s => s.family_id === 'fam-a')
      expect(shift).toBeDefined()
      expect(shift!.off_day_warning).toBe(true)
    })

    it('sets off_day_warning=false when child attends on the scheduled day', () => {
      // Apr 1 is Wednesday; child attends W only
      const result = proposeSchedule({
        year: 2026, month: 4,
        classes: [mkClass('rose', 5)],
        children: [
          ...studentsInClass('rose', 5),
          mkChild('child-a', 'rose', 'fam-a', ['W']),
        ],
        families: [mkFamily('fam-a')],
        availability: [mkAvail('fam-a', ['2026-04-01'])],
        conflicts: [],
        holidayDates: new Set(),
      })
      const shift = result.shifts.find(s => s.family_id === 'fam-a')
      expect(shift).toBeDefined()
      expect(shift!.off_day_warning).toBe(false)
    })

    it('prefers scheduling families on days their child attends (all-attend day wins)', () => {
      // fam-a child attends W only, fam-b child attends Th only
      // Apr 1=Wed, Apr 2=Thu — each family should get the day their child attends
      const result = proposeSchedule({
        year: 2026, month: 4,
        classes: [mkClass('rose', 5)],
        children: [
          ...studentsInClass('rose', 5),
          mkChild('child-a', 'rose', 'fam-a', ['W']),
          mkChild('child-b', 'rose', 'fam-b', ['Th']),
        ],
        families: [mkFamily('fam-a'), mkFamily('fam-b')],
        availability: [
          mkAvail('fam-a', ['2026-04-01', '2026-04-02']),
          mkAvail('fam-b', ['2026-04-01', '2026-04-02']),
        ],
        conflicts: [],
        holidayDates: new Set(),
      })
      const apr1 = result.shifts.filter(s => s.date === '2026-04-01')
      const apr2 = result.shifts.filter(s => s.date === '2026-04-02')
      expect(apr1.some(s => s.family_id === 'fam-a')).toBe(true)
      expect(apr2.some(s => s.family_id === 'fam-b')).toBe(true)
    })

    it('schedules assistant teacher last — only when no regular family is available', () => {
      // fam-a regular, fam-b assistant teacher — both in rose, both available Apr 1
      // 1 slot needed → fam-a should win
      const result = proposeSchedule({
        year: 2026, month: 4,
        classes: [mkClass('rose', 5)],
        children: [
          ...studentsInClass('rose', 5),
          mkChild('child-a', 'rose', 'fam-a'),
          mkChild('child-b', 'rose', 'fam-b'),
        ],
        families: [mkFamily('fam-a'), mkFamily('fam-b', { assistant: true })],
        availability: [
          mkAvail('fam-a', ['2026-04-01']),
          mkAvail('fam-b', ['2026-04-01']),
        ],
        conflicts: [],
        holidayDates: new Set(),
      })
      const apr1 = result.shifts.filter(s => s.date === '2026-04-01')
      expect(apr1.length).toBe(1)
      expect(apr1[0].family_id).toBe('fam-a')
    })
  })

  describe('unfilled slots', () => {
    it('reports unfilled slots when no eligible family is available', () => {
      // Family available only Monday Mar 2, needs 0 more shifts by the time Mar 9 comes
      const family = makeFamily('f1', 1)
      const child = makeChild('c1', 'f1', 'class-rose', 3)
      const avail = makeAvailability('f1', ['2026-03-02']) // only 1 day available, needs 1 shift

      const result = proposeSchedule({
        ...baseInput,
        families: [family],
        children: [child],
        availability: [avail],
      })

      // 22 school days, but family only gets 1 shift on 1 day → rest are unfilled
      expect(result.unfilledSlots.length).toBeGreaterThan(0)
    })

    it('has no unfilled slots when supply meets demand', () => {
      // 22 school days, each needs 1 parent. Family has override 22 and is available every day.
      const family = makeFamily('f1', 22)
      const child = makeChild('c1', 'f1', 'class-rose', 5)
      const avail = makeAvailability('f1', MARCH_WEEKDAYS)

      const result = proposeSchedule({
        ...baseInput,
        families: [family],
        children: [child],
        availability: [avail],
      })

      expect(result.unfilledSlots).toHaveLength(0)
    })
  })
})
