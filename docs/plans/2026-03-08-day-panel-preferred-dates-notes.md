# Day Panel · Preferred Dates · Availability Notes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (1) Replace chip-click on admin schedule with a unified day-click panel that lets admin add/remove/move families per class; (2) let parents mark preferred volunteer dates (star visual, cycling click); (3) add a per-month notes field to availability; (4) reorder the schedule algorithm to prioritise constrained families first, then preferred dates.

**Architecture:** DB migration adds `preferred_dates date[]` and `notes text` to `availability`, and makes `shifts.family_id` nullable (removed family = open slot, not deleted row). Algorithm changes live entirely in `lib/schedule.ts`. UI changes touch `AvailabilityCalendar`, three new server actions, the admin schedule page data fetch, and the calendar component (new `DayManagementPanel` replaces `ShiftReassignPanel`).

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL + RLS), Vitest (unit tests), TypeScript, Tailwind / CSS variables.

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/0012_availability_preferred_notes.sql`

**Step 1: Create the migration file**

```sql
-- 0012_availability_preferred_notes.sql
-- 1. preferred_dates: subset of available_dates a parent most wants to be assigned.
-- 2. notes: freeform per-month scheduler note visible to admin only.
-- 3. shifts.family_id is now nullable — NULL means "open slot, not yet assigned".

ALTER TABLE availability
  ADD COLUMN IF NOT EXISTS preferred_dates  date[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes            text;

ALTER TABLE shifts
  ALTER COLUMN family_id DROP NOT NULL;
```

**Step 2: Apply in Supabase SQL Editor**

Copy the SQL above and run it in the Supabase dashboard → SQL Editor.
Confirm: no error, table columns visible in Table Editor.

**Step 3: Commit**

```bash
git add supabase/migrations/0012_availability_preferred_notes.sql
git commit -m "feat: add preferred_dates and notes to availability; nullable shift family_id"
```

---

## Task 2: Update `lib/types.ts`

**Files:**
- Modify: `lib/types.ts`

**Step 1: Update AvailabilityRow**

Find `AvailabilityRow` and add two fields:

```typescript
export interface AvailabilityRow {
  id: string
  family_id: string
  period_month: string
  available_dates: string[]
  preferred_dates: string[]       // ← ADD (always a subset of available_dates)
  planned_absences: PlannedAbsence[]
  extra_shifts_willing: '0' | '1-2' | '3-4' | '5+'
  notes: string | null            // ← ADD
  submitted_at: string
}
```

**Step 2: Update ShiftRow — make family_id nullable**

Find `ShiftRow` and change:

```typescript
export interface ShiftRow {
  id: string
  date: string
  class_id: string
  family_id: string | null   // ← was `string`, now nullable
  status: ShiftStatus
  conflict_warning: boolean
  created_at: string
}
```

**Step 3: TypeScript check**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
```

Expected: 0 errors. (There will be type errors in downstream files — fix those in their respective tasks.)

**Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add preferred_dates and notes to AvailabilityRow; nullable ShiftRow.family_id"
```

---

## Task 3: Algorithm Update — `lib/schedule.ts` (TDD)

**Files:**
- Modify: `lib/schedule.ts`
- Modify: `tests/unit/schedule.test.ts`

### Step 1: Write the two failing tests

Add to `tests/unit/schedule.test.ts` (inside the existing `describe` block):

```typescript
describe('candidate sort order', () => {
  // Minimal setup helpers
  const makeClass = (id: string, ratio: number) => ({
    id, name: id, student_teacher_ratio: ratio, created_at: '',
  })
  const makeFamily = (id: string, override: number) => ({
    id, name: id, email: '', phone: null, notes: null,
    shift_override: override, created_at: '',
  })
  const makeChild = (id: string, classId: string, familyId: string) => ({
    id, family_id: familyId, class_id: classId, name: id,
    days_per_week: 5, days_of_week: null,
    days_change_pending: null, days_change_status: null,
  })
  const makeAvail = (familyId: string, dates: string[], preferred: string[] = []) => ({
    id: familyId + '-av', family_id: familyId, period_month: '2026-04-01',
    available_dates: dates, preferred_dates: preferred,
    planned_absences: [], extra_shifts_willing: '0' as const, notes: null, submitted_at: '',
  })

  it('schedules the most constrained family first (fewest slack days)', () => {
    // fam-a: available 1 day, needs 1 shift → slack = 0
    // fam-b: available 5 days, needs 1 shift → slack = 4
    // Apr 1 is available to both → fam-a (0 slack) must win the slot
    const result = proposeSchedule({
      year: 2026, month: 4,
      classes: [makeClass('cls', 5)],
      // 6 students so ceil(6/5)-1 = 1 parent needed
      children: Array.from({ length: 6 }, (_, i) => makeChild(`c${i}`, 'cls', `other-${i}`)),
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

  it('assigns a family to their preferred date over a non-preferring peer with equal slack', () => {
    // Both families: available only on Apr 2, need 1 shift → same slack (0)
    // fam-a marks Apr 2 as preferred; fam-b does not
    // 1 slot on Apr 2 → fam-a should win
    const result = proposeSchedule({
      year: 2026, month: 4,
      classes: [makeClass('cls', 5)],
      children: Array.from({ length: 6 }, (_, i) => makeChild(`c${i}`, 'cls', `other-${i}`)),
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
```

**Step 2: Run the failing tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm test -- tests/unit/schedule.test.ts
```

Expected: the two new tests FAIL (algorithm ignores slack and preferred_dates).

**Step 3: Update `lib/schedule.ts`**

Add the `preferredMap` just after the `availMap` block (around line 103):

```typescript
// ── 3b. Preferred dates map: family_id → Set of preferred dates ───────────────
const preferredMap = new Map<string, Set<string>>()
for (const avail of availability) {
  if (avail.preferred_dates?.length) {
    preferredMap.set(avail.family_id, new Set(avail.preferred_dates))
  }
}
```

Replace the existing `.sort()` inside the greedy loop (find the block starting with `const candidates = schedulableFamilies.filter(...).sort(...)`) with the new sort:

```typescript
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
    const slackA = (availMap.get(a.id)?.size ?? 0) - (requiredShifts.get(a.id) ?? 0)
    const slackB = (availMap.get(b.id)?.size ?? 0) - (requiredShifts.get(b.id) ?? 0)
    if (slackA !== slackB) return slackA - slackB

    // 2. Remaining quota descending — more shifts owed = higher priority
    const remainA = (requiredShifts.get(a.id) ?? 0) - (assignedCount.get(a.id) ?? 0)
    const remainB = (requiredShifts.get(b.id) ?? 0) - (assignedCount.get(b.id) ?? 0)
    if (remainA !== remainB) return remainB - remainA

    // 3. Preferred date tiebreaker
    const aPref = preferredMap.get(a.id)?.has(date) ? 1 : 0
    const bPref = preferredMap.get(b.id)?.has(date) ? 1 : 0
    return bPref - aPref
  })
```

**Step 4: Run all schedule tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm test -- tests/unit/schedule.test.ts
```

Expected: ALL pass including the two new ones.

**Step 5: Full test suite**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add lib/schedule.ts tests/unit/schedule.test.ts
git commit -m "feat: schedule algorithm prioritises constrained families and preferred dates"
```

---

## Task 4: Update Parent Availability Action

**Files:**
- Modify: `app/(parent)/parent/availability/actions.ts`

**Step 1: Read the file** to confirm the current upsert shape.

**Step 2: Add `preferredDates` and `notes` parameters**

Change the function signature:

```typescript
export async function submitAvailabilityAction(
  familyId: string,
  periodMonth: string,
  availableDates: string[],
  plannedAbsences: PlannedAbsenceInput[],
  extraShiftsWilling: string = '0',
  preferredDates: string[] = [],   // ← ADD
  notes: string = ''               // ← ADD
): Promise<{ error?: string; success?: boolean }>
```

Inside the upsert object, add the two new fields:

```typescript
{
  family_id: familyId,
  period_month: periodMonth,
  available_dates: availableDates,
  preferred_dates: preferredDates,    // ← ADD
  planned_absences: plannedAbsences,
  extra_shifts_willing: extraShiftsWilling,
  notes: notes || null,               // ← ADD (store empty string as null)
},
```

**Step 3: TypeScript check**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git add "app/(parent)/parent/availability/actions.ts"
git commit -m "feat: availability action accepts preferred_dates and notes"
```

---

## Task 5: Update Parent Availability Calendar + Page

**Files:**
- Modify: `components/parent/AvailabilityCalendar.tsx`
- Modify: `app/(parent)/parent/availability/page.tsx`

### Part A — Update `page.tsx`

**Step 1: Read the page file** to find where `initialAvailableDates` and `initialAbsences` are fetched from the DB.

**Step 2: Fetch new fields**

Find the query that reads the availability record for this family/month. It currently selects (at minimum) `available_dates` and `planned_absences`. Extend the select to include the new columns:

```typescript
supabase
  .from('availability')
  .select('available_dates, planned_absences, preferred_dates, notes, extra_shifts_willing')
  .eq('family_id', familyId)
  .eq('period_month', periodMonth)
  .maybeSingle()
```

**Step 3: Extract and pass the new values**

After the query, extract:

```typescript
const initialPreferredDates: string[] = (data?.preferred_dates ?? []) as string[]
const initialNotes: string = (data?.notes ?? '') as string
```

Pass them to `<AvailabilityCalendar>`:

```tsx
<AvailabilityCalendar
  ...existing props...
  initialPreferredDates={initialPreferredDates}
  initialNotes={initialNotes}
/>
```

### Part B — Update `AvailabilityCalendar.tsx`

**Step 1: Read the component** to identify the `Props` interface, `availableDates` state, `toggleDate` callback, the date cell render block, the submit handler, and the summary strip.

**Step 2: Extend the Props interface**

Add to the `Props` interface:

```typescript
initialPreferredDates?: string[]
initialNotes?: string
```

And destructure in the component:

```typescript
{ ..., initialPreferredDates = [], initialNotes = '', hasExistingSubmission = false, ... }
```

**Step 3: Add `preferredDates` and `notes` state**

Below the `availableDates` state, add:

```typescript
const [preferredDates, setPreferredDates] = useState<Set<string>>(
  () => new Set(initialPreferredDates)
)
const [notes, setNotes] = useState<string>(initialNotes)
```

**Step 4: Update the `toggleDate` callback**

In the `mode === 'available'` branch, replace the current toggle logic with cycling logic:

```typescript
if (mode === 'available') {
  setSaveSuccess(false)
  const d = toISO(day)
  if (preferredDates.has(d)) {
    // Preferred → Unmarked: remove from both
    setPreferredDates(prev => { const n = new Set(prev); n.delete(d); return n })
    setAvailableDates(prev => { const n = new Set(prev); n.delete(d); return n })
  } else if (availableDates.has(d)) {
    // Available → Preferred: promote
    setPreferredDates(prev => { const n = new Set(prev); n.add(d); return n })
  } else {
    // Unmarked → Available
    setAvailableDates(prev => { const n = new Set(prev); n.add(d); return n })
  }
}
```

Make sure `preferredDates` is in the `useCallback` dependency array alongside `availableDates`.

**Step 5: Add ★ star to date cells**

Find the block that renders each date cell. When a date is in `preferredDates`, render a small star badge overlaid on (or inside) the cell. Look for where the cell background is set based on `availableDates.has(d)` and add:

```tsx
{preferredDates.has(toISO(day)) && (
  <span
    style={{
      position: 'absolute',
      top: '2px',
      right: '4px',
      fontSize: '0.65rem',
      color: 'var(--daisy)',
      lineHeight: 1,
      pointerEvents: 'none',
    }}
    aria-label="preferred"
  >
    ★
  </span>
)}
```

The cell container needs `position: 'relative'` if it doesn't already have it.

**Step 6: Update the summary strip**

Find the summary strip below the calendar (shows volunteer days count, absences per child, shift requirement note). Add:

```tsx
{preferredDates.size > 0 && (
  <span style={{ color: 'var(--daisy)', fontWeight: 600 }}>
    ★ {preferredDates.size} preferred
  </span>
)}
```

**Step 7: Add notes textarea**

Below the summary strip (before the save button), add:

```tsx
<div style={{ marginTop: '1.25rem' }}>
  <label
    htmlFor="availability-notes"
    style={{
      display: 'block',
      fontSize: '0.68rem',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: 'var(--text-muted)',
      marginBottom: '0.4rem',
    }}
  >
    Notes for the scheduler (optional)
  </label>
  <textarea
    id="availability-notes"
    value={notes}
    onChange={e => setNotes(e.target.value)}
    placeholder="e.g. I'm free any day but prefer mornings."
    rows={3}
    style={{
      width: '100%',
      padding: '0.6rem 0.75rem',
      background: 'var(--warm-white)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      fontSize: '0.875rem',
      color: 'var(--text)',
      resize: 'vertical',
      fontFamily: 'inherit',
      lineHeight: 1.5,
    }}
  />
</div>
```

**Step 8: Pass `preferredDates` and `notes` to the submit action**

Find the `handleSave` function and update the call to `submitAvailabilityAction` to include the two new arguments:

```typescript
await submitAvailabilityAction(
  familyId,
  periodMonth,
  [...availableDates],
  absencesList,
  extraShiftsWilling,
  [...preferredDates],   // ← ADD
  notes                  // ← ADD
)
```

**Step 9: Update read-only mode counts** (if the `isEditing` read-only card shows counts)

The read-only summary already shows `availableDates.size`. If it doesn't already mention preferred, it doesn't need to — the star count in the summary strip is enough.

**Step 10: TypeScript check + full tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

Expected: 0 errors, all tests pass.

**Step 11: Commit**

```bash
git add "components/parent/AvailabilityCalendar.tsx" "app/(parent)/parent/availability/page.tsx"
git commit -m "feat: preferred dates (star cycling) and notes field in availability form"
```

---

## Task 6: New Admin Schedule Server Actions

**Files:**
- Modify: `app/(admin)/admin/schedule/actions.ts`

Add three new actions at the bottom of the file (after `reassignShiftAction`):

**Step 1: Add `addShiftAction`**

```typescript
export async function addShiftAction(
  date: string,
  classId: string,
  familyId: string
): Promise<{ error?: string }> {
  const supabase = await createClient()
  await verifyAdmin(supabase)

  // Compute conflict_warning: check other families already on this date
  const { data: sameDayShifts } = await supabase
    .from('shifts')
    .select('family_id')
    .eq('date', date)
    .not('family_id', 'is', null)
    .returns<{ family_id: string }[]>()

  const otherFamilyIds = (sameDayShifts ?? []).map(s => s.family_id as string)

  const { data: conflictRows } = await supabase
    .from('family_conflicts')
    .select('family_a_id, family_b_id')
    .returns<FamilyConflictRow[]>()

  const conflictWarning = computeConflictWarning(familyId, otherFamilyIds, conflictRows ?? [])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('shifts') as any).insert({
    date,
    class_id: classId,
    family_id: familyId,
    status: 'proposed',
    conflict_warning: conflictWarning,
  })

  if (error) return { error: error.message }
  revalidatePath('/admin/schedule')
  return {}
}
```

**Step 2: Add `removeAssignmentAction`**

```typescript
export async function removeAssignmentAction(
  shiftId: string
): Promise<{ error?: string }> {
  const supabase = await createClient()
  await verifyAdmin(supabase)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('shifts') as any)
    .update({ family_id: null, conflict_warning: false })
    .eq('id', shiftId)

  if (error) return { error: error.message }
  revalidatePath('/admin/schedule')
  return {}
}
```

**Step 3: Add `moveShiftClassAction`**

```typescript
export async function moveShiftClassAction(
  shiftId: string,
  newClassId: string
): Promise<{ error?: string }> {
  const supabase = await createClient()
  await verifyAdmin(supabase)

  const { data: shift } = await supabase
    .from('shifts')
    .select('date, family_id')
    .eq('id', shiftId)
    .returns<{ date: string; family_id: string | null }[]>()
    .maybeSingle()

  if (!shift) return { error: 'Shift not found.' }

  let conflictWarning = false
  if (shift.family_id) {
    const { data: sameDayShifts } = await supabase
      .from('shifts')
      .select('family_id')
      .eq('date', shift.date)
      .neq('id', shiftId)
      .not('family_id', 'is', null)
      .returns<{ family_id: string }[]>()

    const otherFamilyIds = (sameDayShifts ?? []).map(s => s.family_id as string)

    const { data: conflictRows } = await supabase
      .from('family_conflicts')
      .select('family_a_id, family_b_id')
      .returns<FamilyConflictRow[]>()

    conflictWarning = computeConflictWarning(shift.family_id, otherFamilyIds, conflictRows ?? [])
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('shifts') as any)
    .update({ class_id: newClassId, conflict_warning: conflictWarning })
    .eq('id', shiftId)

  if (error) return { error: error.message }
  revalidatePath('/admin/schedule')
  return {}
}
```

**Step 4: TypeScript check**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add "app/(admin)/admin/schedule/actions.ts"
git commit -m "feat: addShiftAction, removeAssignmentAction, moveShiftClassAction"
```

---

## Task 7: Update Admin Schedule `page.tsx`

**Files:**
- Modify: `app/(admin)/admin/schedule/page.tsx`

**Step 1: Add availability fetch**

Inside the `Promise.all`, add a new query:

```typescript
supabase
  .from('availability')
  .select('family_id, available_dates, preferred_dates, notes')
  .eq('period_month', periodStart)
```

Destructure it alongside the others:

```typescript
const [shiftsRes, classesRes, familiesRes, childrenRes, holidaysRes, conflictPairsRes, availRes] =
  await Promise.all([...existing 6..., the new avail query])
```

**Step 2: Build `familyAvailability` record**

After all the existing map-building:

```typescript
// Build per-family availability info for the Day Panel
type FamilyAvailInfo = {
  availableDates: string[]
  preferredDates: string[]
  notes: string | null
}
const familyAvailability: Record<string, FamilyAvailInfo> = {}
for (const row of ((availRes.data ?? []) as { family_id: string; available_dates: string[]; preferred_dates: string[]; notes: string | null }[])) {
  familyAvailability[row.family_id] = {
    availableDates: row.available_dates ?? [],
    preferredDates: row.preferred_dates ?? [],
    notes: row.notes ?? null,
  }
}
```

**Step 3: Fix EnrichedShift for nullable familyId**

The existing enrichment maps `familyId: s.family_id` — this now needs to handle null:

```typescript
shifts = rawShifts.map(s => {
  const cls = classMap.get(s.class_id)
  return {
    id: s.id,
    date: s.date,
    classId: s.class_id,
    className: cls?.name ?? 'Unknown',
    familyId: s.family_id ?? null,                                           // ← nullable
    familyName: s.family_id ? (familyMap.get(s.family_id) ?? 'Unknown') : '—', // ← fallback
    status: s.status,
    conflictWarning: s.conflict_warning,
  }
})
```

**Step 4: Pass `familyAvailability` to the calendar**

```tsx
<AdminScheduleCalendar
  ...existing props...
  familyAvailability={familyAvailability}
/>
```

**Step 5: TypeScript check**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
```

Expected: type errors in `AdminScheduleCalendar.tsx` (new prop not yet accepted) — that's expected; fix in Task 8.

**Step 6: Commit**

```bash
git add "app/(admin)/admin/schedule/page.tsx"
git commit -m "feat: fetch availability data for admin day panel; nullable shift familyId"
```

---

## Task 8: Replace ShiftReassignPanel with DayManagementPanel

**Files:**
- Modify: `app/(admin)/admin/schedule/AdminScheduleCalendar.tsx`

This is the largest task. Read the full file before starting.

### Step 1: Update the `EnrichedShift` interface

```typescript
export interface EnrichedShift {
  id: string
  date: string
  classId: string
  className: string
  familyId: string | null    // ← was string
  familyName: string
  status: ShiftStatus
  conflictWarning: boolean
}
```

### Step 2: Add the new prop types

Add to the component's `Props` interface:

```typescript
familyAvailability: Record<string, {
  availableDates: string[]
  preferredDates: string[]
  notes: string | null
}>
```

Destructure it in the component function parameters.

### Step 3: Replace `selectedShift` state with `selectedDay` state

Remove:
```typescript
const [selectedShift, setSelectedShift] = useState<EnrichedShift | null>(null)
const [isReassignPending, setIsReassignPending] = useState(false)
const [reassignError, setReassignError] = useState<string | null>(null)
```

Add:
```typescript
const [selectedDay, setSelectedDay] = useState<string | null>(null)
```

### Step 4: Make date cells clickable

**In `MonthView`:** Find the date cell `<div>` (the one that contains the day number and shift chips). Add `onClick` and `cursor`:

```tsx
<div
  key={...}
  onClick={() => { if (!isHoliday && !isWeekend) setSelectedDay(toISO(day)) }}
  style={{
    ...existing styles...,
    cursor: isHoliday || isWeekend ? 'default' : 'pointer',
  }}
>
```

`toISO` is likely already defined in the component as a helper (e.g., format the year/month/day to YYYY-MM-DD). Use the same helper.

**Remove** `onClick={() => setSelectedShift(s)}` from each `<ShiftChip>` call in MonthView and WeekView — chips are now purely visual inside the day panel.

**In `WeekView`:** Find the day card header or the day card container itself and add a similar onClick to `setSelectedDay(date)`.

### Step 5: Add unfilled-slot ⚠ badge on date cells

In the MonthView date cell, detect unfilled shifts (familyId === null):

```typescript
const dayShifts = shifts.filter(s => s.date === toISO(day))
const hasUnfilled = dayShifts.some(s => s.familyId === null)
```

Render the badge alongside the existing conflict badge:

```tsx
{hasUnfilled && (
  <span
    title="Unfilled slot"
    style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '1.1rem', height: '1.1rem', borderRadius: '50%',
      background: 'var(--warning)', color: '#fff',
      fontSize: '0.6rem', fontWeight: 700, marginLeft: '0.2rem',
    }}
  >
    ⚠
  </span>
)}
```

Do the same for WeekView day cards.

### Step 6: Write the `DayManagementPanel` component

Add this component **inside the same file** (above the main exported component):

```typescript
interface DayManagementPanelProps {
  date: string
  classes: ClassRow[]
  dayShifts: EnrichedShift[]
  familyStats: FamilyShiftStats[]
  familyAvailability: Record<string, {
    availableDates: string[]
    preferredDates: string[]
    notes: string | null
  }>
  conflictPairs: ConflictPair[]
  onClose: () => void
}

function DayManagementPanel({
  date,
  classes,
  dayShifts,
  familyStats,
  familyAvailability,
  conflictPairs,
  onClose,
}: DayManagementPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [addTarget, setAddTarget] = useState<{ classId: string; familyId: string } | null>(null)

  // Families assigned on this day (non-null family_id)
  const assignedFamilyIds = dayShifts
    .filter(s => s.familyId !== null)
    .map(s => s.familyId as string)

  // Eligible families for "+ Add": available, not already assigned, quota remaining
  const eligibleFamilies = familyStats.filter(fam => {
    const avail = familyAvailability[fam.id]
    if (!avail?.availableDates.includes(date)) return false
    if (assignedFamilyIds.includes(fam.id)) return false
    if (fam.assigned >= fam.required) return false
    return true
  })

  const hasConflictOnDay = (familyId: string) =>
    computeConflictWarning(familyId, assignedFamilyIds, conflictPairs)

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const CLASS_COLORS: Record<string, string> = {
    Rose: 'var(--rose)', Daisy: 'var(--daisy)', Azalea: 'var(--azalea)',
  }
  const CLASS_BG: Record<string, string> = {
    Rose: 'var(--rose-light)', Daisy: 'var(--daisy-light)', Azalea: 'var(--azalea-light)',
  }
  const OTHER_CLASSES: Record<string, string[]> = {
    Rose: ['Daisy', 'Azalea'], Daisy: ['Rose', 'Azalea'], Azalea: ['Rose', 'Daisy'],
  }

  function handleRemove(shiftId: string) {
    setError(null)
    startTransition(async () => {
      const res = await removeAssignmentAction(shiftId)
      if (res.error) setError(res.error)
    })
  }

  function handleMove(shiftId: string, newClassId: string) {
    setError(null)
    startTransition(async () => {
      const res = await moveShiftClassAction(shiftId, newClassId)
      if (res.error) setError(res.error)
    })
  }

  function handleAdd(classId: string, familyId: string) {
    setError(null)
    setAddTarget(null)
    startTransition(async () => {
      const res = await addShiftAction(date, classId, familyId)
      if (res.error) setError(res.error)
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40,
        }}
      />
      {/* Panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: '360px',
          background: 'var(--warm-white)', borderLeft: '1px solid var(--border)',
          zIndex: 50, overflowY: 'auto', display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--shadow)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.25rem 1.25rem 0.75rem',
          borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              Manage Day
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginTop: '0.1rem' }}>
              {formattedDate}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Class sections */}
        <div style={{ flex: 1, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {classes.map(cls => {
            const classShifts = dayShifts.filter(s => s.classId === cls.id)
            const classEligible = eligibleFamilies.filter(f =>
              !classShifts.some(s => s.familyId === f.id)
            )
            const otherClassNames = OTHER_CLASSES[cls.name] ?? []
            const otherClassIds = classes
              .filter(c => otherClassNames.includes(c.name))
              .map(c => ({ id: c.id, name: c.name }))

            return (
              <div key={cls.id}>
                {/* Class header */}
                <div style={{
                  fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: CLASS_COLORS[cls.name] ?? 'var(--text-muted)',
                  marginBottom: '0.5rem', borderLeft: `3px solid ${CLASS_COLORS[cls.name] ?? 'var(--border)'}`,
                  paddingLeft: '0.5rem',
                }}>
                  {cls.name}
                </div>

                {/* Assigned families */}
                {classShifts.length === 0 && (
                  <div style={{
                    padding: '0.6rem 0.75rem',
                    background: 'var(--warning-light)', borderRadius: '8px',
                    border: '1px solid var(--warning)',
                    fontSize: '0.8rem', color: 'var(--warning)', fontWeight: 600,
                  }}>
                    ⚠ Unfilled — needs a volunteer
                  </div>
                )}
                {classShifts.map(shift => {
                  if (shift.familyId === null) {
                    return (
                      <div key={shift.id} style={{
                        padding: '0.6rem 0.75rem', marginBottom: '0.4rem',
                        background: 'var(--warning-light)', borderRadius: '8px',
                        border: '1px solid var(--warning)',
                        fontSize: '0.8rem', color: 'var(--warning)', fontWeight: 600,
                      }}>
                        ⚠ Unfilled slot
                      </div>
                    )
                  }
                  const avail = familyAvailability[shift.familyId]
                  const isPreferred = avail?.preferredDates.includes(date) ?? false
                  const hasNote = !!avail?.notes

                  return (
                    <div key={shift.id} style={{
                      padding: '0.65rem 0.75rem', marginBottom: '0.4rem',
                      background: 'var(--cream)', borderRadius: '8px',
                      border: '1px solid var(--border)',
                    }}>
                      {/* Family name row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>
                          {isPreferred && <span title="Preferred day" style={{ color: 'var(--daisy)', marginRight: '0.3rem' }}>★</span>}
                          {shift.familyName}
                          {shift.conflictWarning && (
                            <span title="Conflict warning" style={{ color: 'var(--warning)', marginLeft: '0.3rem', fontSize: '0.75rem' }}>⚠</span>
                          )}
                        </span>
                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                          {/* Move to another class */}
                          {otherClassIds.map(oc => (
                            <button
                              key={oc.id}
                              onClick={() => handleMove(shift.id, oc.id)}
                              disabled={isPending}
                              title={`Move to ${oc.name}`}
                              style={{
                                fontSize: '0.7rem', padding: '0.2rem 0.4rem',
                                background: CLASS_BG[oc.name] ?? 'var(--cream)',
                                color: CLASS_COLORS[oc.name] ?? 'var(--text)',
                                border: `1px solid ${CLASS_COLORS[oc.name] ?? 'var(--border)'}`,
                                borderRadius: '4px', cursor: 'pointer', fontWeight: 600,
                              }}
                            >
                              → {oc.name}
                            </button>
                          ))}
                          {/* Remove */}
                          <button
                            onClick={() => handleRemove(shift.id)}
                            disabled={isPending}
                            title="Remove assignment"
                            style={{
                              fontSize: '0.75rem', padding: '0.2rem 0.45rem',
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              borderRadius: '4px', cursor: 'pointer',
                              color: 'var(--danger)',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* Note (if any) */}
                      {hasNote && (
                        <div style={{
                          fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic',
                          marginTop: '0.3rem',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {avail!.notes}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Add Family */}
                {classEligible.length > 0 && (
                  <div style={{ marginTop: '0.35rem' }}>
                    <select
                      value=""
                      onChange={e => {
                        if (e.target.value) handleAdd(cls.id, e.target.value)
                      }}
                      disabled={isPending}
                      style={{
                        width: '100%', padding: '0.45rem 0.6rem',
                        background: 'var(--warm-white)', border: '1px dashed var(--border)',
                        borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="">+ Add family…</option>
                      {classEligible.map(fam => {
                        const conflict = hasConflictOnDay(fam.id)
                        const preferred = familyAvailability[fam.id]?.preferredDates.includes(date)
                        return (
                          <option key={fam.id} value={fam.id}>
                            {preferred ? '★ ' : ''}{fam.name}{conflict ? ' ⚠' : ''} ({fam.required - fam.assigned} left)
                          </option>
                        )
                      })}
                    </select>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        {(isPending || error) && (
          <div style={{
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid var(--border)',
            fontSize: '0.8rem',
            color: error ? 'var(--danger)' : 'var(--text-muted)',
          }}>
            {isPending ? 'Saving…' : error}
          </div>
        )}
      </div>
    </>
  )
}
```

### Step 7: Import the new actions

At the top of the file, add to the imports from `./actions`:

```typescript
import {
  reassignShiftAction,
  addShiftAction,
  removeAssignmentAction,
  moveShiftClassAction,
} from './actions'
```

Also import `computeConflictWarning` if not already imported:

```typescript
import { computeConflictWarning } from '@/lib/schedule-utils'
```

### Step 8: Wire the panel into the main component return

Remove the existing `{selectedShift && <ShiftReassignPanel ... />}` block.

Add the `DayManagementPanel` in its place:

```tsx
{selectedDay && (
  <DayManagementPanel
    date={selectedDay}
    classes={classes}
    dayShifts={shifts.filter(s => s.date === selectedDay)}
    familyStats={familyStats}
    familyAvailability={familyAvailability}
    conflictPairs={conflictPairs}
    onClose={() => setSelectedDay(null)}
  />
)}
```

### Step 9: Remove the `ShiftReassignPanel` component

Delete the entire `ShiftReassignPanel` function (it's no longer used).

### Step 10: TypeScript check + full tests

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

Expected: 0 errors, all tests pass.

### Step 11: Commit

```bash
git add "app/(admin)/admin/schedule/AdminScheduleCalendar.tsx"
git commit -m "feat: DayManagementPanel with add/remove/move; day-click trigger; unfilled slot warnings"
```

---

## Task 9: Show Availability Notes on Admin Family Detail

**Files:**
- Modify: `app/(admin)/admin/families/[id]/page.tsx`

**Step 1: Read the file** to find where availability data is displayed for a family.

**Step 2: Fetch notes in the availability query**

Find the query that fetches the family's availability submissions. Extend the select to include `notes`:

```typescript
supabase
  .from('availability')
  .select('period_month, available_dates, preferred_dates, notes, submitted_at')
  .eq('family_id', familyId)
  .order('period_month', { ascending: false })
```

**Step 3: Display notes in the availability list**

For each availability row that has a non-null, non-empty `notes` field, render it below the dates summary:

```tsx
{avail.notes && (
  <p style={{
    fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic',
    margin: '0.3rem 0 0',
  }}>
    📝 {avail.notes}
  </p>
)}
```

**Step 4: TypeScript check + tests**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

**Step 5: Commit**

```bash
git add "app/(admin)/admin/families/[id]/page.tsx"
git commit -m "feat: show availability notes on admin family detail page"
```

---

## Task 10: Final Verification

**Step 1: Full test suite**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm test
```

Expected: all tests pass. Report exact count.

**Step 2: TypeScript check**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node "node_modules/typescript/bin/tsc" --noEmit
```

Expected: 0 errors.

**Step 3: Build**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && npm run build
```

Expected: build succeeds, all pages compiled.

**Step 4: Git log**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && git log --oneline -10
```

Confirm a clean commit trail for all 9 preceding tasks.

**Step 5: Manual smoke-test checklist** (run against the dev server with `npm run dev`):

- [ ] Admin schedule: clicking a date number opens the Day Management Panel
- [ ] Panel shows all 3 classes with any assigned families
- [ ] ✕ Remove removes the assignment; the slot shows as "⚠ Unfilled"
- [ ] "→ Daisy" / "→ Rose" / "→ Azalea" buttons move a family to another class
- [ ] "+ Add family…" dropdown lists only eligible families; ★ prefix for families who prefer this day
- [ ] Day cells with unfilled slots show an amber ⚠ badge on the date number
- [ ] Parent availability form: 1st click = available (green), 2nd click = preferred (green + ★), 3rd click = unmarked
- [ ] Star count appears in the summary strip
- [ ] Notes textarea is present and saves
- [ ] After reloading the availability page, preferred dates and notes are pre-populated from DB
- [ ] Admin family detail page shows the notes line for months where notes were entered

**Step 6: Final commit if any cleanup needed**

```bash
git add -p   # stage only intentional changes
git commit -m "chore: final cleanup and smoke-test fixes"
```
