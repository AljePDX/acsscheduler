# Design: Extra Shift Willingness, Swap Flow Redesign & Availability Reminders

**Date:** 2026-03-05
**Status:** Approved

---

## Overview

Three related features that improve the monthly volunteer scheduling workflow:

1. **Extra shift willingness** — parents indicate how many extra shifts they can take in a month; this feeds into swap matching.
2. **Swap flow redesign** — admin (not the requesting parent) selects the covering family; parent only submits a reason.
3. **Availability reminder emails** — admin-triggered button that emails all families who have not yet submitted availability for the upcoming month.

---

## Feature 1: Extra Shift Willingness

### Schema

New column on `availability`:

```sql
ALTER TABLE availability
  ADD COLUMN extra_shifts_willing TEXT NOT NULL DEFAULT '0'
    CHECK (extra_shifts_willing IN ('0', '1-2', '3-4', '5+'));
```

### UI

- **Location:** Top of the parent availability form (`/parent/availability`), above the calendar, labeled *"How many extra shifts are you willing to take this month?"*
- **Control:** Dropdown (select)
- **Options:**
  - "None (just my required shifts)" → stored as `'0'` (default)
  - "1–2 extra" → `'1-2'`
  - "3–4 extra" → `'3-4'`
  - "5 or more" → `'5+'`

### Data Flow

- Value is submitted alongside available dates in the existing `submitAvailabilityAction`.
- Stored in `availability.extra_shifts_willing`.
- Fetched by admin swap review page to sort eligible covering families.

---

## Feature 2: Swap Flow Redesign

### What Changes

**Old flow:**
1. Parent A selects a covering family from an availability-filtered list
2. Covering family accepts/declines
3. Admin approves

**New flow:**
1. Parent A submits swap request with optional reason → admin notified
2. Admin reviews open requests; sees sorted eligible families; selects one and approves (or rejects)
3. Both families notified of outcome

### Status Usage

The existing `swap_requests.status` enum (`open, pending_covering_approval, pending_admin, approved, rejected`) is unchanged in the DB. Application code uses only three values going forward:

| Status | Meaning |
|---|---|
| `open` | Parent submitted; awaiting admin action |
| `approved` | Admin selected covering family and approved |
| `rejected` | Admin rejected the request |

`pending_covering_approval` and `pending_admin` become unused legacy values.

### Eligible Family Sorting (Admin View)

When admin opens a swap request, the covering family picker shows families sorted as:

**Group 1 — "Available & willing to work extra"**
Families who submitted availability covering the shift date AND have `extra_shifts_willing != '0'`.
Sorted within the group: `'5+'` first, then `'3-4'`, then `'1-2'`, then alphabetically.

**Group 2 — "Available"**
Families who submitted availability covering the shift date but have `extra_shifts_willing = '0'` or did not submit availability for that month.
Sorted alphabetically.

Each family card in the list shows:
- Family name
- Extra shift willingness label
- Count of confirmed shifts they have this month (so admin can see who is already loaded)
- Conflict warning icon if a `family_conflicts` row exists between this family and the requesting family (admin can still select; consistent with existing conflict policy — never block, always warn)

### Admin Action

- **"Approve & Assign"** button: sets `swap_requests.covering_family_id`, sets `status = 'approved'`, updates `shifts.family_id` to covering family, creates `makeup_debts` record for requesting family, notifies both families.
- **"Reject"** button: sets `status = 'rejected'`, notifies requesting family.

### Notification Changes

| Event | Old notification target | New notification target |
|---|---|---|
| Swap request submitted | Selected covering family | Admin |
| Swap approved | Both families | Both families (unchanged) |
| Swap rejected | Requesting family | Requesting family (unchanged) |

---

## Feature 3: Availability Reminder Emails

### UI

**Location:** Admin dashboard or dedicated admin availability section.

**Display:**
- Header: *"[Month] Availability"*
- Progress: *"18 of 34 families have submitted"* with a simple progress bar
- Button: **"Send Reminder to 16 Families"** — count updates to reflect current unsubmitted count

The button is always enabled; clicking it multiple times sends multiple reminders (intentional — admin controls timing: day 1, 7, 9, 10 of month pattern is guidance, not system-enforced).

### Data Flow

1. Admin clicks "Send Reminder"
2. Server action:
   a. Determines target month (next calendar month from today, or current month if before the 15th — configurable)
   b. Queries `availability` where `period_month = target_month_start` → gets set of submitted `family_id`s
   c. Queries `families` for all records → subtracts submitted set → gets unsubmitted families
   d. For each unsubmitted family, sends Resend email to `families.email`
   e. Collects successes and failures
3. Returns `{ sent: number, skipped: number }` to client
   - `skipped` = families with no email address
4. Admin sees toast: *"Reminders sent to 14 families (2 skipped — no email on file)"*

### Email Content

- Subject: *"[School Name]: Please submit your [Month] availability"*
- Body: brief reminder with a direct link to `/parent/availability`
- Sent individually per family (not BCC batch) for deliverability

### Error Handling

- Resend failures are per-email — one failure does not block others
- Aggregate result returned: `{ sent, skipped, failed }` where `failed` = Resend API errors
- No retry logic in v1; admin can click the button again if needed

---

## Testing Plan

### Unit Tests
- `validateExtraShiftsWilling()` — valid values pass, invalid values rejected
- Swap eligible family sort function — correct group ordering with mixed data
- Reminder target month calculation — correct month selected based on current date

### E2E Tests
- Parent submits availability with extra shifts dropdown → value persisted and displayed on re-open
- Parent submits swap request → admin sees it in open queue
- Admin approves swap → both families show updated shift assignments
- Admin reminder button → sends to unsubmitted families only, toast shows correct count

---

## Files Affected (expected)

| File | Change |
|---|---|
| `supabase/migrations/0009_availability_extra_shifts.sql` | New column |
| `lib/types.ts` | Update `AvailabilityRow` |
| `app/(parent)/parent/availability/actions.ts` | Include `extra_shifts_willing` in submit action |
| `components/parent/AvailabilityCalendar.tsx` or availability form | Add dropdown UI |
| `app/(admin)/admin/swaps/page.tsx` | Redesigned swap review UI |
| `app/(admin)/admin/swaps/[id]/page.tsx` | New detail page with family picker |
| `app/(admin)/admin/swaps/actions.ts` | `approveSwapAction`, `rejectSwapAction` |
| `app/(admin)/admin/dashboard/page.tsx` or availability page | Reminder button + submission count |
| `app/(admin)/admin/availability/actions.ts` | `sendAvailabilityRemindersAction` |
| `lib/notifications.ts` (new or existing) | Resend email helpers |
