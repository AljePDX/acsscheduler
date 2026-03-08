# Design: Admin Day Panel · Preferred Dates · Availability Notes
**Date:** 2026-03-08
**Status:** Approved

---

## Overview

Three interconnected features:

1. **Admin Day Management Panel** — clicking any day on the admin schedule opens a unified panel showing all three classes, with the ability to add, remove, and move families across classes for that day.
2. **Parent Preferred Dates** — parents can mark some of their available days as preferred; the scheduling algorithm prioritises them accordingly.
3. **Availability Notes** — a per-month freeform text field where parents can leave notes for the admin when submitting availability.

---

## 1. Database Changes

Single migration — two new columns on `availability`:

```sql
ALTER TABLE availability
  ADD COLUMN preferred_dates date[]  NOT NULL DEFAULT '{}',
  ADD COLUMN notes           text;
```

- `preferred_dates` is always a **subset** of `available_dates` — enforced by UI cycling logic, not a DB constraint.
- `notes` is nullable; `NULL` and empty string are treated identically in the UI.
- No changes to the `shifts` table. An "open slot" is a shift row where `family_id IS NULL`.

---

## 2. Algorithm Changes (`lib/schedule.ts`)

### New candidate sort order (replaces "most remaining quota first")

When selecting which family to assign to an open slot, rank eligible candidates by:

| Priority | Metric | Direction |
|----------|--------|-----------|
| 1st | Slack = `available_days − required_shifts` | Ascending (0 slack = most urgent) |
| 2nd | Required shifts remaining | Descending (more owed = harder to satisfy later) |
| 3rd | Is this date in the family's `preferred_dates`? | Yes before No |
| 4th | (Implicitly last) Flexible families (high slack) | Fall to bottom via #1 |

**Rationale:** A family with 7 available days and 7 required shifts (0 slack) must be scheduled before one with 5 available and 5 required (also 0 slack but fewer total obligations). The algorithm must fill the most constrained families first to avoid leaving them with no valid slots later.

### Data access
The algorithm already loads the full `availability` table. It now also reads `preferred_dates` from each row. The `availMap` already gives `available_days` count via `.size`. No new DB queries needed.

### Conflict avoidance
Unchanged: conflict avoidance remains a soft preference (family pairs are preferred apart; warnings are set but never block assignment).

---

## 3. Parent Availability Form

### Preferred date interaction (`AvailabilityCalendar.tsx`)

Single-click cycles through three states:

```
Unmarked → Available (sage green) → Preferred (sage green + ★) → Unmarked
```

- New state: `preferredDates: Set<string>` alongside existing `availableDates`.
- Any date in `preferredDates` is also in `availableDates` — enforced in the toggle handler.
- If a date is removed from `availableDates` (cycled back to unmarked), it is also removed from `preferredDates`.

### Visual treatment
- Available dates: existing sage green fill.
- Preferred dates: sage green fill **+ a ★ star badge** in the top-right corner of the date cell.
- The summary strip below the calendar gains a ★ `{preferredDates.size} preferred` count.

### Notes field
- A `<textarea>` below the calendar, full-width.
- Label: **"Notes for the scheduler (optional)"**
- Placeholder: *"e.g. I'm free any day but prefer mornings."*
- Per-month — one note per availability submission.
- Submitted alongside `available_dates`, `preferred_dates`, and `planned_absences`.

### Submit action (`submitAvailabilityAction`)
Updated to accept and persist `preferredDates: string[]` and `notes: string | null`.

---

## 4. Admin Day Management Panel

### Trigger
Clicking the **date number/header** in either MonthView or WeekView opens the `DayManagementPanel`. This replaces the current `ShiftReassignPanel` (which was chip-click only). The panel is a fixed right-side drawer (same position and z-index as the existing panel).

### Panel structure

**Header**
- Formatted date (e.g. "Wednesday, March 11")
- Close button (×)

**Three class sections** (Rose · Daisy · Azalea), each containing:

*For each assigned family on that class/day:*
- Family name
- ★ if this date is in that family's `preferred_dates`
- Their `notes` (italic, 1-line truncated with ellipsis) if non-empty
- **✕ Remove** button → calls `removeAssignmentAction(shiftId)` — sets `family_id = NULL`, shift row remains
- **Move to →** button → opens a sub-dropdown of the other two classes; calls `moveShiftClassAction(shiftId, newClassId)`

*At the bottom of each class section:*
- **+ Add Family** dropdown → lists eligible families only:
  - Submitted availability for this month
  - Marked this date as available
  - Not already assigned elsewhere on this date
  - Has shifts remaining in their quota
  - Shown with conflict ⚠ indicator if they would conflict with another family already on this day (still selectable)
- Selecting a family calls `addShiftAction(date, classId, familyId)`

*Unfilled slots* — if a class has a shift row with `family_id = NULL` (or needs coverage but has zero rows), that class section shows an amber "⚠ Unfilled — needs a volunteer" placeholder.

### Calendar-level unfilled warning
In both MonthView and WeekView, any day with at least one unfilled slot shows an amber **⚠** badge on the date number itself. This is distinct from the existing conflict badge and can coexist with it.

### Admin visibility of preferred dates and notes
- When a family is listed in the Day Panel, a ★ appears next to their name if this day was one of their preferred dates.
- Their `notes` are shown below their name in italic (if non-empty).
- Notes also appear on the Admin > Families detail page when viewing a family's availability record.

---

## 5. New Server Actions (`app/(admin)/admin/schedule/actions.ts`)

| Action | Signature | Effect |
|--------|-----------|--------|
| `addShiftAction` | `(date: string, classId: string, familyId: string)` | Inserts a new shift row (`status: 'proposed'`), computes `conflict_warning` |
| `removeAssignmentAction` | `(shiftId: string)` | Sets `family_id = NULL` on the shift row |
| `moveShiftClassAction` | `(shiftId: string, newClassId: string)` | Updates `class_id`, recomputes `conflict_warning` |
| `reassignShiftAction` | (existing — unchanged) | Still used internally by the Day Panel for swap-one-for-another |

---

## 6. Data Flow for Day Panel

The page (`app/(admin)/admin/schedule/page.tsx`) already fetches all shifts, families, classes, and conflict pairs. It needs two additions:

- Fetch `availability.preferred_dates` and `availability.notes` for the displayed month → build a map `familyId → { preferredDates: Set<string>, notes: string | null }`.
- Pass this map (as `familyAvailability`) down to `AdminScheduleCalendar` → `DayManagementPanel`.

The "eligible families" list for "+ Add Family" is computed client-side from the `familyStats` + `familyAvailability` data already passed to the component.

---

## 7. Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/0012_availability_preferred_notes.sql` | New migration |
| `lib/types.ts` | Add `preferred_dates` and `notes` to `AvailabilityRow` |
| `lib/schedule.ts` | New candidate sort order; read `preferred_dates` |
| `lib/schedule.ts` (tests) | Update / add unit tests for new sort logic |
| `components/parent/AvailabilityCalendar.tsx` | Preferred date cycling, ★ visual, notes textarea |
| `app/(parent)/parent/availability/actions.ts` | Accept and persist `preferred_dates` + `notes` |
| `app/(admin)/admin/schedule/AdminScheduleCalendar.tsx` | Replace `ShiftReassignPanel` with `DayManagementPanel`; day-click trigger; unfilled slot warning badges |
| `app/(admin)/admin/schedule/actions.ts` | Three new server actions |
| `app/(admin)/admin/schedule/page.tsx` | Fetch `familyAvailability` map; pass to calendar |
| `app/(admin)/admin/families/[id]/page.tsx` | Show availability notes on family detail |
