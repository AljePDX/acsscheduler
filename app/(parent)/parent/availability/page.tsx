/**
 * Availability page — /parent/availability
 *
 * Server component. Fetches all data for the selected month and passes it
 * to the client-side AvailabilityCalendar component.
 *
 * Month is controlled via ?year=YYYY&month=M URL search params.
 * Defaults to next calendar month (families submit for upcoming months).
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRequiredShifts } from '@/lib/shifts'
import { AvailabilityCalendar } from '@/components/parent/AvailabilityCalendar'
import type { ChildRow, PlannedAbsence, SchoolSettingsRow } from '@/lib/types'

export const metadata = { title: 'Availability' }

// ── Ordinal helper (e.g. 20 → “20th”) ─────────────────────────────────────────────
function ordinal(n: number): string {
  const v = n % 100
  const s = ['th', 'st', 'nd', 'rd']
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

// ── Page ────────────────────────────────────────────────────────────────────────────

interface SearchParams {
  year?: string
  month?: string
}

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Determine target month ───────────────────────────────────────────
  let targetYear: number
  let targetMonth: number

  if (searchParams.year && searchParams.month) {
    targetYear = parseInt(searchParams.year, 10)
    targetMonth = parseInt(searchParams.month, 10)
  } else {
    // Default: next calendar month
    const next = new Date()
    next.setMonth(next.getMonth() + 1)
    targetYear = next.getFullYear()
    targetMonth = next.getMonth() + 1 // getMonth() is 0-based
  }

  // ── Fetch all page data ──────────────────────────────────────────────────────
  let familyId: string | null = null
  let children: ChildRow[] = []
  let holidayDates: string[] = []
  let initialAvailableDates: string[] = []
  let initialAbsences: PlannedAbsence[] = []
  let initialExtraShiftsWilling = '0'
  let requiredShifts: number | null = null
  let deadlineDay: number | null = null

  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('family_id')
      .eq('id', user.id)
      .returns<{ family_id: string | null }[]>()
      .maybeSingle()

    familyId = userRow?.family_id ?? null

    if (familyId) {
      const periodMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
      const lastDay = new Date(targetYear, targetMonth, 0).getDate()
      const monthEnd = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

      const [childrenRes, holidayRes, availRes, settingsRes] = await Promise.all([
        supabase.from('children').select('*').eq('family_id', familyId),

        supabase
          .from('holidays')
          .select('date')
          .gte('date', periodMonth)
          .lte('date', monthEnd),

        supabase
          .from('availability')
          .select('available_dates, planned_absences, extra_shifts_willing')
          .eq('family_id', familyId)
          .eq('period_month', periodMonth)
          .returns<{ available_dates: string[]; planned_absences: PlannedAbsence[]; extra_shifts_willing: string }[]>()
          .maybeSingle(),

        supabase
          .from('school_settings')
          .select('availability_deadline_day')
          .eq('id', 1)
          .returns<Pick<SchoolSettingsRow, 'availability_deadline_day'>[]>()
          .maybeSingle(),
      ])

      children = (childrenRes.data as ChildRow[]) ?? []
      holidayDates = (holidayRes.data ?? []).map((h: { date: string }) => h.date)
      initialAvailableDates = availRes.data?.available_dates ?? []
      initialAbsences = (availRes.data?.planned_absences as PlannedAbsence[]) ?? []
      initialExtraShiftsWilling = availRes.data?.extra_shifts_willing ?? '0'
      requiredShifts = getRequiredShifts({ shift_override: null }, children)
      deadlineDay = settingsRes.data?.availability_deadline_day ?? null
    }
  } catch {
    // Supabase not yet configured — render with empty state
  }

  const hasExistingSubmission = initialAvailableDates.length > 0 || initialAbsences.length > 0

  return (
    <div
      style={{
        maxWidth: '720px',
        margin: '0 auto',
        padding: '1.5rem 1rem',
      }}
    >
      {/* ── Heading ──────────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), "Playfair Display", serif',
            fontSize: '1.5rem',
            fontWeight: 500,
            color: 'var(--text)',
            margin: '0 0 0.35rem',
          }}
        >
          Availability
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}
        >
          Select days you&apos;re available to volunteer, and mark any days your
          child will be absent.{' '}
          {deadlineDay !== null && (
            <>
              Submit by the <strong>{ordinal(deadlineDay)}</strong> of each month.
            </>
          )}
        </p>
      </div>

      {/* ── Calendar ─────────────────────────────────────────────────────────────────── */}
      {/* Always render the calendar — familyId nullable; save is blocked client-side if null */}
      <AvailabilityCalendar
        year={targetYear}
        month={targetMonth}
        familyId={familyId}
        familyChildren={children}
        holidayDates={holidayDates}
        initialAvailableDates={initialAvailableDates}
        initialAbsences={initialAbsences}
        initialExtraShiftsWilling={initialExtraShiftsWilling}
        requiredShifts={requiredShifts}
        hasExistingSubmission={hasExistingSubmission}
      />
    </div>
  )
}
