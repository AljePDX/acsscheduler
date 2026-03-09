/**
 * Admin Schedule — /admin/schedule
 *
 * Server component. Fetches all shifts for the month, joins with family names
 * and class names, then passes enriched data to the AdminScheduleCalendar client component.
 *
 * Month controlled via ?year=YYYY&month=M search params; defaults to current month.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRequiredShifts } from '@/lib/shifts'
import { AdminScheduleCalendar } from './AdminScheduleCalendar'
import type { ShiftRow, ClassRow, FamilyRow, ChildRow, FamilyConflictRow } from '@/lib/types'
import type { EnrichedShift } from './AdminScheduleCalendar'

export const metadata = { title: 'Admin · Schedule' }

// Per-family availability info used in the Day Panel
type FamilyAvailInfo = {
  availableDates: string[]
  preferredDates: string[]
  notes: string | null
}

interface SearchParams {
  year?: string
  month?: string
}

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Determine target month ─────────────────────────────────────────────────
  let targetYear: number
  let targetMonth: number

  if (searchParams.year && searchParams.month) {
    targetYear = parseInt(searchParams.year, 10)
    targetMonth = parseInt(searchParams.month, 10)
  } else {
    const now = new Date()
    targetYear = now.getFullYear()
    targetMonth = now.getMonth() + 1
  }

  // ── Fetch data ─────────────────────────────────────────────────────────────
  let shifts: EnrichedShift[] = []
  let classes: ClassRow[] = []
  let holidayDates: string[] = []
  let hasConflicts = false
  let hasProposed = false
  let familyStats: { id: string; name: string; required: number; assigned: number }[] = []
  let conflictPairs: FamilyConflictRow[] = []
  const familyAvailability: Record<string, FamilyAvailInfo> = {}

  try {
    const mm = String(targetMonth).padStart(2, '0')
    const lastDay = new Date(targetYear, targetMonth, 0).getDate()
    const periodStart = `${targetYear}-${mm}-01`
    const periodEnd = `${targetYear}-${mm}-${String(lastDay).padStart(2, '0')}`

    const [shiftsRes, classesRes, familiesRes, childrenRes, holidaysRes, conflictPairsRes, availRes] =
      await Promise.all([
        supabase
          .from('shifts')
          .select('*')
          .gte('date', periodStart)
          .lte('date', periodEnd)
          .order('date', { ascending: true }),

        supabase.from('classes').select('*'),

        supabase.from('families').select('*'),

        supabase.from('children').select('*'),

        supabase
          .from('holidays')
          .select('date')
          .gte('date', periodStart)
          .lte('date', periodEnd),

        supabase.from('family_conflicts').select('family_a_id, family_b_id'),

        supabase
          .from('availability')
          .select('family_id, available_dates, preferred_dates, notes')
          .eq('period_month', periodStart),
      ])

    const rawShifts = (shiftsRes.data as ShiftRow[]) ?? []
    classes = (classesRes.data as ClassRow[]) ?? []
    const families = (familiesRes.data as FamilyRow[]) ?? []
    const children = (childrenRes.data as ChildRow[]) ?? []
    holidayDates = (holidaysRes.data ?? []).map((h: { date: string }) => h.date)
    conflictPairs = (conflictPairsRes.data as FamilyConflictRow[]) ?? []

    // Build lookup maps
    const familyMap = new Map(families.map(f => [f.id, f.name]))
    const classMap = new Map(classes.map(c => [c.id, c]))

    // Enrich shifts with readable names
    shifts = rawShifts.map(s => {
      const cls = classMap.get(s.class_id)
      return {
        id: s.id,
        date: s.date,
        classId: s.class_id,
        className: cls?.name ?? 'Unknown',
        familyId: s.family_id ?? null,                                               // nullable
        familyName: s.family_id ? (familyMap.get(s.family_id) ?? 'Unknown') : '—',  // fallback
        status: s.status,
        conflictWarning: s.conflict_warning,
      }
    })

    hasConflicts = rawShifts.some(s => s.conflict_warning && s.status === 'proposed')
    hasProposed = rawShifts.some(s => s.status === 'proposed')

    // Build per-family children lookup
    const childrenByFamily = new Map<string, ChildRow[]>()
    for (const child of children) {
      const list = childrenByFamily.get(child.family_id) ?? []
      list.push(child)
      childrenByFamily.set(child.family_id, list)
    }

    // Compute family stats: required shifts vs. assigned this month
    const monthShifts = rawShifts as { family_id: string; status: string }[]
    familyStats = families.map(fam => {
      const famChildren = childrenByFamily.get(fam.id) ?? []
      const required = getRequiredShifts(fam, famChildren) ?? 0
      const assigned = monthShifts.filter(
        s => s.family_id === fam.id && (s.status === 'proposed' || s.status === 'confirmed')
      ).length
      return { id: fam.id, name: fam.name, required, assigned }
    })

    // Build per-family availability info for the Day Panel
    for (const row of ((availRes.data ?? []) as { family_id: string; available_dates: string[]; preferred_dates: string[]; notes: string | null }[])) {
      familyAvailability[row.family_id] = {
        availableDates: row.available_dates ?? [],
        preferredDates: row.preferred_dates ?? [],
        notes: row.notes ?? null,
      }
    }
  } catch {
    // Supabase not configured — render with empty state
  }

  return (
    <AdminScheduleCalendar
      year={targetYear}
      month={targetMonth}
      shifts={shifts}
      classes={classes}
      holidayDates={holidayDates}
      hasConflicts={hasConflicts}
      hasProposed={hasProposed}
      familyStats={familyStats}
      conflictPairs={conflictPairs}
      familyAvailability={familyAvailability}
    />
  )
}
