# Schedule Editing, Drop-in Rebuild & Availability Editing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add admin shift reassignment, rebuild the drop-in availability UI for both parent and admin, add an admin financial settings page, and add edit-mode tracking for availability submissions.

**Architecture:** Three independent feature areas sharing only a new DB migration. All business logic stays in `/lib`. New UI components stay close to their route (colocated). Server actions handle all writes.

**Tech Stack:** Next.js 14 App Router, Supabase PostgreSQL, Tailwind / CSS variables, Vitest unit tests.

---

## Task 1: DB Migration — Financial Settings Columns

**Files:**
- Create: `supabase/migrations/0011_school_settings_fees.sql`

**Step 1: Write the migration**

```sql
-- 0011_school_settings_fees.sql
-- Adds missed_shift_fee and extra_shift_credit to school_settings.
-- missed_shift_fee:   charged when a shift is marked as missed.
-- extra_shift_credit: credited when a parent completes a shift beyond their requirement.

ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS missed_shift_fee    DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_shift_credit  DECIMAL(10,2) NOT NULL DEFAULT 0;
```

**Step 2: Run in Supabase SQL Editor**

Paste the SQL into Supabase → SQL Editor and click Run. Expected: "Success. No rows returned."

**Step 3: Update `lib/types.ts` — add fields to `SchoolSettingsRow`**

Find the `SchoolSettingsRow` interface (around line 177) and add two lines:

```typescript
export interface SchoolSettingsRow {
  id: number
  school_year_start: string
  school_year_end: string
  buyout_amount_per_shift: number
  dropin_fee: number
  availability_deadline_day: number
  missed_shift_fee: number        // ← add
  extra_shift_credit: number      // ← add
}
```

**Step 4: Commit**

```bash
git add supabase/migrations/0011_school_settings_fees.sql lib/types.ts
git commit -m "feat: add missed_shift_fee and extra_shift_credit to school_settings"
```

---

## Task 2: Admin Financial Settings Page

**Files:**
- Create: `app/(admin)/admin/settings/actions.ts`
- Create: `app/(admin)/admin/settings/page.tsx`

**Step 1: Create the server action**

```typescript
// app/(admin)/admin/settings/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: row } = await supabase
    .from('users').select('role').eq('id', user.id)
    .returns<{ role: string }[]>().maybeSingle()
  if (row?.role !== 'admin') redirect('/parent/dashboard')
  return supabase
}

export interface SettingsInput {
  dropin_fee: number
  buyout_amount_per_shift: number
  missed_shift_fee: number
  extra_shift_credit: number
}

export async function updateSchoolSettingsAction(
  data: SettingsInput
): Promise<{ error?: string }> {
  const supabase = await verifyAdmin()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('school_settings') as any)
    .update({
      dropin_fee: data.dropin_fee,
      buyout_amount_per_shift: data.buyout_amount_per_shift,
      missed_shift_fee: data.missed_shift_fee,
      extra_shift_credit: data.extra_shift_credit,
    })
    .eq('id', 1)

  if (error) return { error: error.message }
  revalidatePath('/admin/settings')
  return {}
}
```

**Step 2: Create the settings page**

```typescript
// app/(admin)/admin/settings/page.tsx
'use client'

import { useState, useTransition } from 'react'
import { updateSchoolSettingsAction } from './actions'
// Note: this is a client component that also fetches via a server component wrapper.
// Keep it simple: server fetch is in the parent page.tsx below.
```

Actually, make this a two-file setup: a server page that fetches + a client form component.

**`app/(admin)/admin/settings/page.tsx` (server):**

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SettingsForm } from './SettingsForm'
import type { SchoolSettingsRow } from '@/lib/types'

export const metadata = { title: 'Admin · Settings' }

export default async function AdminSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userRow } = await supabase
    .from('users').select('role').eq('id', user.id)
    .returns<{ role: string }[]>().maybeSingle()
  if (userRow?.role !== 'admin') redirect('/parent/dashboard')

  let settings: SchoolSettingsRow | null = null
  try {
    const { data } = await supabase
      .from('school_settings').select('*').eq('id', 1)
      .returns<SchoolSettingsRow[]>().maybeSingle()
    settings = data
  } catch { /* not configured */ }

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{
          fontFamily: 'var(--font-playfair), "Playfair Display", serif',
          fontSize: '1.5rem', fontWeight: 500, color: 'var(--text)', margin: '0 0 0.35rem',
        }}>
          School Settings
        </h1>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Fee amounts used across the scheduler. Changes take effect immediately.
        </p>
      </div>
      <SettingsForm settings={settings} />
    </div>
  )
}
```

**`app/(admin)/admin/settings/SettingsForm.tsx` (client):**

```typescript
'use client'

import { useState, useTransition } from 'react'
import { updateSchoolSettingsAction } from './actions'
import type { SchoolSettingsRow } from '@/lib/types'

interface Props { settings: SchoolSettingsRow | null }

const FIELDS: { key: keyof SchoolSettingsRow; label: string; description: string }[] = [
  { key: 'dropin_fee',              label: 'Drop-in Fee',           description: 'Flat fee per drop-in day' },
  { key: 'buyout_amount_per_shift', label: 'Buyout Amount',         description: 'Cost to buy out a scheduled shift or makeup debt' },
  { key: 'missed_shift_fee',        label: 'Missed Shift Fee',      description: 'Fee charged when a shift is marked as missed' },
  { key: 'extra_shift_credit',      label: 'Extra Shift Credit',    description: 'Credit earned for completing a shift beyond the monthly requirement' },
]

export function SettingsForm({ settings }: Props) {
  const [values, setValues] = useState({
    dropin_fee:              settings?.dropin_fee ?? 0,
    buyout_amount_per_shift: settings?.buyout_amount_per_shift ?? 0,
    missed_shift_fee:        settings?.missed_shift_fee ?? 0,
    extra_shift_credit:      settings?.extra_shift_credit ?? 0,
  })
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await updateSchoolSettingsAction(values)
      if (res.error) { setError(res.error) } else { setSaved(true) }
    })
  }

  return (
    <div style={{ background: 'var(--warm-white)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem' }}>
      {FIELDS.map(({ key, label, description }) => (
        <div key={key} style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label}
          </label>
          <p style={{ margin: '0 0 0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{description}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={values[key as keyof typeof values]}
              onChange={e => setValues(v => ({ ...v, [key]: parseFloat(e.target.value) || 0 }))}
              style={{
                width: '120px', padding: '0.5rem 0.75rem',
                border: '1px solid var(--border)', borderRadius: '8px',
                fontSize: '0.95rem', background: 'var(--cream)', color: 'var(--text)',
              }}
            />
          </div>
        </div>
      ))}

      {error && <p style={{ fontSize: '0.85rem', color: 'var(--danger)', marginBottom: '0.75rem' }}>{error}</p>}
      {saved && <p style={{ fontSize: '0.85rem', color: 'var(--sage-dark)', marginBottom: '0.75rem' }}>Settings saved.</p>}

      <button
        onClick={handleSave}
        disabled={isPending}
        style={{
          background: 'var(--sage)', color: 'white', border: 'none',
          borderRadius: '8px', padding: '0.6rem 1.25rem',
          fontSize: '0.875rem', fontWeight: 500,
          cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  )
}
```

**Step 3: Add "Settings" to the admin nav**

Find the admin nav component (look in `components/layout/` for the sidebar/bottom nav). Add a Settings item pointing to `/admin/settings`. Use a gear icon (⚙).

**Step 4: Commit**

```bash
git add app/\(admin\)/admin/settings/
git commit -m "feat: admin financial settings page with fee configuration"
```

---

## Task 3: Admin Shift Reassignment — Server Action

**Files:**
- Modify: `app/(admin)/admin/schedule/actions.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/schedule-reassign.test.ts
import { describe, it, expect } from 'vitest'
import { computeConflictWarning } from '@/lib/schedule-utils'

describe('computeConflictWarning', () => {
  it('returns true when new family conflicts with a family on the same date', () => {
    const conflictPairs = [{ family_a_id: 'fam-a', family_b_id: 'fam-b' }]
    const otherFamiliesOnDate = ['fam-b']
    expect(computeConflictWarning('fam-a', otherFamiliesOnDate, conflictPairs)).toBe(true)
  })

  it('returns false when new family has no conflicts on the date', () => {
    const conflictPairs = [{ family_a_id: 'fam-a', family_b_id: 'fam-b' }]
    const otherFamiliesOnDate = ['fam-c']
    expect(computeConflictWarning('fam-a', otherFamiliesOnDate, conflictPairs)).toBe(false)
  })

  it('returns false when conflict list is empty', () => {
    expect(computeConflictWarning('fam-a', ['fam-b'], [])).toBe(false)
  })
})
```

Run: `npm test -- tests/unit/schedule-reassign.test.ts`
Expected: FAIL — `computeConflictWarning` not found.

**Step 2: Create `lib/schedule-utils.ts`**

```typescript
// lib/schedule-utils.ts
// Pure helper functions for schedule operations.

export interface ConflictPair {
  family_a_id: string
  family_b_id: string
}

/**
 * Returns true if `familyId` has a known conflict with any family in `otherFamilyIds`.
 */
export function computeConflictWarning(
  familyId: string,
  otherFamilyIds: string[],
  conflictPairs: ConflictPair[]
): boolean {
  const others = new Set(otherFamilyIds)
  return conflictPairs.some(
    p =>
      (p.family_a_id === familyId && others.has(p.family_b_id)) ||
      (p.family_b_id === familyId && others.has(p.family_a_id))
  )
}
```

Run test: `npm test -- tests/unit/schedule-reassign.test.ts`
Expected: PASS.

**Step 3: Add `reassignShiftAction` to schedule actions**

Append to `app/(admin)/admin/schedule/actions.ts`:

```typescript
import { computeConflictWarning } from '@/lib/schedule-utils'
import type { FamilyConflictRow } from '@/lib/types'

export async function reassignShiftAction(
  shiftId: string,
  newFamilyId: string
): Promise<{ error?: string }> {
  const supabase = await createClient()
  await verifyAdmin(supabase)

  // Load the shift to get its date and class
  const { data: shift } = await supabase
    .from('shifts')
    .select('id, date, class_id')
    .eq('id', shiftId)
    .returns<{ id: string; date: string; class_id: string }[]>()
    .maybeSingle()

  if (!shift) return { error: 'Shift not found.' }

  // Find other families assigned on the same date (for conflict check)
  const { data: sameDayShifts } = await supabase
    .from('shifts')
    .select('family_id')
    .eq('date', shift.date)
    .neq('id', shiftId)
    .returns<{ family_id: string }[]>()

  const otherFamilyIds = (sameDayShifts ?? []).map(s => s.family_id)

  // Load conflict pairs
  const { data: conflictRows } = await supabase
    .from('family_conflicts')
    .select('family_a_id, family_b_id')
    .returns<FamilyConflictRow[]>()

  const conflictWarning = computeConflictWarning(
    newFamilyId,
    otherFamilyIds,
    conflictRows ?? []
  )

  // Perform the reassignment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('shifts') as any)
    .update({ family_id: newFamilyId, conflict_warning: conflictWarning })
    .eq('id', shiftId)

  if (error) return { error: error.message }
  revalidatePath('/admin/schedule')
  return {}
}
```

**Step 4: Commit**

```bash
git add lib/schedule-utils.ts tests/unit/schedule-reassign.test.ts app/\(admin\)/admin/schedule/actions.ts
git commit -m "feat: reassignShiftAction with conflict detection"
```

---

## Task 4: Admin Schedule Calendar — Clickable Chips + Reassignment Panel

**Files:**
- Modify: `app/(admin)/admin/schedule/page.tsx`
- Modify: `app/(admin)/admin/schedule/AdminScheduleCalendar.tsx`

**Step 1: Update `page.tsx` to pass family stats**

The page already fetches shifts. Add a `familyStats` computation and pass it to the calendar.

In `app/(admin)/admin/schedule/page.tsx`, after fetching shifts and families, add:

```typescript
import { getRequiredShifts } from '@/lib/shifts'
import type { ChildRow } from '@/lib/types'

// After fetching shifts, families, and children:
const childrenByFamily = new Map<string, ChildRow[]>()
for (const child of children) {
  const list = childrenByFamily.get(child.family_id) ?? []
  list.push(child)
  childrenByFamily.set(child.family_id, list)
}

const familyStats = families.map(fam => {
  const famChildren = childrenByFamily.get(fam.id) ?? []
  const required = getRequiredShifts(fam, famChildren)
  const assigned = monthShifts.filter(
    s => s.family_id === fam.id && (s.status === 'proposed' || s.status === 'confirmed')
  ).length
  return { id: fam.id, name: fam.name, required, assigned }
})
```

Pass `familyStats` and `conflictPairs` to `<AdminScheduleCalendar>`.

**Step 2: Add `FamilyShiftStats` type and new props to `AdminScheduleCalendar`**

At the top of `AdminScheduleCalendar.tsx`, add:

```typescript
import { reassignShiftAction } from './actions'
import type { FamilyConflictRow } from '@/lib/types'

export interface FamilyShiftStats {
  id: string
  name: string
  required: number
  assigned: number
}

// Update Props interface:
interface Props {
  year: number
  month: number
  shifts: EnrichedShift[]
  classes: ClassRow[]
  holidayDates: string[]
  hasConflicts: boolean
  hasProposed: boolean
  familyStats: FamilyShiftStats[]           // ← new
  conflictPairs: FamilyConflictRow[]        // ← new
}
```

**Step 3: Add panel state and click handler**

Inside the `AdminScheduleCalendar` component, add:

```typescript
const [selectedShift, setSelectedShift] = useState<EnrichedShift | null>(null)
const [isReassignPending, startReassign] = useTransition()
const [reassignError, setReassignError] = useState<string | null>(null)

function handleReassign(newFamilyId: string) {
  if (!selectedShift) return
  setReassignError(null)
  startReassign(async () => {
    const res = await reassignShiftAction(selectedShift.id, newFamilyId)
    if (res.error) {
      setReassignError(res.error)
    } else {
      setSelectedShift(null)
      router.refresh()
    }
  })
}
```

**Step 4: Make `ShiftChip` clickable**

Update the `ShiftChip` component to accept an `onClick` prop and add cursor/hover styles:

```typescript
function ShiftChip({ shift, onClick }: { shift: EnrichedShift; onClick?: () => void }) {
  // ... existing render, but add to the outer div:
  //   onClick={onClick}
  //   style={{ ...existing, cursor: onClick ? 'pointer' : 'default' }}
  //   role={onClick ? 'button' : undefined}
  //   tabIndex={onClick ? 0 : undefined}
}
```

In `MonthView` and `WeekView`, pass the click handler:
```typescript
<ShiftChip key={s.id} shift={s} onClick={() => setSelectedShift(s)} />
```

**Step 5: Add the reassignment panel**

Add a `ShiftReassignPanel` component (below the `ShiftChip` function, inside the main component file):

```typescript
function ShiftReassignPanel() {
  if (!selectedShift) return null

  // Build conflict set for this date's other assigned families
  const otherFamiliesOnDate = new Set(
    (shiftsByDate.get(selectedShift.date) ?? [])
      .filter(s => s.id !== selectedShift.id)
      .map(s => s.familyId)
  )

  function hasConflictOnDate(familyId: string): boolean {
    return conflictPairs.some(
      p =>
        (p.family_a_id === familyId && otherFamiliesOnDate.has(p.family_b_id)) ||
        (p.family_b_id === familyId && otherFamiliesOnDate.has(p.family_a_id))
    )
  }

  // Sort alphabetically by name
  const sorted = [...familyStats].sort((a, b) => a.name.localeCompare(b.name))

  const classColors = CLASS_CHIP[selectedShift.className] ?? { bg: 'var(--sage-light)', color: 'var(--sage-dark)' }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setSelectedShift(null)}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 40,
        }}
      />
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(400px, 100vw)',
        background: 'var(--warm-white)', borderLeft: '1px solid var(--border)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', zIndex: 50,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
              Reassign Shift
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.95rem' }}>
              <span style={{ ...classColors, borderRadius: '4px', padding: '0.1rem 0.4rem', fontSize: '0.78rem', marginRight: '0.5rem' }}>
                {selectedShift.className}
              </span>
              {formatWeekDay(selectedShift.date)}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              Currently: <strong>{selectedShift.familyName}</strong>
            </div>
          </div>
          <button onClick={() => setSelectedShift(null)} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}>
            ✕
          </button>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '0.5rem', padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--border)', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
          <span>Family</span>
          <span style={{ textAlign: 'right' }}>Req</span>
          <span style={{ textAlign: 'right' }}>Done</span>
          <span style={{ textAlign: 'right' }}>Left</span>
        </div>

        {/* Family list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sorted.map(fam => {
            const isCurrent = fam.id === selectedShift.familyId
            const conflict = hasConflictOnDate(fam.id)
            const remaining = Math.max(0, fam.required - fam.assigned)

            return (
              <button
                key={fam.id}
                onClick={() => !isReassignPending && handleReassign(fam.id)}
                disabled={isCurrent || isReassignPending}
                style={{
                  width: '100%', textAlign: 'left', background: isCurrent ? 'var(--sage-light)' : 'transparent',
                  border: 'none', borderBottom: '1px solid var(--border)',
                  padding: '0.75rem 1.25rem', cursor: isCurrent ? 'default' : 'pointer',
                  display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '0.5rem', alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '0.875rem', fontWeight: isCurrent ? 600 : 400, color: 'var(--text)' }}>
                  {conflict && <span style={{ color: 'var(--warning)', marginRight: '0.3rem' }}>⚠</span>}
                  {fam.name}
                  {isCurrent && <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', color: 'var(--sage-dark)' }}>current</span>}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>{fam.required}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>{fam.assigned}</span>
                <span style={{ fontSize: '0.8rem', fontWeight: remaining > 0 ? 600 : 400, color: remaining > 0 ? 'var(--warning)' : 'var(--text-muted)', textAlign: 'right' }}>
                  {remaining}
                </span>
              </button>
            )
          })}
        </div>

        {reassignError && (
          <div style={{ padding: '0.75rem 1.25rem', fontSize: '0.85rem', color: 'var(--danger)', borderTop: '1px solid var(--border)' }}>
            {reassignError}
          </div>
        )}
        {isReassignPending && (
          <div style={{ padding: '0.75rem 1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
            Saving…
          </div>
        )}
      </div>
    </>
  )
}
```

Render `<ShiftReassignPanel />` at the very end of the main component's return, after the calendar card div.

**Step 6: Commit**

```bash
git add app/\(admin\)/admin/schedule/
git commit -m "feat: admin shift reassignment panel with alphabetical family list"
```

---

## Task 5: Drop-in Slot Computation Helper

**Files:**
- Modify: `lib/dropins.ts` (add a new exported function)

**Step 1: Write the failing test**

```typescript
// tests/unit/dropins-availability.test.ts
import { describe, it, expect } from 'vitest'
import { getAvailableDropinSlots } from '@/lib/dropins'

describe('getAvailableDropinSlots', () => {
  const holidays = new Set<string>()

  it('returns a slot when a child is absent and ratio allows it', () => {
    const slots = getAvailableDropinSlots({
      year: 2026, month: 4,
      classes: [{ id: 'cls-daisy', name: 'Daisy', student_teacher_ratio: 3 }],
      childrenByClass: { 'cls-daisy': [
        { id: 'c1', days_of_week: null },
        { id: 'c2', days_of_week: null },
        { id: 'c3', days_of_week: null },
      ]},
      absencesByClass: { 'cls-daisy': [{ child_id: 'c1', date: '2026-04-01' }] },
      approvedDropinsByClass: {},
      holidayDates: holidays,
    })
    // Apr 1 2026 is a Wednesday — valid school day
    // 3 enrolled, 1 absent = 2 attending, ratio 3 → parentsNeeded = ceil(2/3)-1 = 0, floored to 1
    // Adding 1 dropin → 3 attending → parentsNeeded = ceil(3/3)-1 = 0, floored to 1 → no change → slot available
    expect(slots.some(s => s.date === '2026-04-01' && s.classId === 'cls-daisy')).toBe(true)
  })

  it('does not return a slot on a weekend', () => {
    const slots = getAvailableDropinSlots({
      year: 2026, month: 4,
      classes: [{ id: 'cls-daisy', name: 'Daisy', student_teacher_ratio: 3 }],
      childrenByClass: { 'cls-daisy': [{ id: 'c1', days_of_week: null }] },
      absencesByClass: { 'cls-daisy': [{ child_id: 'c1', date: '2026-04-04' }] }, // Saturday
      approvedDropinsByClass: {},
      holidayDates: holidays,
    })
    expect(slots.some(s => s.date === '2026-04-04')).toBe(false)
  })

  it('does not return a slot when no absences exist', () => {
    const slots = getAvailableDropinSlots({
      year: 2026, month: 4,
      classes: [{ id: 'cls-daisy', name: 'Daisy', student_teacher_ratio: 3 }],
      childrenByClass: { 'cls-daisy': [{ id: 'c1', days_of_week: null }] },
      absencesByClass: {},
      approvedDropinsByClass: {},
      holidayDates: holidays,
    })
    expect(slots.length).toBe(0)
  })
})
```

Run: `npm test -- tests/unit/dropins-availability.test.ts`
Expected: FAIL.

**Step 2: Add `getAvailableDropinSlots` to `lib/dropins.ts`**

```typescript
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
      const DOW_MAP = [0, 1, 2, 3, 4, 5, 6]  // Sun=0…Sat=6
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
```

Run test: `npm test -- tests/unit/dropins-availability.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add lib/dropins.ts tests/unit/dropins-availability.test.ts
git commit -m "feat: getAvailableDropinSlots helper"
```

---

## Task 6: Parent Drop-in Page — Available Dates Section

**Files:**
- Modify: `app/(parent)/parent/dropins/page.tsx`

**Step 1: Add slot computation to the page data fetch**

In the `if (familyId)` block, add fetches for children-by-class, absences, and approved drop-ins for the current and next month. Then call `getAvailableDropinSlots` for each month.

Add imports at top of file:
```typescript
import { getAvailableDropinSlots } from '@/lib/dropins'
import type { AvailabilityRow, ChildRow, ClassRow } from '@/lib/types'
```

Inside the page, after building `classMap`, add:

```typescript
// Compute available drop-in slots for this month and next
const now = new Date()
const months = [
  { year: now.getFullYear(), month: now.getMonth() + 1 },
  { year: now.getFullYear(), month: now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2 },
]

let availableSlots: { date: string; classId: string; className: string }[] = []

try {
  const allChildren = (await supabase.from('children').select('id, class_id, days_of_week')).data ?? []
  const childrenByClass: Record<string, { id: string; days_of_week: string[] | null }[]> = {}
  for (const c of allChildren as { id: string; class_id: string; days_of_week: string[] | null }[]) {
    const list = childrenByClass[c.class_id] ?? []
    list.push({ id: c.id, days_of_week: c.days_of_week })
    childrenByClass[c.class_id] = list
  }

  for (const { year, month } of months) {
    const periodMonth = `${year}-${String(month).padStart(2,'0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const monthEnd = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`

    const [availRes, dropinRes, holidayRes] = await Promise.all([
      supabase.from('availability').select('planned_absences, family_id').gte('period_month', periodMonth).lte('period_month', periodMonth),
      supabase.from('dropin_requests').select('class_id, date').eq('status', 'approved').gte('date', periodMonth).lte('date', monthEnd),
      supabase.from('holidays').select('date').gte('date', periodMonth).lte('date', monthEnd),
    ])

    const holidayDates = new Set((holidayRes.data ?? []).map((h: { date: string }) => h.date))

    // Build absences by class
    const absencesByClass: Record<string, { child_id: string; date: string }[]> = {}
    for (const avRow of (availRes.data ?? []) as { planned_absences: { child_id: string; date: string }[] }[]) {
      for (const abs of avRow.planned_absences ?? []) {
        const child = (allChildren as { id: string; class_id: string }[]).find(c => c.id === abs.child_id)
        if (!child) continue
        const list = absencesByClass[child.class_id] ?? []
        list.push(abs)
        absencesByClass[child.class_id] = list
      }
    }

    // Build approved dropin counts
    const approvedDropinsByClass: Record<string, Record<string, number>> = {}
    for (const d of (dropinRes.data ?? []) as { class_id: string; date: string }[]) {
      const byDate = approvedDropinsByClass[d.class_id] ?? {}
      byDate[d.date] = (byDate[d.date] ?? 0) + 1
      approvedDropinsByClass[d.class_id] = byDate
    }

    const slots = getAvailableDropinSlots({
      year, month,
      classes: classes.map(c => ({ id: c.id, name: c.name, student_teacher_ratio: c.student_teacher_ratio })),
      childrenByClass,
      absencesByClass,
      approvedDropinsByClass,
      holidayDates,
    })
    availableSlots = [...availableSlots, ...slots]
  }
} catch { /* non-fatal */ }
```

**Step 2: Add the "Available Dates" section to the JSX**

Before the `{/* ── Request form */}` section, insert:

```tsx
{availableSlots.length > 0 && (
  <section style={{ marginBottom: '2rem' }}>
    <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>Available Drop-in Dates</h2>
    <div style={{ background: 'var(--warm-white)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
      {availableSlots.map((slot, i) => {
        const cls = classMap.get(slot.classId)
        const CLASS_COLORS: Record<string, string> = { Rose: 'var(--rose)', Daisy: 'var(--daisy)', Azalea: 'var(--azalea)' }
        const CLASS_BG: Record<string, string> = { Rose: 'var(--rose-light)', Daisy: 'var(--daisy-light)', Azalea: 'var(--azalea-light)' }
        return (
          <div key={`${slot.classId}-${slot.date}`} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem',
            padding: '0.85rem 1.25rem',
            borderBottom: i < availableSlots.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', background: CLASS_BG[slot.className], color: CLASS_COLORS[slot.className] }}>
                {slot.className}
              </span>
              <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>{formatDate(slot.date)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>${dropinFee}</span>
              {/* Pre-fill form — pass date via URL or use a small client form. Simple approach: link to the page with date pre-filled */}
              <span style={{ fontSize: '0.78rem', color: 'var(--sage-dark)', fontWeight: 600 }}>↓ Request below</span>
            </div>
          </div>
        )
      })}
    </div>
  </section>
)}
```

**Step 3: Commit**

```bash
git add app/\(parent\)/parent/dropins/page.tsx
git commit -m "feat: show available drop-in dates on parent drop-ins page"
```

---

## Task 7: Admin Drop-ins — Monthly Capacity Grid

**Files:**
- Modify: `app/(admin)/admin/dropins/page.tsx`

**Step 1: Add capacity computation to the page data fetch**

In `AdminDropInsPage`, add after the existing queries:

```typescript
import { getAvailableDropinSlots, getSchoolDaysInMonth } from '@/lib/dropins'
import { getParentsNeeded } from '@/lib/ratios'

// Current month capacity
const now = new Date()
const capYear = now.getFullYear()
const capMonth = now.getMonth() + 1
const capStart = `${capYear}-${String(capMonth).padStart(2,'0')}-01`
const capEnd = `${capYear}-${String(capMonth).padStart(2,'0')}-${new Date(capYear, capMonth, 0).getDate().toString().padStart(2,'0')}`

const [capAvailRes, capDropinRes, capHolidayRes] = await Promise.all([
  supabase.from('availability').select('planned_absences').gte('period_month', capStart).lte('period_month', capStart),
  supabase.from('dropin_requests').select('class_id, date').eq('status', 'approved').gte('date', capStart).lte('date', capEnd),
  supabase.from('holidays').select('date').gte('date', capStart).lte('date', capEnd),
])
// Then build childrenByClass, absencesByClass, approvedDropinsByClass (same logic as Task 6)
// and call getAvailableDropinSlots to get capacitySlots
```

**Step 2: Add capacity grid section to the JSX**

Before the pending requests list, add a section showing a simple table of school days × classes with open/full status for the current month.

```tsx
<section style={{ marginBottom: '2rem' }}>
  <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
    Drop-in Capacity — {MONTH_NAMES[capMonth - 1]} {capYear}
  </h2>
  <div style={{ background: 'var(--warm-white)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.68rem' }}>Date</th>
          {classes.map(cls => (
            <th key={cls.id} style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: CLASS_COLORS[cls.name] ?? 'var(--text)', fontWeight: 700, fontSize: '0.75rem' }}>{cls.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {schoolDays.map((date, i) => (
          <tr key={date} style={{ borderBottom: i < schoolDays.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <td style={{ padding: '0.5rem 1rem', color: 'var(--text)', fontWeight: 500 }}>{formatDate(date)}</td>
            {classes.map(cls => {
              const isOpen = capacitySlots.some(s => s.date === date && s.classId === cls.id)
              return (
                <td key={cls.id} style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                  {isOpen
                    ? <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--azalea)', background: 'var(--azalea-light)', borderRadius: '4px', padding: '0.15rem 0.4rem' }}>Open</span>
                    : <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                  }
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</section>
```

**Step 3: Commit**

```bash
git add app/\(admin\)/admin/dropins/page.tsx
git commit -m "feat: admin drop-in monthly capacity grid"
```

---

## Task 8: Availability Diff + Admin Notification on Edit

**Files:**
- Modify: `app/(parent)/parent/availability/actions.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/availability-diff.test.ts
import { describe, it, expect } from 'vitest'
import { computeAvailabilityDiff } from '@/lib/availability-utils'

describe('computeAvailabilityDiff', () => {
  it('detects added and removed dates', () => {
    const diff = computeAvailabilityDiff(
      { availableDates: ['2026-04-01', '2026-04-02'], absences: [] },
      { availableDates: ['2026-04-02', '2026-04-03'], absences: [] }
    )
    expect(diff.addedDates).toEqual(['2026-04-03'])
    expect(diff.removedDates).toEqual(['2026-04-01'])
  })

  it('detects added and removed absences', () => {
    const diff = computeAvailabilityDiff(
      { availableDates: [], absences: [{ child_id: 'c1', date: '2026-04-05' }] },
      { availableDates: [], absences: [{ child_id: 'c1', date: '2026-04-07' }] }
    )
    expect(diff.addedAbsences).toBe(1)
    expect(diff.removedAbsences).toBe(1)
  })

  it('returns isEmpty=true when nothing changed', () => {
    const diff = computeAvailabilityDiff(
      { availableDates: ['2026-04-01'], absences: [] },
      { availableDates: ['2026-04-01'], absences: [] }
    )
    expect(diff.isEmpty).toBe(true)
  })
})
```

Run: `npm test -- tests/unit/availability-diff.test.ts`
Expected: FAIL.

**Step 2: Create `lib/availability-utils.ts`**

```typescript
// lib/availability-utils.ts

export interface AvailabilitySnapshot {
  availableDates: string[]
  absences: { child_id: string; date: string }[]
}

export interface AvailabilityDiff {
  addedDates: string[]
  removedDates: string[]
  addedAbsences: number
  removedAbsences: number
  isEmpty: boolean
}

export function computeAvailabilityDiff(
  before: AvailabilitySnapshot,
  after: AvailabilitySnapshot
): AvailabilityDiff {
  const beforeDates = new Set(before.availableDates)
  const afterDates = new Set(after.availableDates)

  const addedDates = after.availableDates.filter(d => !beforeDates.has(d))
  const removedDates = before.availableDates.filter(d => !afterDates.has(d))

  const beforeAbsKeys = new Set(before.absences.map(a => `${a.child_id}:${a.date}`))
  const afterAbsKeys = new Set(after.absences.map(a => `${a.child_id}:${a.date}`))

  const addedAbsences = after.absences.filter(a => !beforeAbsKeys.has(`${a.child_id}:${a.date}`)).length
  const removedAbsences = before.absences.filter(a => !afterAbsKeys.has(`${a.child_id}:${a.date}`)).length

  const isEmpty = addedDates.length === 0 && removedDates.length === 0 && addedAbsences === 0 && removedAbsences === 0

  return { addedDates, removedDates, addedAbsences, removedAbsences, isEmpty }
}

/** Human-readable summary for the admin notification body */
export function diffSummary(diff: AvailabilityDiff): string {
  const parts: string[] = []
  if (diff.addedDates.length > 0) parts.push(`${diff.addedDates.length} date${diff.addedDates.length !== 1 ? 's' : ''} added`)
  if (diff.removedDates.length > 0) parts.push(`${diff.removedDates.length} date${diff.removedDates.length !== 1 ? 's' : ''} removed`)
  if (diff.addedAbsences > 0) parts.push(`${diff.addedAbsences} absence${diff.addedAbsences !== 1 ? 's' : ''} added`)
  if (diff.removedAbsences > 0) parts.push(`${diff.removedAbsences} absence${diff.removedAbsences !== 1 ? 's' : ''} removed`)
  return parts.join(', ')
}
```

Run test: `npm test -- tests/unit/availability-diff.test.ts`
Expected: PASS.

**Step 3: Update `submitAvailabilityAction` to diff + notify**

In `app/(parent)/parent/availability/actions.ts`, add at the top:

```typescript
import { computeAvailabilityDiff, diffSummary } from '@/lib/availability-utils'
import { notifyAdmins } from '@/lib/notifications'
```

Inside `submitAvailabilityAction`, before the upsert, add:

```typescript
// Check for existing submission — if found, compute diff and notify admin
const { data: existing } = await supabase
  .from('availability')
  .select('available_dates, planned_absences')
  .eq('family_id', familyId)
  .eq('period_month', periodMonth)
  .returns<{ available_dates: string[]; planned_absences: { child_id: string; date: string }[] }[]>()
  .maybeSingle()

const isEdit = !!existing
```

After the upsert succeeds, add:

```typescript
if (isEdit && existing) {
  const diff = computeAvailabilityDiff(
    { availableDates: existing.available_dates ?? [], absences: existing.planned_absences ?? [] },
    { availableDates: availableDates, absences: plannedAbsences }
  )
  if (!diff.isEmpty) {
    // Fetch family name for notification message
    const { data: famRow } = await supabase
      .from('families').select('name').eq('id', familyId)
      .returns<{ name: string }[]>().maybeSingle()
    const famName = famRow?.name ?? 'A family'
    const monthLabel = new Date(periodMonth).toLocaleString('en-US', { month: 'long', year: 'numeric' })

    await notifyAdmins(supabase, {
      title: `${famName} updated ${monthLabel} availability`,
      message: diffSummary(diff),
      type: 'availability',
      link: '/admin/schedule',
    }).catch(() => {}) // non-fatal
  }
}
```

**Step 4: Commit**

```bash
git add lib/availability-utils.ts tests/unit/availability-diff.test.ts app/\(parent\)/parent/availability/actions.ts
git commit -m "feat: notify admin when family edits submitted availability"
```

---

## Task 9: AvailabilityCalendar — Edit Mode Toggle

**Files:**
- Modify: `app/(parent)/parent/availability/page.tsx`
- Modify: `components/parent/AvailabilityCalendar.tsx`

**Step 1: Pass `hasExistingSubmission` prop from the page**

In `app/(parent)/parent/availability/page.tsx`, add:

```typescript
const hasExistingSubmission = initialAvailableDates.length > 0 || initialAbsences.length > 0
```

Pass it to `<AvailabilityCalendar hasExistingSubmission={hasExistingSubmission} ... />`.

**Step 2: Add edit mode toggle to `AvailabilityCalendar`**

Add `hasExistingSubmission?: boolean` to the component's props interface.

Add state at the top of the component:

```typescript
const [isEditing, setIsEditing] = useState(!hasExistingSubmission)
// If no prior submission → always in edit mode
// If prior submission → start in read-only mode
```

Wrap the calendar UI in a conditional:

```tsx
{!isEditing ? (
  // Read-only summary
  <div style={{ background: 'var(--warm-white)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
      <div>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>
          Availability submitted ✓
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
          {availableDates.length} volunteer day{availableDates.length !== 1 ? 's' : ''}
          {absences.length > 0 && ` · ${absences.length} absence${absences.length !== 1 ? 's' : ''}`}
        </div>
      </div>
      <button
        onClick={() => setIsEditing(true)}
        style={{
          background: 'transparent', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '0.45rem 0.9rem',
          fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text)',
        }}
      >
        Edit Availability
      </button>
    </div>
  </div>
) : (
  // Full calendar edit UI (existing JSX, unchanged)
  // Change the submit button label to "Save Changes" when hasExistingSubmission is true:
  // {hasExistingSubmission ? 'Save Changes' : 'Submit Availability'}
  <>
    {/* existing calendar JSX */}
  </>
)}
```

**Step 3: Commit**

```bash
git add app/\(parent\)/parent/availability/page.tsx components/parent/AvailabilityCalendar.tsx
git commit -m "feat: availability edit mode with read-only summary and Edit button"
```

---

## Task 10: Run All Tests + TypeScript Check

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All existing tests pass + new tests for `schedule-reassign`, `dropins-availability`, `availability-diff`.

**Step 2: TypeScript check**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

Expected: 0 errors.

**Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: cleanup and type fixes after feature implementation"
```

---

## Summary of New Files

| File | Purpose |
|---|---|
| `supabase/migrations/0011_school_settings_fees.sql` | Add missed_shift_fee + extra_shift_credit |
| `lib/schedule-utils.ts` | `computeConflictWarning` helper |
| `lib/availability-utils.ts` | `computeAvailabilityDiff` + `diffSummary` |
| `app/(admin)/admin/settings/actions.ts` | `updateSchoolSettingsAction` |
| `app/(admin)/admin/settings/page.tsx` | Settings page (server) |
| `app/(admin)/admin/settings/SettingsForm.tsx` | Settings form (client) |
| `tests/unit/schedule-reassign.test.ts` | Conflict warning tests |
| `tests/unit/dropins-availability.test.ts` | Drop-in slot tests |
| `tests/unit/availability-diff.test.ts` | Availability diff tests |
