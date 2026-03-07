# Design: Schedule Editing, Drop-in Rebuild, Availability Editing
**Date:** 2026-03-07
**Status:** Approved

---

## Feature 1 — Admin Shift Reassignment

### Problem
After "Propose Schedule" runs, the admin has no way to move individual shift assignments. The only options are re-run the algorithm or publish as-is.

### Design

**Trigger:** Every shift chip in the admin schedule calendar becomes clickable.

**Panel:** Clicking a chip opens a slide-out panel (desktop) or bottom sheet (mobile) showing:
- Shift metadata: date, class (with class color accent), currently assigned family
- Scrollable list of **all families**, sorted **alphabetically by family name**
- Each family row shows: `Family Name · X required · Y assigned · Z remaining`
  - `required` = `getRequiredShifts()` result for that family's children
  - `assigned` = count of proposed/confirmed shifts in this month for that family
  - `remaining` = required − assigned
- Families with a conflict warning on that specific date get an ⚠ amber badge
- Currently assigned family is highlighted / pre-selected
- "Save" button reassigns the shift; "Cancel" closes without changes

**New server action:** `reassignShiftAction(shiftId, newFamilyId)`
- Verifies admin role
- Loads the shift + both families' conflicts
- Updates `shifts.family_id = newFamilyId`
- Recomputes `conflict_warning` (checks if new family conflicts with any other family on that day)
- Calls `revalidatePath('/admin/schedule')`
- Returns `{ error? }`

**No DB migration needed.**

---

## Feature 2 — Drop-in Availability Rebuild + Admin Settings Page

### 2a — Parent Drop-in Page Rebuild

**Problem:** Parents can only submit requests blindly — no visibility into which dates actually have open slots.

**Design:**

New "Available Dates" section above the request form, showing every date in the current and next month where ≥1 class has an open drop-in slot.

Calculated server-side on page load using `isDropinAvailable()` from `lib/dropins.ts`. Data fetched:
- All children (enrolled per class, with `days_of_week`)
- `availability.planned_absences` for the month (to know which children are absent on which dates)
- Existing approved `dropin_requests` counts per `{class_id, date}`
- Holidays
- Class ratios

Display: grouped list of available dates, each entry showing:
- Date (formatted: "Mon, Apr 7")
- Class name with class color badge
- Drop-in fee
- "Request" button → pre-fills the request form below with that date + class

If no slots are open this month: empty state message.

**No DB migration needed.**

### 2b — Admin Drop-in Monthly View

New section on `/admin/dropins` (above the pending requests list): a monthly grid showing each school day.

Each day cell shows per-class capacity:
- `Rose: 1 open` / `Rose: Full` / `Rose: —` (no absences that day)
- Color coded: open = azalea-light, full = border/muted, no data = empty

Clicking a day cell expands to show:
- Which children have planned absences (count only, no names)
- How many drop-ins are already approved
- Any pending drop-in requests for that day

**No DB migration needed.**

### 2c — Admin Financial Settings Page

**New page:** `/admin/settings`

**New DB migration:** Add two columns to `school_settings`:
```sql
ALTER TABLE school_settings
  ADD COLUMN missed_shift_fee    DECIMAL DEFAULT 0,
  ADD COLUMN extra_shift_credit  DECIMAL DEFAULT 0;
```

**Page layout:** Simple form with four fee fields:
| Field | DB Column | Description |
|---|---|---|
| Drop-in fee | `dropin_fee` | Flat fee charged per drop-in day |
| Buyout amount | `buyout_amount_per_shift` | Cost to buy out a scheduled shift or makeup debt |
| Missed shift fee | `missed_shift_fee` | Fee charged when a shift is marked missed |
| Extra shift credit | `extra_shift_credit` | Credit earned for completing a shift beyond requirement |

Each field: labeled currency input, inline save button or single "Save Settings" button at bottom.

Server action: `updateSchoolSettingsAction(data)` — admin only, updates the single row (`id = 1`), returns `{ error? }`.

---

## Feature 3 — Editable Availability with Change Tracking

### Problem
Parents have no clear affordance to edit submitted availability, and admin has no visibility when a parent changes their submission after the fact.

### Design

**UI — Read-only mode (when submission exists):**
- Availability page shows a summary of the existing submission: volunteer days count, absences per child
- "Edit Availability" button in the top-right of the section
- Clicking "Edit" switches to full calendar edit mode (same UI as first submission)
- Save button label becomes "Save Changes"

**UI — First submission:**
- Same as today — no change

**Server action changes to `submitAvailabilityAction`:**
1. Before upserting, fetch the existing row for this `{family_id, period_month}`
2. If an existing row is found → compute diff:
   - Added available dates: dates in new set but not old
   - Removed available dates: dates in old set but not new
   - Added absences: `{child_id, date}` pairs in new but not old
   - Removed absences: pairs in old but not new
3. Upsert the new values (existing logic, unchanged)
4. If diff is non-empty → send admin in-app notification:
   - Title: `"[Family] updated their [Month] availability"`
   - Body: `"3 dates added, 1 date removed, 2 absences added"` (summary only — no specific dates in notification)
5. First-time submissions do **not** trigger a notification

**No DB migration needed.** Diff computed in-memory at action time.

---

## Files Touched Summary

| File | Change |
|---|---|
| `supabase/migrations/0011_school_settings_fees.sql` | New: add missed_shift_fee + extra_shift_credit |
| `lib/types.ts` | Add new fields to SchoolSettingsRow |
| `app/(admin)/admin/schedule/actions.ts` | Add reassignShiftAction |
| `app/(admin)/admin/schedule/AdminScheduleCalendar.tsx` | Clickable chips + shift panel |
| `app/(admin)/admin/settings/page.tsx` | New settings page |
| `app/(admin)/admin/settings/actions.ts` | New updateSchoolSettingsAction |
| `app/(parent)/parent/dropins/page.tsx` | Add available dates section |
| `app/(admin)/admin/dropins/page.tsx` | Add monthly capacity grid |
| `app/(parent)/parent/availability/actions.ts` | Diff + admin notification on edit |
| `components/parent/AvailabilityCalendar.tsx` | Edit mode toggle + "Save Changes" label |
| `tests/unit/schedule-reassign.test.ts` | New unit tests |
| `tests/unit/dropins-availability.test.ts` | New unit tests |
| `tests/unit/availability-diff.test.ts` | New unit tests |
