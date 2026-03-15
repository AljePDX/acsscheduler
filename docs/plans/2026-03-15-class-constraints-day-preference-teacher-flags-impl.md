# Class Constraints, Day Preference & Teacher Flags — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Parents are only scheduled to their child's class, preferentially on days their children attend, deprioritised if they are an Assistant Teacher; two new admin-settable flags (`is_flexible_teacher`, `is_assistant_teacher`) added to families; a new `off_day_warning` field added to shifts.

**Architecture:** DB migration adds 3 columns. `lib/types.ts` mirrors them. `lib/schedule.ts` (pure function) gets three new input maps (familyClassIds, familyAttendDates, familyAllAttendDates) and updated candidate filtering/sorting/pick logic. Admin schedule plumbing (actions + page + calendar) threads `off_day_warning` through. Admin families UI gets two new checkboxes and row badges.

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL + RLS), Vitest (unit tests), TypeScript, Tailwind / CSS variables.

---

## Quick reference: days_of_week abbreviations

`ChildRow.days_of_week` uses `['M', 'T', 'W', 'Th', 'Fr']`. `null` means all five weekdays.

JS `Date.getDay()` → abbrev mapping (school days only):
| getDay() | Abbrev |
|---|---|
| 1 | 'M' |
| 2 | 'T' |
| 3 | 'W' |
| 4 | 'Th' |
| 5 | 'Fr' |

April 2026 reference:
- Apr 1 = Wednesday ('W')
- Apr 2 = Thursday ('Th')
- Apr 3 = Friday ('Fr')
- Apr 6 = Monday ('M')
- Apr 7 = Tuesday ('T')
- Apr 8 = Wednesday ('W')

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/0013_teacher_flags_off_day_warning.sql`

**Step 1: Create the migration file**

```sql
-- 0013_teacher_flags_off_day_warning.sql
-- 1. is_flexible_teacher: family can be assigned to any class (not just their child's).
-- 2. is_assistant_teacher: family is deprioritised for extra shifts (higher cost to school).
-- 3. off_day_warning: shift was assigned on a day no child in the family attends.

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS is_flexible_teacher  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_assistant_teacher boolean NOT NULL DEFAULT false;

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS off_day_warning boolean NOT NULL DEFAULT false;
```

**Step 2: Apply in Supabase SQL Editor**

Copy the SQL above and run it in the Supabase dashboard → SQL Editor.
Confirm: no error, new columns visible in Table Editor.

**Step 3: Commit**

```bash
git add supabase/migrations/0013_teacher_flags_off_day_warning.sql
git commit -m "feat: add teacher flags and off_day_warning columns"
```

---

## Task 2: Update `lib/types.ts`

**Files:**
- Modify: `lib/types.ts`

**Step 1: Read the file** to locate `FamilyRow` and `ShiftRow`.

**Step 2: Update `FamilyRow`**

Add two fields after `shift_override`:

```typescript
export interface FamilyRow {
  id: string
  name: string
  email: string
  phone: string | null
  notes: string | null
  shift_override: number | null
  is_flexible_teacher: boolean   // ← ADD
  is_assistant_teacher: boolean  // ← ADD
  created_at: string
}
```

**Step 3: Update `ShiftRow`**

Add after `conflict_warning`:

```typescript
export interface ShiftRow {
  id: string
  date: string
  class_id: string
  family_id: string | null
  status: ShiftStatus
  conflict_warning: boolean
  off_day_warning: boolean       // ← ADD
  created_at: string
}
```

**Step 4: Update `ProposedShift` in `lib/schedule.ts`**

Find `ProposedShift` and add:

```typescript
export interface ProposedShift {
  date: string
  class_id: string
  family_id: string
  conflict_warning: boolean
  off_day_warning: boolean       // ← ADD
}
```

**Step 5: TypeScript check**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
```

Expected: new TS errors appear in `lib/schedule.ts` (proposeSchedule doesn't yet emit `off_day_warning` on ProposedShift), in test fixtures, and in admin schedule files. This is expected — they are fixed in subsequent tasks.

**Step 6: Commit**

```bash
git add lib/types.ts lib/schedule.ts
git commit -m "feat: add teacher flags to FamilyRow; off_day_warning to ShiftRow and ProposedShift"
```

---

## Task 3: Algorithm Update — `lib/schedule.ts` (TDD)

**Files:**
- Modify: `lib/schedule.ts`
- Modify: `tests/unit/schedule.test.ts`

### Step 1: Update test fixture helpers to fix TS errors from Task 2

Open `tests/unit/schedule.test.ts`. Find the top-level `makeFamily` helper and the `makeFamily` inside `describe('candidate sort order')`. Both need the new fields.

**Update all `makeFamily` helpers** (there may be multiple — check the file):

```typescript
// Top-level helper (if one exists) — add the two new boolean fields:
const makeFamily = (id: string, override: number | null = null) => ({
  id, name: id, email: '', phone: null, notes: null,
  shift_override: override, created_at: '',
  is_flexible_teacher: false,
  is_assistant_teacher: false,
})
```

For helpers inside nested `describe` blocks, do the same (add `is_flexible_teacher: false, is_assistant_teacher: false`).

**Run TS check to confirm the fixture errors are gone:**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
```

The `off_day_warning` error in `lib/schedule.ts` (ProposedShift not yet emitting the new field) will remain — that's fine, fixed in Step 4.

### Step 2: Write 4 failing tests

Add a new `describe('class constraints and day preferences')` block to `tests/unit/schedule.test.ts`. Use these self-contained local helpers:

```typescript
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
  // 6 students in a class triggers exactly 1 parent needed (ratio 5 → ceil(6/5)-1 = 1)
  const studentsInClass = (classId: string, count: number) =>
    Array.from({ length: count }, (_, i) => mkChild(`${classId}-s${i}`, classId, `bg-${classId}-${i}`))

  it('does not assign a family to a class their child is not enrolled in', () => {
    // fam-a has child only in 'rose'
    // Both rose and daisy need 1 parent on Apr 1
    // Only fam-a is available → rose filled, daisy unfilled
    const result = proposeSchedule({
      year: 2026, month: 4,
      classes: [mkClass('rose', 5), mkClass('daisy', 5)],
      children: [
        ...studentsInClass('rose', 5),
        ...studentsInClass('daisy', 5),
        mkChild('child-a', 'rose', 'fam-a'),  // fam-a's child is in rose
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
    // fam-a has child only in 'rose' but is_flexible_teacher = true
    // Both rose and daisy need 1 parent, fam-a needs 2 shifts
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
    // fam-a child attends M/W/Fr only
    // Apr 2 is a Thursday — child does NOT attend
    // fam-a is only available Apr 2 → must be scheduled there → off_day_warning
    const result = proposeSchedule({
      year: 2026, month: 4,
      classes: [mkClass('rose', 5)],
      children: [
        ...studentsInClass('rose', 5),
        mkChild('child-a', 'rose', 'fam-a', ['M', 'W', 'Fr']),  // attends M/W/Fr
      ],
      families: [mkFamily('fam-a')],
      availability: [mkAvail('fam-a', ['2026-04-02'])],  // only Apr 2 (Thursday)
      conflicts: [],
      holidayDates: new Set(),
    })
    const shift = result.shifts.find(s => s.family_id === 'fam-a')
    expect(shift).toBeDefined()
    expect(shift!.off_day_warning).toBe(true)
  })

  it('sets off_day_warning=false when child attends on the scheduled day', () => {
    // fam-a child attends W only
    // Apr 1 is Wednesday → child attends → no off_day_warning
    const result = proposeSchedule({
      year: 2026, month: 4,
      classes: [mkClass('rose', 5)],
      children: [
        ...studentsInClass('rose', 5),
        mkChild('child-a', 'rose', 'fam-a', ['W']),  // attends Wednesday only
      ],
      families: [mkFamily('fam-a')],
      availability: [mkAvail('fam-a', ['2026-04-01'])],  // Apr 1 = Wednesday
      conflicts: [],
      holidayDates: new Set(),
    })
    const shift = result.shifts.find(s => s.family_id === 'fam-a')
    expect(shift).toBeDefined()
    expect(shift!.off_day_warning).toBe(false)
  })

  it('prefers scheduling families on days their child attends (all-attend day wins)', () => {
    // fam-a child attends W only, fam-b child attends Th only
    // Apr 1 (Wed): fam-a child attends; fam-b child doesn't → fam-a should fill Apr 1
    // Apr 2 (Thu): fam-b child attends; fam-a child doesn't → fam-b should fill Apr 2
    // Both need 1 shift, both available on both days
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
    // fam-a (regular) and fam-b (assistant teacher), same class, both available Apr 1
    // 1 slot needed → fam-a (regular) should win
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
```

### Step 3: Run the failing tests

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm test -- tests/unit/schedule.test.ts
```

Expected: the 6 new tests FAIL (algorithm doesn't enforce class constraints, doesn't set `off_day_warning`, and `ProposedShift` doesn't have the field yet).

### Step 4: Update `lib/schedule.ts`

**4a. Add `familyClassIds` map** — insert after the `familyChildren` block (around line 132):

```typescript
// ── 5b. Per-family class ID set (for class constraint) ────────────────────────
const familyClassIds = new Map<string, Set<string>>()
for (const child of children) {
  if (!familyClassIds.has(child.family_id)) familyClassIds.set(child.family_id, new Set())
  familyClassIds.get(child.family_id)!.add(child.class_id)
}
```

**4b. Add attendance date maps** — insert after the `preferredMap` block (after the `── 3b` comment):

```typescript
// ── 3c. Attendance date maps: which school days does each family's child attend ─
const DOW_MAP: Record<number, string> = { 1: 'M', 2: 'T', 3: 'W', 4: 'Th', 5: 'Fr' }

const familyAttendDates    = new Map<string, Set<string>>() // ≥1 child attends
const familyAllAttendDates = new Map<string, Set<string>>() // all children attend

for (const date of schoolDays) {
  const dowAbbr = DOW_MAP[new Date(date + 'T00:00:00').getDay()]
  for (const family of schedulableFamilies) {
    const kids = familyChildren.get(family.id) ?? []
    if (kids.length === 0) continue
    const anyAttends = kids.some(c => c.days_of_week === null || c.days_of_week.includes(dowAbbr))
    const allAttend  = kids.every(c => c.days_of_week === null || c.days_of_week.includes(dowAbbr))
    if (anyAttends) {
      if (!familyAttendDates.has(family.id)) familyAttendDates.set(family.id, new Set())
      familyAttendDates.get(family.id)!.add(date)
    }
    if (allAttend) {
      if (!familyAllAttendDates.has(family.id)) familyAllAttendDates.set(family.id, new Set())
      familyAllAttendDates.get(family.id)!.add(date)
    }
  }
}
```

**4c. Update the candidate `.filter()` inside the greedy loop** — add the class constraint check. Find the `.filter(f => { ... })` block and add this check after the existing `assignedDates` check:

```typescript
// Class constraint: family must have a child in this class, or be a flexible teacher
if (!f.is_flexible_teacher) {
  const classIds = familyClassIds.get(f.id) ?? new Set()
  if (!classIds.has(cls.id)) return false
}
```

**4d. Update the `.sort()` inside the greedy loop** — add the `is_assistant_teacher` criterion as step 3 (before preferred date):

```typescript
.sort((a, b) => {
  // 1. Slack ascending — most constrained first
  const slackA = (availMap.get(a.id)?.size ?? 0) - (requiredShifts.get(a.id) ?? 0)
  const slackB = (availMap.get(b.id)?.size ?? 0) - (requiredShifts.get(b.id) ?? 0)
  if (slackA !== slackB) return slackA - slackB

  // 2. Remaining quota descending
  const remainA = (requiredShifts.get(a.id) ?? 0) - (assignedCount.get(a.id) ?? 0)
  const remainB = (requiredShifts.get(b.id) ?? 0) - (assignedCount.get(b.id) ?? 0)
  if (remainA !== remainB) return remainB - remainA

  // 3. Assistant teacher last — regular families before assistant teacher families
  const aAT = a.is_assistant_teacher ? 1 : 0
  const bAT = b.is_assistant_teacher ? 1 : 0
  if (aAT !== bAT) return aAT - bAT

  // 4. Preferred date tiebreaker
  const aPref = preferredMap.get(a.id)?.has(date) ? 1 : 0
  const bPref = preferredMap.get(b.id)?.has(date) ? 1 : 0
  return bPref - aPref
})
```

**4e. Replace the pick logic** — find the current:

```typescript
const conflictFree = candidates.filter(f => {
  const fConflicts = conflictMap.get(f.id) ?? new Set<string>()
  return !assignedOnThisDate.some(otherId => fConflicts.has(otherId))
})

const pick = conflictFree[0] ?? candidates[0]
```

Replace with:

```typescript
const conflictFree = candidates.filter(f => {
  const fConflicts = conflictMap.get(f.id) ?? new Set<string>()
  return !assignedOnThisDate.some(otherId => fConflicts.has(otherId))
})
const pool = conflictFree.length > 0 ? conflictFree : candidates

// Tier 1: all children attend this date
const allAttendPool = pool.filter(f => familyAllAttendDates.get(f.id)?.has(date))
// Tier 2: at least one child attends this date
const anyAttendPool = pool.filter(f => familyAttendDates.get(f.id)?.has(date))

const pick = allAttendPool[0] ?? anyAttendPool[0] ?? pool[0]
const offDayWarning = pick
  ? !(familyAttendDates.get(pick.id)?.has(date) ?? false)
  : false
```

**4f. Update `resultShifts.push()`** — add `off_day_warning`:

```typescript
resultShifts.push({
  date,
  class_id: cls.id,
  family_id: pick.id,
  conflict_warning: hasConflict,
  off_day_warning: offDayWarning,   // ← ADD
})
```

### Step 5: Run all schedule tests

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm test -- tests/unit/schedule.test.ts
```

Expected: ALL tests pass including the 6 new ones.

### Step 6: Full test suite

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

Expected: all pass.

### Step 7: Commit

```bash
git add lib/schedule.ts tests/unit/schedule.test.ts
git commit -m "feat: class constraint, day-preference tiers, off_day_warning, assistant teacher sort"
```

---

## Task 4: Thread `off_day_warning` through admin schedule plumbing

**Files:**
- Modify: `app/(admin)/admin/schedule/actions.ts`
- Modify: `app/(admin)/admin/schedule/AdminScheduleCalendar.tsx`
- Modify: `app/(admin)/admin/schedule/page.tsx`

### Part A — `actions.ts`

**Step 1: Read the file.** Find `proposeScheduleAction`. It inserts proposed shifts with `conflict_warning: s.conflict_warning`. Add `off_day_warning`:

```typescript
// In the .insert() call inside proposeScheduleAction, add:
off_day_warning: s.off_day_warning,
```

The full insert object should now include:
```typescript
{
  date: s.date,
  class_id: s.class_id,
  family_id: s.family_id,
  status: 'proposed',
  conflict_warning: s.conflict_warning,
  off_day_warning: s.off_day_warning,   // ← ADD
}
```

### Part B — `AdminScheduleCalendar.tsx`

**Step 2: Read the file.** Find the `EnrichedShift` interface (around line 35) and add `offDayWarning`:

```typescript
export interface EnrichedShift {
  id: string
  date: string
  classId: string
  className: string
  familyId: string | null
  familyName: string
  status: ShiftStatus
  conflictWarning: boolean
  offDayWarning: boolean    // ← ADD
}
```

### Part C — `page.tsx`

**Step 3: Read the file.** Find the `rawShifts.map(s => {...})` enrichment block. Add `offDayWarning`:

```typescript
shifts = rawShifts.map(s => {
  const cls = classMap.get(s.class_id)
  return {
    id: s.id,
    date: s.date,
    classId: s.class_id,
    className: cls?.name ?? 'Unknown',
    familyId: s.family_id ?? null,
    familyName: s.family_id ? (familyMap.get(s.family_id) ?? 'Unknown') : '—',
    status: s.status,
    conflictWarning: s.conflict_warning,
    offDayWarning: s.off_day_warning,   // ← ADD
  }
})
```

**Step 4: TypeScript check**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
```

Expected: errors in `AdminScheduleCalendar.tsx` where `offDayWarning` is not yet used in the JSX — those are warnings, not blockers, and will be fixed in Task 5. The type should be clean for what's been touched so far.

**Step 5: Commit**

```bash
git add "app/(admin)/admin/schedule/actions.ts" "app/(admin)/admin/schedule/AdminScheduleCalendar.tsx" "app/(admin)/admin/schedule/page.tsx"
git commit -m "feat: thread off_day_warning through admin schedule plumbing"
```

---

## Task 5: Admin Schedule Calendar — off_day_warning UI

**Files:**
- Modify: `app/(admin)/admin/schedule/AdminScheduleCalendar.tsx`

**Step 1: Read the full file carefully.** Understand:
- Where `conflictsAcknowledged` state and `conflictsNeedAck` derived value are defined
- Where the conflict warning banner is rendered (around line 1012)
- How `hasDayConflict` is computed in MonthView and WeekView cells
- How `shift.conflictWarning` is displayed in the DayManagementPanel assigned family rows
- Where the Publish button is disabled

**Step 2: Add `offDayAcknowledged` state**

Below the existing `conflictsAcknowledged` state, add:

```typescript
const [offDayAcknowledged, setOffDayAcknowledged] = useState(false)
```

**Step 3: Reset when schedule changes**

Find where `setConflictsAcknowledged(false)` is called (on re-propose). Add alongside it:

```typescript
setOffDayAcknowledged(false)
```

**Step 4: Add `offDayNeedAck` derived value**

Near where `conflictsNeedAck` is defined, add:

```typescript
const offDayNeedAck = shifts.some(s => s.offDayWarning && s.status === 'proposed')
```

**Step 5: MonthView — add `hasOffDay` badge**

In MonthView, find where `hasDayConflict` is computed for each date cell:

```typescript
const hasDayConflict = dayShifts.some(s => s.conflictWarning)
```

Add below it:

```typescript
const hasDayOffDay = dayShifts.some(s => s.offDayWarning)
```

Then in the date cell header area where the conflict amber circle badge is rendered, add an identical off-day badge alongside it:

```tsx
{hasDayOffDay && (
  <span
    title="Non-attendance day"
    style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '1.1rem', height: '1.1rem', borderRadius: '50%',
      background: 'var(--warning)', color: '#fff',
      fontSize: '0.6rem', fontWeight: 700, marginLeft: '0.2rem',
    }}
  >
    ★
  </span>
)}
```

(Using ★ to distinguish from ⚠ conflict badge — both are warning-colored but visually distinct.)

**Step 6: WeekView — same treatment**

Find the WeekView equivalent of the `hasDayConflict` detection and add `hasDayOffDay` with the same star badge in the day card header.

**Step 7: DayManagementPanel — off_day_warning on assigned family rows**

In `DayManagementPanel`, find where `shift.conflictWarning` is displayed on an assigned family row:

```tsx
{shift.conflictWarning && (
  <span title="Conflict warning" style={{ color: 'var(--warning)', marginLeft: '0.3rem', fontSize: '0.75rem' }}>⚠</span>
)}
```

Add an adjacent badge for `offDayWarning`:

```tsx
{shift.offDayWarning && (
  <span title="Scheduled on a non-attendance day" style={{ color: 'var(--warning)', marginLeft: '0.3rem', fontSize: '0.75rem' }}>★</span>
)}
```

**Step 8: Add off-day warning banner**

Find the conflict warning banner block (around line 1012). After it (or alongside it), add an identical off-day warning banner:

```tsx
{offDayNeedAck && !offDayAcknowledged && (
  <div style={{
    background: 'var(--warning-light)',
    border: '1px solid var(--warning)',
    borderRadius: '8px',
    padding: '0.75rem 1rem',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
  }}>
    <span style={{ color: 'var(--warning)', fontSize: '1.1rem', lineHeight: 1 }}>★</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 700, color: 'var(--warning)', fontSize: '0.875rem' }}>
        Non-attendance day assignments
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
        Some parents are scheduled on days their children are not attending school.
        Review these assignments before publishing.
      </div>
    </div>
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <input
        type="checkbox"
        checked={offDayAcknowledged}
        onChange={e => setOffDayAcknowledged(e.target.checked)}
      />
      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--warning)' }}>Acknowledge</span>
    </label>
  </div>
)}
```

**Step 9: Update the Publish button disabled condition**

Find where the Publish button is disabled. Currently it checks `conflictsNeedAck && !conflictsAcknowledged`. Add the off-day condition:

```typescript
disabled={!hasProposed || isPublishP || (conflictsNeedAck && !conflictsAcknowledged) || (offDayNeedAck && !offDayAcknowledged)}
```

Update the button's background/color style condition the same way.

**Step 10: TypeScript check + full tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

Expected: 0 errors, all tests pass.

**Step 11: Commit**

```bash
git add "app/(admin)/admin/schedule/AdminScheduleCalendar.tsx"
git commit -m "feat: off_day_warning badges, banner, and publish gate in admin schedule"
```

---

## Task 6: Admin Families List — FT/AT Badges

**Files:**
- Modify: `app/(admin)/admin/families/page.tsx`

**Step 1: Read the file.** Find where each family row is rendered (the list item or table row). Note how `conflict_warning` or other flags are currently shown (if any).

**Step 2: Add FT/AT badges to each family row**

For each family in the list, after the family name (or in a dedicated column/area), add:

```tsx
{family.is_flexible_teacher && (
  <span style={{
    display: 'inline-block',
    padding: '0.1rem 0.4rem',
    borderRadius: '999px',
    fontSize: '0.65rem',
    fontWeight: 700,
    background: 'var(--sage-light)',
    color: 'var(--sage-dark)',
    marginLeft: '0.35rem',
    letterSpacing: '0.04em',
  }}>
    FT
  </span>
)}
{family.is_assistant_teacher && (
  <span style={{
    display: 'inline-block',
    padding: '0.1rem 0.4rem',
    borderRadius: '999px',
    fontSize: '0.65rem',
    fontWeight: 700,
    background: 'var(--daisy-light)',
    color: 'var(--daisy)',
    marginLeft: '0.35rem',
    letterSpacing: '0.04em',
  }}>
    AT
  </span>
)}
```

**Step 3: Ensure the query selects the new fields**

The page likely selects `*` or specific columns from `families`. If it uses `.select('*')`, the new columns are included automatically. If it selects specific columns, add `is_flexible_teacher, is_assistant_teacher` to the select string.

**Step 4: TypeScript check + tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

**Step 5: Commit**

```bash
git add "app/(admin)/admin/families/page.tsx"
git commit -m "feat: FT and AT badges on admin families list"
```

---

## Task 7: Admin Families Edit Form — Checkboxes + Action

**Files:**
- Modify: `app/(admin)/admin/families/[id]/page.tsx`
- Modify: `app/(admin)/admin/families/[id]/actions.ts` (or wherever `updateFamilyAction` lives — check the page for imports)

**Step 1: Read both files** (`page.tsx` and its action file). Find:
- The existing form fields (name, email, phone, notes, shift_override)
- The `updateFamilyAction` (or equivalent) that handles form submission
- How boolean/checkbox fields are currently handled (if any)

**Step 2: Update the server action**

In the action file, find the `updateFamilyAction` function. It likely reads form data and calls `.update()` on the families table. Add the two boolean fields:

```typescript
// In the formData extraction:
const isFlexibleTeacher = formData.get('is_flexible_teacher') === 'on'
const isAssistantTeacher = formData.get('is_assistant_teacher') === 'on'

// In the .update() object:
is_flexible_teacher: isFlexibleTeacher,
is_assistant_teacher: isAssistantTeacher,
```

Note: HTML checkboxes submit `'on'` when checked and nothing (not present in FormData) when unchecked. The `=== 'on'` comparison handles both cases correctly.

**Step 3: Add checkboxes to the edit form**

In `page.tsx`, find the family edit form. After the `shift_override` field (or in a logical section), add a "Teacher Settings" section with two checkboxes:

```tsx
{/* Teacher Settings — admin only */}
<div style={{ marginTop: '1.5rem' }}>
  <div style={{
    fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.75rem',
  }}>
    Teacher Settings
  </div>
  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', cursor: 'pointer' }}>
    <input
      type="checkbox"
      name="is_flexible_teacher"
      defaultChecked={family.is_flexible_teacher}
    />
    <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>
      Flexible Teacher
    </span>
    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
      Can be assigned to any class, not just their child's
    </span>
  </label>
  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
    <input
      type="checkbox"
      name="is_assistant_teacher"
      defaultChecked={family.is_assistant_teacher}
    />
    <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>
      Assistant Teacher
    </span>
    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
      Scheduled for extra shifts last (higher cost to school)
    </span>
  </label>
</div>
```

**Step 4: Also ensure availability notes section (from previous session) still shows properly**

The previous session added an availability history section to this page. Verify it's still rendering correctly — no changes needed, just a sanity check.

**Step 5: TypeScript check + tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

Expected: 0 errors, all tests pass.

**Step 6: Commit**

```bash
git add "app/(admin)/admin/families/[id]/page.tsx"
git commit -m "feat: Flexible Teacher and Assistant Teacher checkboxes on family edit form"
```

Also commit the action file if it changed:
```bash
git add "app/(admin)/admin/families/[id]/actions.ts"  # if this file exists and was modified
```

---

## Task 8: Final Verification

**Step 1: Full test suite**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

Expected: all tests pass. Report exact count (should be ≥102: previous 96 + 6 new).

**Step 2: TypeScript check**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
```

Expected: 0 errors.

**Step 3: Next.js build**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm run build
```

Expected: 29 pages compile, no ESLint errors.

**Step 4: Git log**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && git log --oneline -10
```

Expected to see all task commits in order.

**Step 5: Manual smoke-test checklist** (run `npm run dev` and check in browser):

- [ ] Admin families list: FT badge (sage green) and AT badge (daisy yellow) visible on flagged families
- [ ] Admin family edit: "Teacher Settings" section shows both checkboxes; toggling and saving persists
- [ ] Admin schedule: clicking a day with an off-day assignment shows ★ badge on the date cell
- [ ] Admin schedule: warning banner appears for off-day assignments and must be acknowledged before publishing
- [ ] Day Management Panel: assigned family row shows ★ badge when `off_day_warning` is true
- [ ] Parent-facing pages: no new fields exposed (check parent dashboard, schedule, availability)

**Note:** Remember to apply DB migration `0013_teacher_flags_off_day_warning.sql` in Supabase SQL Editor before smoke-testing.
