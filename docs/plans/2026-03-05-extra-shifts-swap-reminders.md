# Extra Shifts, Swap Redesign & Availability Reminders — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add extra-shift willingness to the availability form, redesign swap flow so admin selects the covering family, and add an admin-triggered reminder email button.

**Architecture:** Three loosely coupled features sharing one DB migration. Extra shifts willingness is a new column on `availability`. Swap flow changes are isolated to parent swaps pages (new) and admin swaps actions (modified). Reminder is a new server action + dashboard UI section. No new tables needed.

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL), Resend (email), `lib/notifications.ts` + `lib/email.ts` (already set up).

---

## Task 1: DB Migration — extra_shifts_willing column

**Files:**
- Create: `supabase/migrations/0009_availability_extra_shifts.sql`

**Step 1: Create the migration file**

```sql
-- supabase/migrations/0009_availability_extra_shifts.sql

ALTER TABLE availability
  ADD COLUMN extra_shifts_willing TEXT NOT NULL DEFAULT '0'
    CHECK (extra_shifts_willing IN ('0', '1-2', '3-4', '5+'));

COMMENT ON COLUMN availability.extra_shifts_willing IS
  'How many extra shifts (beyond required) the family is willing to take this month.
   Values: 0 = none, 1-2 = one or two, 3-4 = three or four, 5+ = five or more.';
```

**Step 2: Apply the migration**

```bash
# In the bloom project root:
npx supabase db push
```
Expected: migration runs without error.

**Step 3: Verify**

In Supabase dashboard (or via psql), confirm `availability` table has `extra_shifts_willing TEXT NOT NULL DEFAULT '0'`.

**Step 4: Commit**

```bash
git add supabase/migrations/0009_availability_extra_shifts.sql
git commit -m "feat(db): add extra_shifts_willing to availability table"
```

---

## Task 2: Update TypeScript Types

**Files:**
- Modify: `lib/types.ts` (AvailabilityRow interface, ~line 87–94)

**Step 1: Add `extra_shifts_willing` to AvailabilityRow**

Find the `AvailabilityRow` interface and add the field:

```typescript
export interface AvailabilityRow {
  id: string
  family_id: string
  period_month: string // ISO date string: first day of month
  available_dates: string[] // ISO date strings
  planned_absences: PlannedAbsence[]
  extra_shifts_willing: '0' | '1-2' | '3-4' | '5+'
  submitted_at: string
}
```

**Step 2: Add helper type for willingness values**

After the AvailabilityRow interface, add:

```typescript
export type ExtraShiftsWilling = '0' | '1-2' | '3-4' | '5+'

/** Sort rank for extra shift willingness — higher = more willing. */
export const EXTRA_SHIFTS_RANK: Record<ExtraShiftsWilling, number> = {
  '5+': 4,
  '3-4': 3,
  '1-2': 2,
  '0':  1,
}
```

**Step 3: Run TypeScript check**

```bash
node "node_modules/typescript/bin/tsc" --noEmit
```
Expected: no errors introduced.

**Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add extra_shifts_willing to AvailabilityRow"
```

---

## Task 3: Update submitAvailabilityAction

**Files:**
- Modify: `app/(parent)/parent/availability/actions.ts`

**Step 1: Add `extraShiftsWilling` parameter to the function signature**

Change:
```typescript
export async function submitAvailabilityAction(
  familyId: string,
  periodMonth: string,
  availableDates: string[],
  plannedAbsences: PlannedAbsenceInput[]
): Promise<{ error?: string; success?: boolean }>
```

To:
```typescript
export async function submitAvailabilityAction(
  familyId: string,
  periodMonth: string,
  availableDates: string[],
  plannedAbsences: PlannedAbsenceInput[],
  extraShiftsWilling: string = '0'
): Promise<{ error?: string; success?: boolean }>
```

**Step 2: Add validation**

After the periodMonth format check, add:
```typescript
const VALID_WILLINGNESS = ['0', '1-2', '3-4', '5+']
if (!VALID_WILLINGNESS.includes(extraShiftsWilling)) {
  return { error: 'Invalid extra shifts willingness value.' }
}
```

**Step 3: Include in upsert payload**

In the upsert object, add `extra_shifts_willing: extraShiftsWilling`:
```typescript
const { error } = await (supabase.from('availability') as any).upsert(
  {
    family_id: familyId,
    period_month: periodMonth,
    available_dates: availableDates,
    planned_absences: plannedAbsences,
    extra_shifts_willing: extraShiftsWilling,
  },
  { onConflict: 'family_id,period_month' }
)
```

**Step 4: Run TypeScript check**

```bash
node "node_modules/typescript/bin/tsc" --noEmit
```

**Step 5: Commit**

```bash
git add app/\(parent\)/parent/availability/actions.ts
git commit -m "feat(availability): accept extra_shifts_willing in submit action"
```

---

## Task 4: Update Availability Page — fetch & pass existing willingness

**Files:**
- Modify: `app/(parent)/parent/availability/page.tsx`

**Step 1: Fetch `extra_shifts_willing` in the existing availability query**

Find the `availRes` query (around line 93–99). Change the select to include the new field:
```typescript
supabase
  .from('availability')
  .select('available_dates, planned_absences, extra_shifts_willing')
  .eq('family_id', familyId)
  .eq('period_month', periodMonth)
  .returns<{
    available_dates: string[]
    planned_absences: PlannedAbsence[]
    extra_shifts_willing: string
  }[]>()
  .maybeSingle(),
```

**Step 2: Extract the value into a variable**

After the parallel fetch block (after line 112):
```typescript
// existing:
initialAvailableDates = availRes.data?.available_dates ?? []
initialAbsences = (availRes.data?.planned_absences as PlannedAbsence[]) ?? []
// ADD:
initialExtraShiftsWilling = availRes.data?.extra_shifts_willing ?? '0'
```

Also add `let initialExtraShiftsWilling = '0'` to the variable declarations at the top of the try block.

**Step 3: Pass the prop to AvailabilityCalendar**

```tsx
<AvailabilityCalendar
  year={targetYear}
  month={targetMonth}
  familyId={familyId}
  familyChildren={children}
  holidayDates={holidayDates}
  initialAvailableDates={initialAvailableDates}
  initialAbsences={initialAbsences}
  requiredShifts={requiredShifts}
  initialExtraShiftsWilling={initialExtraShiftsWilling}
/>
```

**Step 4: Commit**

```bash
git add app/\(parent\)/parent/availability/page.tsx
git commit -m "feat(availability): fetch and forward extra_shifts_willing to calendar"
```

---

## Task 5: Add Extra Shifts Dropdown to AvailabilityCalendar Component

**Files:**
- Modify: `components/parent/AvailabilityCalendar.tsx`

**Step 1: Add `initialExtraShiftsWilling` to the props interface**

Find the component's props interface (near the top). Add:
```typescript
initialExtraShiftsWilling?: string
```

**Step 2: Add state for the dropdown**

Inside the component, add:
```typescript
const [extraShiftsWilling, setExtraShiftsWilling] = useState<string>(
  initialExtraShiftsWilling ?? '0'
)
```

**Step 3: Add the dropdown UI above the calendar**

Place this JSX block immediately above the calendar month grid (before the existing `<div>` that renders the days-of-week header). Use the same inline-style approach used throughout the component:

```tsx
{/* ── Extra shift willingness ───────────────────────────────────────────── */}
<div style={{ marginBottom: '1.25rem' }}>
  <label
    htmlFor="extra-shifts"
    style={{
      display: 'block',
      fontSize: '0.75rem',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: 'var(--text-muted)',
      marginBottom: '0.5rem',
    }}
  >
    Extra shifts this month
  </label>
  <select
    id="extra-shifts"
    value={extraShiftsWilling}
    onChange={e => setExtraShiftsWilling(e.target.value)}
    style={{
      width: '100%',
      padding: '0.6rem 0.75rem',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      background: 'var(--warm-white)',
      color: 'var(--text)',
      fontSize: '0.9rem',
      appearance: 'auto',
    }}
  >
    <option value="0">None — just my required shifts</option>
    <option value="1-2">1–2 extra shifts</option>
    <option value="3-4">3–4 extra shifts</option>
    <option value="5+">5 or more extra shifts</option>
  </select>
  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
    This helps us match volunteers when families request swaps.
  </p>
</div>
```

**Step 4: Pass `extraShiftsWilling` to the submit action**

Find the existing `handleSave` or submit handler inside the component that calls `submitAvailabilityAction`. Add `extraShiftsWilling` as the 5th argument:

```typescript
const result = await submitAvailabilityAction(
  familyId!,
  periodMonth,
  availableDates,
  plannedAbsences,
  extraShiftsWilling,   // ← add this
)
```

**Step 5: Run TypeScript check and verify build**

```bash
node "node_modules/typescript/bin/tsc" --noEmit
npm run build
```
Expected: 0 errors, all pages compiled.

**Step 6: Commit**

```bash
git add components/parent/AvailabilityCalendar.tsx
git commit -m "feat(availability): add extra shifts willingness dropdown"
```

---

## Task 6: Create Parent Swap Request Server Actions

**Files:**
- Create: `app/(parent)/parent/swaps/actions.ts`

**Step 1: Create the file**

```typescript
'use server'

/**
 * Parent swap request server actions.
 *
 * requestSwapAction — creates a new swap_request with status='open'.
 * cancelSwapAction  — cancels an open swap request (before admin acts on it).
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { notifyAdmins } from '@/lib/notifications'

// ── Shared helper ─────────────────────────────────────────────────────────────

async function getParentFamily() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userRow } = await supabase
    .from('users')
    .select('family_id')
    .eq('id', user.id)
    .returns<{ family_id: string | null }[]>()
    .maybeSingle()

  const familyId = userRow?.family_id
  if (!familyId) return null
  return { supabase, familyId }
}

// ── Request a swap ────────────────────────────────────────────────────────────

export async function requestSwapAction(
  shiftId: string,
  reason: string
): Promise<{ error?: string }> {
  const ctx = await getParentFamily()
  if (!ctx) return { error: 'No family account linked.' }

  // Verify the shift belongs to this family and is in a swappable state
  const { data: shift } = await ctx.supabase
    .from('shifts')
    .select('id, date, class_id, status, family_id')
    .eq('id', shiftId)
    .eq('family_id', ctx.familyId)
    .returns<{ id: string; date: string; class_id: string; status: string; family_id: string }[]>()
    .maybeSingle()

  if (!shift) return { error: 'Shift not found or does not belong to your family.' }
  if (!['proposed', 'confirmed'].includes(shift.status)) {
    return { error: 'Only proposed or confirmed shifts can be swapped.' }
  }

  // Check for an existing open swap request on this shift
  const { data: existing } = await ctx.supabase
    .from('swap_requests')
    .select('id')
    .eq('shift_id', shiftId)
    .in('status', ['open', 'pending_covering_approval', 'pending_admin'])
    .returns<{ id: string }[]>()
    .maybeSingle()

  if (existing) return { error: 'A swap request already exists for this shift.' }

  // Create the swap request
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase.from('swap_requests') as any).insert({
    shift_id: shiftId,
    requesting_family_id: ctx.familyId,
    covering_family_id: null,
    reason: reason.trim() || null,
    status: 'open',
  })

  if (error) return { error: error.message }

  // Notify all admins — non-blocking
  try {
    await notifyAdmins(ctx.supabase, {
      title: 'Swap Request Submitted',
      message: `A family has requested a swap for their ${shift.date} shift. Please review and assign a covering family.`,
      type: 'swap',
      link: '/admin/swaps',
    })
  } catch (err) {
    console.error('[requestSwapAction] Admin notify error (non-fatal):', err)
  }

  revalidatePath('/parent/swaps')
  return {}
}

// ── Cancel a swap request ─────────────────────────────────────────────────────

export async function cancelSwapAction(swapId: string): Promise<{ error?: string }> {
  const ctx = await getParentFamily()
  if (!ctx) return { error: 'No family account linked.' }

  // Verify the swap belongs to this family and is still open
  const { data: swap } = await ctx.supabase
    .from('swap_requests')
    .select('id, status, requesting_family_id')
    .eq('id', swapId)
    .eq('requesting_family_id', ctx.familyId)
    .returns<{ id: string; status: string; requesting_family_id: string }[]>()
    .maybeSingle()

  if (!swap) return { error: 'Swap request not found.' }
  if (swap.status !== 'open') return { error: 'Only open swap requests can be cancelled.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ctx.supabase.from('swap_requests') as any)
    .update({ status: 'rejected' })
    .eq('id', swapId)

  revalidatePath('/parent/swaps')
  return {}
}
```

**Step 2: Run TypeScript check**

```bash
node "node_modules/typescript/bin/tsc" --noEmit
```

**Step 3: Commit**

```bash
git add app/\(parent\)/parent/swaps/actions.ts
git commit -m "feat(swaps): add parent requestSwapAction and cancelSwapAction"
```

---

## Task 7: Create Parent Swaps Page

**Files:**
- Create: `app/(parent)/parent/swaps/page.tsx`

**Step 1: Create the page**

```tsx
/**
 * Parent swaps page — /parent/swaps
 *
 * Shows the parent's upcoming shifts and any existing swap requests.
 * Parent selects a shift and provides a reason; admin selects the covering family.
 */

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestSwapAction, cancelSwapAction } from './actions'

// ── Types used client-side ────────────────────────────────────────────────────

interface Shift {
  id: string
  date: string
  class_name: string
  status: string
}

interface SwapRequest {
  id: string
  shift_date: string
  class_name: string
  reason: string | null
  status: string
  created_at: string
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    open: 'Pending admin review',
    approved: 'Approved',
    rejected: 'Rejected',
  }
  const colors: Record<string, { bg: string; text: string }> = {
    open:     { bg: 'var(--daisy-light)',   text: 'var(--daisy)' },
    approved: { bg: 'var(--sage-light)',    text: 'var(--sage-dark)' },
    rejected: { bg: 'var(--warning-light)', text: 'var(--warning)' },
  }
  const { bg, text } = colors[status] ?? { bg: 'var(--border)', text: 'var(--text-muted)' }
  return (
    <span style={{
      fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.06em', padding: '0.2rem 0.55rem',
      borderRadius: '999px', background: bg, color: text,
    }}>
      {labels[status] ?? status}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SwapsClient({
  shifts,
  swapRequests,
}: {
  shifts: Shift[]
  swapRequests: SwapRequest[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedShiftId, setSelectedShiftId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedShiftId) { setError('Please select a shift.'); return }
    setError(null)
    startTransition(async () => {
      const result = await requestSwapAction(selectedShiftId, reason)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        setSelectedShiftId('')
        setReason('')
        router.refresh()
      }
    })
  }

  function handleCancel(swapId: string) {
    startTransition(async () => {
      const result = await cancelSwapAction(swapId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const swappableShifts = shifts.filter(s => ['proposed', 'confirmed'].includes(s.status))
  const activeSwapShiftIds = new Set(
    swapRequests.filter(s => s.status === 'open').map(s => s.shift_date)
  )

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <h1 style={{
        fontFamily: 'var(--font-playfair), "Playfair Display", serif',
        fontSize: '1.5rem', fontWeight: 500, color: 'var(--text)',
        margin: '0 0 1.75rem',
      }}>
        Shift Swaps
      </h1>

      {/* ── Request form ───────────────────────────────────────────────────── */}
      <section style={{
        background: 'var(--warm-white)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '1.25rem', marginBottom: '1.75rem',
      }}>
        <h2 className="label-section" style={{ marginBottom: '1rem' }}>
          Request a Swap
        </h2>

        {success && (
          <div style={{
            padding: '0.75rem', borderRadius: '8px',
            background: 'var(--sage-light)', color: 'var(--sage-dark)',
            fontSize: '0.875rem', marginBottom: '1rem',
          }}>
            Swap request submitted! The administrator will review and assign a covering volunteer.
          </div>
        )}

        {error && (
          <div style={{
            padding: '0.75rem', borderRadius: '8px',
            background: 'var(--warning-light)', color: 'var(--warning)',
            fontSize: '0.875rem', marginBottom: '1rem',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block', fontSize: '0.78rem', fontWeight: 600,
              color: 'var(--text-muted)', marginBottom: '0.4rem',
            }}>
              Select shift to swap
            </label>
            <select
              value={selectedShiftId}
              onChange={e => setSelectedShiftId(e.target.value)}
              style={{
                width: '100%', padding: '0.6rem 0.75rem',
                border: '1px solid var(--border)', borderRadius: '8px',
                background: 'var(--warm-white)', color: 'var(--text)', fontSize: '0.9rem',
              }}
            >
              <option value="">— Choose a shift —</option>
              {swappableShifts.map(s => (
                <option
                  key={s.id}
                  value={s.id}
                  disabled={activeSwapShiftIds.has(s.date)}
                >
                  {s.date} · {s.class_name}
                  {activeSwapShiftIds.has(s.date) ? ' (swap already pending)' : ''}
                </option>
              ))}
            </select>
            {swappableShifts.length === 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                You have no upcoming shifts eligible for a swap.
              </p>
            )}
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block', fontSize: '0.78rem', fontWeight: 600,
              color: 'var(--text-muted)', marginBottom: '0.4rem',
            }}>
              Reason (optional)
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Family conflict, travel..."
              rows={2}
              style={{
                width: '100%', padding: '0.6rem 0.75rem',
                border: '1px solid var(--border)', borderRadius: '8px',
                background: 'var(--warm-white)', color: 'var(--text)',
                fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isPending || swappableShifts.length === 0}
            style={{
              background: 'var(--sage)', color: '#fff',
              border: 'none', borderRadius: '8px',
              padding: '0.6rem 1.25rem', fontSize: '0.9rem',
              fontWeight: 600, cursor: isPending ? 'not-allowed' : 'pointer',
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? 'Submitting…' : 'Submit Swap Request'}
          </button>
        </form>
      </section>

      {/* ── Existing swap requests ─────────────────────────────────────────── */}
      {swapRequests.length > 0 && (
        <section>
          <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
            Your Requests
          </h2>
          {swapRequests.map(sr => (
            <div key={sr.id} style={{
              padding: '0.85rem 0', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
            }}>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>
                  {sr.shift_date} · {sr.class_name}
                </div>
                {sr.reason && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {sr.reason}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                <StatusBadge status={sr.status} />
                {sr.status === 'open' && (
                  <button
                    onClick={() => handleCancel(sr.id)}
                    disabled={isPending}
                    style={{
                      fontSize: '0.78rem', color: 'var(--warning)', background: 'none',
                      border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600,
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
```

> **Note:** This page is a client component with data passed as props. The server-side data fetching goes in a separate server wrapper page (next step).

**Step 2: Create the server wrapper**

Since Next.js App Router server components can't directly pass fetched data to client components in the same file, create a thin server page:

Rename the file above to: `app/(parent)/parent/swaps/SwapsClient.tsx`
Then create `app/(parent)/parent/swaps/page.tsx`:

```tsx
/**
 * Server component wrapper for /parent/swaps.
 * Fetches shifts and swap requests; passes to SwapsClient.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SwapsClient from './SwapsClient'

export const metadata = { title: 'Swaps' }

export default async function SwapsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userRow } = await supabase
    .from('users')
    .select('family_id')
    .eq('id', user.id)
    .returns<{ family_id: string | null }[]>()
    .maybeSingle()

  const familyId = userRow?.family_id
  if (!familyId) redirect('/parent/settings')

  const today = new Date().toISOString().split('T')[0]

  const [shiftsRes, swapsRes] = await Promise.all([
    // Upcoming shifts eligible for swap
    supabase
      .from('shifts')
      .select('id, date, class_id, status, classes(name)')
      .eq('family_id', familyId)
      .in('status', ['proposed', 'confirmed'])
      .gte('date', today)
      .order('date', { ascending: true }),

    // All swap requests by this family (recent history)
    supabase
      .from('swap_requests')
      .select('id, status, reason, created_at, shifts(date, classes(name))')
      .eq('requesting_family_id', familyId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const shifts = (shiftsRes.data ?? []).map((s: any) => ({
    id: s.id,
    date: s.date,
    class_name: s.classes?.name ?? 'Unknown',
    status: s.status,
  }))

  const swapRequests = (swapsRes.data ?? []).map((sr: any) => ({
    id: sr.id,
    shift_date: sr.shifts?.date ?? '',
    class_name: sr.shifts?.classes?.name ?? 'Unknown',
    reason: sr.reason,
    status: sr.status,
    created_at: sr.created_at,
  }))

  return <SwapsClient shifts={shifts} swapRequests={swapRequests} />
}
```

**Step 3: Run TypeScript check**

```bash
node "node_modules/typescript/bin/tsc" --noEmit
```

**Step 4: Run build**

```bash
npm run build
```
Expected: new `/parent/swaps` page compiled cleanly.

**Step 5: Commit**

```bash
git add app/\(parent\)/parent/swaps/
git commit -m "feat(swaps): create parent swap request page"
```

---

## Task 8: Update Admin Swap Actions — approveSwapAction takes coveringFamilyId

**Files:**
- Modify: `app/(admin)/admin/swaps/actions.ts`

**Step 1: Update `approveSwapAction` signature**

Change:
```typescript
export async function approveSwapAction(swapId: string) {
```
To:
```typescript
export async function approveSwapAction(swapId: string, coveringFamilyId: string) {
```

**Step 2: Update the status guard and covering family logic**

The existing guard at line 57:
```typescript
if (!swap || swap.status !== 'pending_admin' || !swap.covering_family_id) return
```
Change to:
```typescript
if (!swap || swap.status !== 'open') return
```

**Step 3: Use the passed `coveringFamilyId` instead of `swap.covering_family_id`**

In the three update calls (swap update, shift update, makeup_debt insert), replace all occurrences of `swap.covering_family_id` with `coveringFamilyId`:

```typescript
// 1. Update swap → approved, set covering_family_id
await (supabase.from('swap_requests') as any)
  .update({ status: 'approved', covering_family_id: coveringFamilyId })
  .eq('id', swapId)

// 2. Reassign shift to covering family
await (supabase.from('shifts') as any)
  .update({ family_id: coveringFamilyId, conflict_warning: false })
  .eq('id', swap.shift_id)

// 3. Makeup debt (requesting family) — unchanged

// 4. Notifications — change covering family references:
.in('id', [swap.requesting_family_id, coveringFamilyId])
// ... and all subsequent coveringFamily references
```

**Step 4: Update revalidatePaths**

At the bottom of both actions, add:
```typescript
revalidatePath('/admin/swaps')
revalidatePath(`/admin/swaps/${swapId}`)
```

**Step 5: Run TypeScript check**

```bash
node "node_modules/typescript/bin/tsc" --noEmit
```

**Step 6: Commit**

```bash
git add app/\(admin\)/admin/swaps/actions.ts
git commit -m "feat(swaps): admin approveSwapAction now accepts coveringFamilyId param"
```

---

## Task 9: Create Admin Swap Detail Page — Family Picker

**Files:**
- Create: `app/(admin)/admin/swaps/[id]/page.tsx`

**Step 1: Create the page**

```tsx
/**
 * Admin swap detail page — /admin/swaps/[id]
 *
 * Shows the swap request details and a sorted list of eligible covering families.
 * Admin selects a covering family and approves or rejects the request.
 */

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveSwapAction, rejectSwapAction } from '../actions'
import type { ExtraShiftsWilling } from '@/lib/types'

// ── Types ────────────────────────────────────────────────────────────────────

interface EligibleFamily {
  id: string
  name: string
  extra_shifts_willing: ExtraShiftsWilling
  confirmed_shifts_this_month: number
  has_conflict: boolean
}

interface SwapDetailProps {
  swapId: string
  shiftDate: string
  className: string
  requestingFamily: string
  reason: string | null
  status: string
  eligibleFamilies: EligibleFamily[]
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SwapDetailClient(props: SwapDetailProps) {
  const { swapId, shiftDate, className, requestingFamily, reason, status, eligibleFamilies } = props
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const WILLINGNESS_LABEL: Record<string, string> = {
    '5+': '5+ extra shifts', '3-4': '3–4 extra', '1-2': '1–2 extra', '0': 'Required only',
  }
  const WILLINGNESS_RANK: Record<string, number> = { '5+': 4, '3-4': 3, '1-2': 2, '0': 1 }

  const sorted = [...eligibleFamilies].sort((a, b) => {
    const ra = a.extra_shifts_willing !== '0' ? WILLINGNESS_RANK[a.extra_shifts_willing] + 10 : 0
    const rb = b.extra_shifts_willing !== '0' ? WILLINGNESS_RANK[b.extra_shifts_willing] + 10 : 0
    if (ra !== rb) return rb - ra
    return a.name.localeCompare(b.name)
  })

  const groupA = sorted.filter(f => f.extra_shifts_willing !== '0')
  const groupB = sorted.filter(f => f.extra_shifts_willing === '0')

  function handleApprove() {
    if (!selectedId) { setError('Please select a covering family.'); return }
    setError(null)
    startTransition(async () => {
      await approveSwapAction(swapId, selectedId)
      router.push('/admin/swaps')
      router.refresh()
    })
  }

  function handleReject() {
    startTransition(async () => {
      await rejectSwapAction(swapId)
      router.push('/admin/swaps')
      router.refresh()
    })
  }

  const isOpen = status === 'open'

  function FamilyCard({ family }: { family: EligibleFamily }) {
    const selected = selectedId === family.id
    return (
      <div
        onClick={() => isOpen && setSelectedId(family.id)}
        style={{
          padding: '0.85rem 1rem',
          border: `2px solid ${selected ? 'var(--sage)' : 'var(--border)'}`,
          borderRadius: '10px',
          background: selected ? 'var(--sage-light)' : 'var(--warm-white)',
          cursor: isOpen ? 'pointer' : 'default',
          marginBottom: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem' }}>
            {family.name} Family
            {family.has_conflict && (
              <span style={{ marginLeft: '0.5rem', color: 'var(--warning)', fontSize: '0.8rem' }}>
                ⚠ Conflict
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {WILLINGNESS_LABEL[family.extra_shifts_willing]} ·{' '}
            {family.confirmed_shifts_this_month} shift{family.confirmed_shifts_this_month !== 1 ? 's' : ''} this month
          </div>
        </div>
        {selected && (
          <span style={{
            fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', padding: '0.2rem 0.55rem',
            borderRadius: '999px', background: 'var(--sage)', color: '#fff',
          }}>
            Selected
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <h1 style={{
        fontFamily: 'var(--font-playfair), "Playfair Display", serif',
        fontSize: '1.5rem', fontWeight: 500, color: 'var(--text)', margin: '0 0 1.5rem',
      }}>
        Swap Request
      </h1>

      {/* ── Request summary ──────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--warm-white)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem',
      }}>
        <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text)' }}>
          <div><strong>Family:</strong> {requestingFamily}</div>
          <div><strong>Shift:</strong> {shiftDate} · {className}</div>
          {reason && <div><strong>Reason:</strong> {reason}</div>}
          <div><strong>Status:</strong> {status}</div>
        </div>
      </div>

      {isOpen ? (
        <>
          {/* ── Family picker ───────────────────────────────────────────── */}
          {error && (
            <div style={{
              padding: '0.75rem', borderRadius: '8px',
              background: 'var(--warning-light)', color: 'var(--warning)',
              fontSize: '0.875rem', marginBottom: '1rem',
            }}>
              {error}
            </div>
          )}

          {groupA.length > 0 && (
            <section style={{ marginBottom: '1.25rem' }}>
              <h2 className="label-section" style={{ marginBottom: '0.6rem' }}>
                Available &amp; Willing to Work Extra
              </h2>
              {groupA.map(f => <FamilyCard key={f.id} family={f} />)}
            </section>
          )}

          {groupB.length > 0 && (
            <section style={{ marginBottom: '1.25rem' }}>
              <h2 className="label-section" style={{ marginBottom: '0.6rem' }}>
                Available
              </h2>
              {groupB.map(f => <FamilyCard key={f.id} family={f} />)}
            </section>
          )}

          {eligibleFamilies.length === 0 && (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              No families have submitted availability for this date.
            </p>
          )}

          {/* ── Action buttons ──────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button
              onClick={handleApprove}
              disabled={isPending}
              style={{
                background: 'var(--sage)', color: '#fff', border: 'none',
                borderRadius: '8px', padding: '0.65rem 1.5rem',
                fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                opacity: isPending ? 0.7 : 1,
              }}
            >
              {isPending ? 'Saving…' : 'Approve & Assign'}
            </button>
            <button
              onClick={handleReject}
              disabled={isPending}
              style={{
                background: 'none', color: 'var(--warning)',
                border: '1px solid var(--warning)', borderRadius: '8px',
                padding: '0.65rem 1.25rem', fontSize: '0.9rem',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reject Request
            </button>
          </div>
        </>
      ) : (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          This request has already been {status}.
        </p>
      )}
    </div>
  )
}
```

**Step 2: Create the server wrapper for the detail page**

Rename the file above to `SwapDetailClient.tsx`. Create `page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SwapDetailClient from './SwapDetailClient'
import type { ExtraShiftsWilling } from '@/lib/types'

interface PageProps { params: { id: string } }

export default async function AdminSwapDetailPage({ params }: PageProps) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: ur } = await supabase.from('users').select('role').eq('id', user.id)
    .returns<{ role: string }[]>().maybeSingle()
  if (ur?.role !== 'admin') redirect('/parent/dashboard')

  const swapId = params.id

  // Fetch swap + shift + requesting family
  const { data: swap } = await supabase
    .from('swap_requests')
    .select('id, status, reason, requesting_family_id, shift_id, shifts(date, class_id, classes(name)), families!requesting_family_id(name)')
    .eq('id', swapId)
    .returns<any[]>()
    .maybeSingle()

  if (!swap) redirect('/admin/swaps')

  const shiftDate: string = swap.shifts?.date ?? ''
  const shiftMonth = shiftDate.slice(0, 7) + '-01' // YYYY-MM-01

  // Fetch availability records for the shift's month
  const { data: avail } = await supabase
    .from('availability')
    .select('family_id, available_dates, extra_shifts_willing')
    .eq('period_month', shiftMonth)
    .returns<{ family_id: string; available_dates: string[]; extra_shifts_willing: string }[]>()

  // Filter to families available on the shift date (excluding requesting family)
  const eligibleAvail = (avail ?? []).filter(a =>
    a.family_id !== swap.requesting_family_id &&
    a.available_dates.includes(shiftDate)
  )
  const eligibleFamilyIds = eligibleAvail.map(a => a.family_id)

  if (eligibleFamilyIds.length === 0) {
    // Render with empty list
    return <SwapDetailClient
      swapId={swapId}
      shiftDate={shiftDate}
      className={swap.shifts?.classes?.name ?? ''}
      requestingFamily={swap.families?.name ?? ''}
      reason={swap.reason}
      status={swap.status}
      eligibleFamilies={[]}
    />
  }

  // Fetch family names, this month's confirmed shift counts, and conflicts
  const thisMonthStart = shiftMonth
  const [familiesRes, shiftsCountRes, conflictsRes] = await Promise.all([
    supabase.from('families').select('id, name').in('id', eligibleFamilyIds)
      .returns<{ id: string; name: string }[]>(),

    supabase.from('shifts').select('family_id')
      .in('family_id', eligibleFamilyIds)
      .eq('status', 'confirmed')
      .gte('date', thisMonthStart)
      .lte('date', shiftMonth.replace('-01', `-${new Date(Number(shiftMonth.slice(0,4)), Number(shiftMonth.slice(5,7)), 0).getDate()}`))
      .returns<{ family_id: string }[]>(),

    supabase.from('family_conflicts').select('family_a_id, family_b_id')
      .or(`family_a_id.eq.${swap.requesting_family_id},family_b_id.eq.${swap.requesting_family_id}`)
      .returns<{ family_a_id: string; family_b_id: string }[]>(),
  ])

  const shiftCountMap = new Map<string, number>()
  ;(shiftsCountRes.data ?? []).forEach(s => {
    shiftCountMap.set(s.family_id, (shiftCountMap.get(s.family_id) ?? 0) + 1)
  })

  const conflictSet = new Set(
    (conflictsRes.data ?? []).map(c =>
      c.family_a_id === swap.requesting_family_id ? c.family_b_id : c.family_a_id
    )
  )

  const availMap = new Map(eligibleAvail.map(a => [a.family_id, a.extra_shifts_willing]))

  const eligibleFamilies = (familiesRes.data ?? []).map(f => ({
    id: f.id,
    name: f.name,
    extra_shifts_willing: (availMap.get(f.id) ?? '0') as ExtraShiftsWilling,
    confirmed_shifts_this_month: shiftCountMap.get(f.id) ?? 0,
    has_conflict: conflictSet.has(f.id),
  }))

  return (
    <SwapDetailClient
      swapId={swapId}
      shiftDate={shiftDate}
      className={swap.shifts?.classes?.name ?? ''}
      requestingFamily={swap.families?.name ?? ''}
      reason={swap.reason}
      status={swap.status}
      eligibleFamilies={eligibleFamilies}
    />
  )
}
```

**Step 3: Run TypeScript check**

```bash
node "node_modules/typescript/bin/tsc" --noEmit
```

**Step 4: Run build**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add app/\(admin\)/admin/swaps/\[id\]/
git commit -m "feat(swaps): add admin swap detail page with sorted family picker"
```

---

## Task 10: Update Admin Swaps List — Link to Detail Page

**Files:**
- Modify: `app/(admin)/admin/swaps/page.tsx`

**Step 1: Update open swap cards to link to detail page**

In the existing `SwapCard` component (or wherever swap cards are rendered), wrap the card (or add a "Review →" link) that navigates to `/admin/swaps/${swap.id}`. For open swaps, replace the inline Approve/Reject buttons with a single "Review →" link:

Find where `approveSwapAction` and `rejectSwapAction` are called from the list page (the existing Approve/Reject inline buttons for `pending_admin` status), and change the display for `open` swaps to show a "Review →" link instead:

```tsx
import Link from 'next/link'
// ...

// In the SwapCard or wherever open swaps are rendered:
{swap.status === 'open' && (
  <Link
    href={`/admin/swaps/${swap.id}`}
    style={{
      fontSize: '0.8rem', color: 'var(--sage)', fontWeight: 600,
      textDecoration: 'none',
    }}
  >
    Review →
  </Link>
)}
```

**Step 2: Update the grouping label**

Currently the page groups by `pending_admin`. Change the "Needs Approval" group to use `open`:
```typescript
const needsApproval = swaps.filter(s => s.status === 'open')
```

**Step 3: Run TypeScript check + build**

```bash
node "node_modules/typescript/bin/tsc" --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add app/\(admin\)/admin/swaps/page.tsx
git commit -m "feat(swaps): link admin swap list to detail page for review"
```

---

## Task 11: Create Availability Reminder Server Action

**Files:**
- Create: `app/(admin)/admin/dashboard/actions.ts`

**Step 1: Create the file**

```typescript
'use server'

/**
 * Admin dashboard server actions.
 *
 * sendAvailabilityRemindersAction — sends reminder emails to all families
 * who have not yet submitted availability for a given month.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sendEmail, emailHtml } from '@/lib/email'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: ur } = await supabase.from('users').select('role').eq('id', user.id)
    .returns<{ role: string }[]>().maybeSingle()
  if (ur?.role !== 'admin') redirect('/parent/dashboard')
  return supabase
}

export async function sendAvailabilityRemindersAction(
  targetMonth: string // YYYY-MM-01 format
): Promise<{ sent: number; skipped: number; failed: number; error?: string }> {
  const supabase = await requireAdmin()

  if (!targetMonth.match(/^\d{4}-\d{2}-01$/)) {
    return { sent: 0, skipped: 0, failed: 0, error: 'Invalid month format.' }
  }

  // Get all families
  const { data: allFamilies } = await supabase
    .from('families')
    .select('id, name, email')
    .returns<{ id: string; name: string; email: string }[]>()

  if (!allFamilies?.length) {
    return { sent: 0, skipped: 0, failed: 0 }
  }

  // Get families who have already submitted for targetMonth
  const { data: submitted } = await supabase
    .from('availability')
    .select('family_id')
    .eq('period_month', targetMonth)
    .returns<{ family_id: string }[]>()

  const submittedSet = new Set((submitted ?? []).map(s => s.family_id))

  // Filter to families who have NOT submitted
  const unsubmitted = allFamilies.filter(f => !submittedSet.has(f.id))

  const monthDate = new Date(targetMonth)
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const family of unsubmitted) {
    if (!family.email) {
      skipped++
      continue
    }

    try {
      await sendEmail({
        to: family.email,
        subject: `Bloom: Please submit your ${monthLabel} availability`,
        html: emailHtml(
          `${monthLabel} Availability`,
          `Hi ${family.name} Family, please submit your availability for ${monthLabel} so we can schedule your volunteer shifts. If you have any planned absences, be sure to mark those too.`,
          `${appUrl}/parent/availability`,
          'Submit Availability'
        ),
      })
      sent++
    } catch {
      failed++
    }
  }

  return { sent, skipped, failed }
}
```

**Step 2: Run TypeScript check**

```bash
node "node_modules/typescript/bin/tsc" --noEmit
```

**Step 3: Commit**

```bash
git add app/\(admin\)/admin/dashboard/actions.ts
git commit -m "feat(reminders): add sendAvailabilityRemindersAction server action"
```

---

## Task 12: Add Reminder Section to Admin Dashboard

**Files:**
- Modify: `app/(admin)/admin/dashboard/page.tsx`

**Step 1: Fetch submission count for next month**

In the existing server component, add a parallel query for the reminder section. After computing `nextMonthStart` (first day of next month), add:

```typescript
// Compute next month ISO string
const now = new Date()
const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1)
const nextMonthStart = `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}-01`
const nextMonthLabel = nm.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

// Add to the existing Promise.all:
supabase.from('families').select('id', { count: 'exact', head: true }),
supabase.from('availability').select('family_id', { count: 'exact', head: true })
  .eq('period_month', nextMonthStart),
```

Extract counts:
```typescript
const totalFamilies = totalFamiliesRes.count ?? 0
const submittedCount = submittedCountRes.count ?? 0
const unsubmittedCount = Math.max(0, totalFamilies - submittedCount)
```

**Step 2: Add ReminderSection client component inline**

At the bottom of the page JSX, add a reminder card. Create a small `'use client'` component in the same file or a separate file:

```tsx
// app/(admin)/admin/dashboard/ReminderButton.tsx
'use client'

import { useState, useTransition } from 'react'
import { sendAvailabilityRemindersAction } from './actions'

export function ReminderButton({
  targetMonth,
  unsubmittedCount,
  totalFamilies,
  monthLabel,
}: {
  targetMonth: string
  unsubmittedCount: number
  totalFamilies: number
  monthLabel: string
}) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ sent: number; skipped: number; failed: number } | null>(null)

  function handleSend() {
    startTransition(async () => {
      const r = await sendAvailabilityRemindersAction(targetMonth)
      setResult(r)
    })
  }

  const submittedCount = totalFamilies - unsubmittedCount

  return (
    <div style={{
      background: 'var(--warm-white)', border: '1px solid var(--border)',
      borderRadius: '12px', padding: '1.25rem', marginTop: '1.75rem',
    }}>
      <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
        {monthLabel} Availability
      </h2>

      {/* Progress bar */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{
          height: '6px', borderRadius: '3px', background: 'var(--border)',
          overflow: 'hidden', marginBottom: '0.4rem',
        }}>
          <div style={{
            height: '100%',
            width: totalFamilies > 0 ? `${(submittedCount / totalFamilies) * 100}%` : '0%',
            background: 'var(--sage)', borderRadius: '3px', transition: 'width 0.3s',
          }} />
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          {submittedCount} of {totalFamilies} families have submitted
        </p>
      </div>

      {result ? (
        <div style={{
          padding: '0.65rem 0.9rem', borderRadius: '8px',
          background: 'var(--sage-light)', color: 'var(--sage-dark)',
          fontSize: '0.85rem',
        }}>
          ✓ Reminders sent to {result.sent} families
          {result.skipped > 0 && ` · ${result.skipped} skipped (no email)`}
          {result.failed > 0 && ` · ${result.failed} failed`}
        </div>
      ) : (
        <button
          onClick={handleSend}
          disabled={isPending || unsubmittedCount === 0}
          style={{
            background: unsubmittedCount > 0 ? 'var(--sage)' : 'var(--border)',
            color: unsubmittedCount > 0 ? '#fff' : 'var(--text-muted)',
            border: 'none', borderRadius: '8px',
            padding: '0.6rem 1.25rem', fontSize: '0.875rem',
            fontWeight: 600, cursor: unsubmittedCount > 0 && !isPending ? 'pointer' : 'not-allowed',
            opacity: isPending ? 0.7 : 1,
          }}
        >
          {isPending
            ? 'Sending…'
            : unsubmittedCount > 0
              ? `Send Reminder to ${unsubmittedCount} Families`
              : 'All Families Have Submitted'}
        </button>
      )}
    </div>
  )
}
```

**Step 3: Import and render in dashboard page**

In `app/(admin)/admin/dashboard/page.tsx`, import `ReminderButton` and add it at the bottom of the JSX:

```tsx
import { ReminderButton } from './ReminderButton'
// ...
<ReminderButton
  targetMonth={nextMonthStart}
  unsubmittedCount={unsubmittedCount}
  totalFamilies={totalFamilies}
  monthLabel={nextMonthLabel}
/>
```

**Step 4: Run TypeScript check + build**

```bash
node "node_modules/typescript/bin/tsc" --noEmit && npm run build
```
Expected: all pages compile, 0 TypeScript errors.

**Step 5: Commit**

```bash
git add app/\(admin\)/admin/dashboard/
git commit -m "feat(reminders): add availability reminder button to admin dashboard"
```

---

## Task 13: Unit Tests

**Files:**
- Create: `tests/unit/swaps.test.ts`
- Create: `tests/unit/reminders.test.ts`

**Step 1: Write failing tests for swap eligibility sort**

```typescript
// tests/unit/swaps.test.ts
import { describe, it, expect } from 'vitest'
import { EXTRA_SHIFTS_RANK } from '@/lib/types'

// Extract the sort logic into a pure helper for testing
function sortEligibleFamilies(families: Array<{
  id: string
  name: string
  extra_shifts_willing: string
}>) {
  return [...families].sort((a, b) => {
    const ra = a.extra_shifts_willing !== '0'
      ? (EXTRA_SHIFTS_RANK[a.extra_shifts_willing as keyof typeof EXTRA_SHIFTS_RANK] ?? 0) + 10
      : 0
    const rb = b.extra_shifts_willing !== '0'
      ? (EXTRA_SHIFTS_RANK[b.extra_shifts_willing as keyof typeof EXTRA_SHIFTS_RANK] ?? 0) + 10
      : 0
    if (ra !== rb) return rb - ra
    return a.name.localeCompare(b.name)
  })
}

describe('swap eligible family sorting', () => {
  it('puts willing families before required-only families', () => {
    const families = [
      { id: '1', name: 'Adams', extra_shifts_willing: '0' },
      { id: '2', name: 'Brown', extra_shifts_willing: '1-2' },
    ]
    const sorted = sortEligibleFamilies(families)
    expect(sorted[0].id).toBe('2') // Brown is willing
    expect(sorted[1].id).toBe('1') // Adams is required only
  })

  it('sorts within willing group by willingness level descending', () => {
    const families = [
      { id: '1', name: 'Adams', extra_shifts_willing: '1-2' },
      { id: '2', name: 'Brown', extra_shifts_willing: '5+' },
      { id: '3', name: 'Clark', extra_shifts_willing: '3-4' },
    ]
    const sorted = sortEligibleFamilies(families)
    expect(sorted.map(f => f.id)).toEqual(['2', '3', '1'])
  })

  it('sorts alphabetically within same willingness level', () => {
    const families = [
      { id: '1', name: 'Zorn', extra_shifts_willing: '1-2' },
      { id: '2', name: 'Adams', extra_shifts_willing: '1-2' },
    ]
    const sorted = sortEligibleFamilies(families)
    expect(sorted[0].name).toBe('Adams')
  })

  it('returns empty array unchanged', () => {
    expect(sortEligibleFamilies([])).toEqual([])
  })
})
```

**Step 2: Run to verify tests fail (function not exported yet)**

```bash
npm test -- tests/unit/swaps.test.ts
```
Expected: FAIL — `EXTRA_SHIFTS_RANK` not found in `lib/types`.

> *(This is expected — TDD red phase. The types export was added in Task 2.)*

**Step 3: After Task 2 is complete, re-run to verify pass**

```bash
npm test -- tests/unit/swaps.test.ts
```
Expected: 4 tests PASS.

**Step 4: Write failing tests for reminder target month calculation**

```typescript
// tests/unit/reminders.test.ts
import { describe, it, expect } from 'vitest'

function getTargetMonth(currentDate: Date): string {
  const nm = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)
  return `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}-01`
}

describe('availability reminder target month', () => {
  it('returns next month from January', () => {
    expect(getTargetMonth(new Date('2026-01-15'))).toBe('2026-02-01')
  })

  it('returns next month from December (year rollover)', () => {
    expect(getTargetMonth(new Date('2026-12-10'))).toBe('2027-01-01')
  })

  it('returns next month from March (our current month)', () => {
    expect(getTargetMonth(new Date('2026-03-05'))).toBe('2026-04-01')
  })
})
```

**Step 5: Run tests**

```bash
npm test -- tests/unit/reminders.test.ts
```
Expected: 3 tests PASS.

**Step 6: Run full test suite**

```bash
npm test
```
Expected: all unit tests pass, no regressions.

**Step 7: Commit**

```bash
git add tests/unit/swaps.test.ts tests/unit/reminders.test.ts
git commit -m "test: add unit tests for swap sorting and reminder month calculation"
```

---

## Summary: Commit Order

1. `feat(db): add extra_shifts_willing to availability table`
2. `feat(types): add extra_shifts_willing to AvailabilityRow`
3. `feat(availability): accept extra_shifts_willing in submit action`
4. `feat(availability): fetch and forward extra_shifts_willing to calendar`
5. `feat(availability): add extra shifts willingness dropdown`
6. `feat(swaps): add parent requestSwapAction and cancelSwapAction`
7. `feat(swaps): create parent swap request page`
8. `feat(swaps): admin approveSwapAction now accepts coveringFamilyId param`
9. `feat(swaps): add admin swap detail page with sorted family picker`
10. `feat(swaps): link admin swap list to detail page for review`
11. `feat(reminders): add sendAvailabilityRemindersAction server action`
12. `feat(reminders): add availability reminder button to admin dashboard`
13. `test: add unit tests for swap sorting and reminder month calculation`
