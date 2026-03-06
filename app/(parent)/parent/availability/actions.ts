'use server'

/**
 * Availability form server actions.
 *
 * submitAvailabilityAction — upserts the family's availability record for a
 * given month. The unique constraint on (family_id, period_month) means a
 * second submission for the same month overwrites the first.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface PlannedAbsenceInput {
  child_id: string
  date: string
}

export async function submitAvailabilityAction(
  familyId: string,
  periodMonth: string, // YYYY-MM-01
  availableDates: string[],
  plannedAbsences: PlannedAbsenceInput[],
  extraShiftsWilling: string = '0'
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient()

  // Verify the current user actually belongs to this family
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userRow } = await supabase
    .from('users')
    .select('family_id')
    .eq('id', user.id)
    .returns<{ family_id: string | null }[]>()
    .maybeSingle()

  if (userRow?.family_id !== familyId) {
    return { error: 'Not authorized to update this family.' }
  }

  // Basic validation
  if (!periodMonth.match(/^\d{4}-\d{2}-01$/)) {
    return { error: 'Invalid period month format.' }
  }

  const VALID_WILLINGNESS = ['0', '1-2', '3-4', '5+']
  if (!VALID_WILLINGNESS.includes(extraShiftsWilling)) {
    return { error: 'Invalid extra shifts willingness value.' }
  }

  // Upsert — onConflict uses the unique index on (family_id, period_month).
  // The Supabase TS generic collapses to `never` for the availability table
  // because the planned_absences JSONB column's inferred type is incompatible.
  // We cast to `any` here; correctness is enforced by DB-level RLS policies.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  if (error) {
    return { error: 'Failed to save availability. Please try again.' }
  }

  return { success: true }
}
