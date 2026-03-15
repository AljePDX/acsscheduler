# Class Constraints, Day Preference & Teacher Flags — Design

**Date:** 2026-03-15
**Status:** Approved

## Goal

Three connected improvements to the schedule proposal algorithm and admin family management:

1. **Class constraint** — parents are only assigned to their child's class (or any class if marked Flexible Teacher)
2. **Day preference** — parents are preferentially scheduled on days their children attend school; flagged when forced onto a non-attendance day
3. **Teacher flags** — two new admin-settable attributes on families: `is_flexible_teacher` and `is_assistant_teacher`

---

## Database Changes

### `families` table — two new columns

```sql
ALTER TABLE families
  ADD COLUMN is_flexible_teacher  boolean NOT NULL DEFAULT false,
  ADD COLUMN is_assistant_teacher boolean NOT NULL DEFAULT false;
```

- `is_flexible_teacher` — family can be assigned to any class, not just their child's
- `is_assistant_teacher` — family is deprioritised for extra shifts (scheduled last; higher cost to school)
- Both default to `false`; no existing records affected

### `shifts` table — one new column

```sql
ALTER TABLE shifts
  ADD COLUMN off_day_warning boolean NOT NULL DEFAULT false;
```

- Set to `true` when the algorithm assigns a parent on a date when **none** of their children attend school
- Behaves identically to `conflict_warning` in the admin UI

---

## Type Changes (`lib/types.ts`)

### `FamilyRow`

```typescript
export interface FamilyRow {
  // ... existing fields ...
  is_flexible_teacher: boolean   // ← ADD
  is_assistant_teacher: boolean  // ← ADD
}
```

### `ShiftRow`

```typescript
export interface ShiftRow {
  // ... existing fields ...
  off_day_warning: boolean       // ← ADD
}
```

### `ProposedShift` (`lib/schedule.ts`)

```typescript
export interface ProposedShift {
  date: string
  class_id: string
  family_id: string
  conflict_warning: boolean
  off_day_warning: boolean       // ← ADD
}
```

---

## Algorithm Changes (`lib/schedule.ts`)

### New input maps to build

**`familyClassIds`** — set of class IDs a family's children are enrolled in:
```typescript
const familyClassIds = new Map<string, Set<string>>()
for (const child of children) {
  if (!familyClassIds.has(child.family_id)) familyClassIds.set(child.family_id, new Set())
  familyClassIds.get(child.family_id)!.add(child.class_id)
}
```

**`familyAttendDates`** — school days in the month when **at least one** child attends (union):
```typescript
const familyAttendDates = new Map<string, Set<string>>()
```
For each school day, check each child's `days_of_week` (null = all 5 days). Map the day-of-week abbrev to the date and populate per family.

**`familyAllAttendDates`** — school days in the month when **all** children attend (intersection):
```typescript
const familyAllAttendDates = new Map<string, Set<string>>()
```
A date is in the intersection only if every child in the family attends on that day.

### Candidate filter — add class constraint

In the `.filter()` inside the greedy loop, add:

```typescript
// Class constraint: family must have a child in this class, OR be a flexible teacher
const flexibleFamily = families.find(f => f.id === f.id)?.is_flexible_teacher
if (!flexibleFamily) {
  const classIds = familyClassIds.get(f.id) ?? new Set()
  if (!classIds.has(cls.id)) return false
}
```

(Implementation note: `is_flexible_teacher` will be available directly on `FamilyRow` in the `schedulableFamilies` array.)

### Updated sort order

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

### Updated pick logic — day-preference tiers

Replace the current two-line pick:

```typescript
const conflictFree = candidates.filter(...)
const pick = conflictFree[0] ?? candidates[0]
```

With tier-aware pick:

```typescript
const conflictFree = candidates.filter(f => {
  const fConflicts = conflictMap.get(f.id) ?? new Set<string>()
  return !assignedOnThisDate.some(otherId => fConflicts.has(otherId))
})
const pool = conflictFree.length > 0 ? conflictFree : candidates

// Tier 1: all children attend this date
const allAttendPool = pool.filter(f => familyAllAttendDates.get(f.id)?.has(date))
// Tier 2: at least one child attends
const anyAttendPool = pool.filter(f => familyAttendDates.get(f.id)?.has(date))

const pick = allAttendPool[0] ?? anyAttendPool[0] ?? pool[0]
const offDayWarning = pick
  ? !(familyAttendDates.get(pick.id)?.has(date) ?? false)
  : false
```

`off_day_warning` is `true` only when the picked family has **no** children attending on that date (Tier 3 fallback).

---

## Admin UI Changes

### Families edit form (`app/(admin)/admin/families/[id]/page.tsx`)

Two new checkboxes in the family edit section:
- ☐ **Flexible Teacher** — "Can be assigned to any class, not just their child's"
- ☐ **Assistant Teacher** — "Scheduled for extra shifts last (higher cost to school)"

Admin-only. Never exposed to parent-facing pages or APIs.

### Families list (`app/(admin)/admin/families/page.tsx`)

Two new muted pill badges per family row:
- `FT` — Flexible Teacher
- `AT` — Assistant Teacher

Shown in `var(--sage-light)` / `var(--text-muted)` style (informational, not warning).

### Admin schedule view (`AdminScheduleCalendar.tsx`)

`off_day_warning` mirrors `conflict_warning` throughout:
- Amber ⚠ badge on date cells (MonthView + WeekView) when any shift has `off_day_warning`
- Warning banner at top: "N shifts scheduled on non-attendance days — review before publishing"
- Must be explicitly dismissed before Publish is active
- In Day Management Panel: assigned family row shows ⚠ badge with tooltip "Scheduled on a non-attendance day"

### Admin schedule `page.tsx`

`off_day_warning` included when enriching shifts (same pattern as `conflict_warning`).

---

## What Does NOT Change

- Shift requirements (families still owe the same number of shifts regardless of attendance constraints)
- The conflict-pair system (unchanged; `conflict_warning` is independent of `off_day_warning`)
- Parent-facing UI (parents never see teacher flags or off-day warnings)
- Drop-in logic (unaffected)
- RLS policies (no new tables; new columns inherit existing table policies)
