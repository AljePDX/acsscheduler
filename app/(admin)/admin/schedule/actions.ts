'use server'

/**
 * Admin schedule server actions.
 *
 * proposeScheduleAction — gathers all data needed by the schedule algorithm,
 *   runs proposeSchedule(), wipes existing proposed shifts for the month,
 *   and inserts the new draft. Returns a summary for the admin to review.
 *
 * publishScheduleAction — promotes all proposed shifts for the month to
 *   'confirmed' status. Admin must have acknowledged any conflict warnings
 *   before calling this (enforced client-side; no server block).
 */

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { proposeSchedule } from '@/lib/schedule'
import { notifyFamilies } from '@/lib/notifications'
import { sendEmail, emailHtml } from '@/lib/email'
import { computeConflictWarning } from '@/lib/schedule-utils'
import type {
  FamilyRow,
  ChildRow,
  ClassRow,
  AvailabilityRow,
  FamilyConflictRow,
} from '@/lib/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function periodBounds(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  }
}

async function verifyAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .returns<{ role: string }[]>()
    .maybeSingle()

  if (userRow?.role !== 'admin') redirect('/parent/dashboard')
  return user
}

// ── Propose ───────────────────────────────────────────────────────────────────

export interface ProposalSummary {
  shiftCount: number
  conflictCount: number
  unmetFamilyIds: string[]
  unfilledSlots: { date: string; class_id: string; needed: number; assigned: number }[]
}

export async function proposeScheduleAction(
  year: number,
  month: number
): Promise<{ error?: string; summary?: ProposalSummary }> {
  const supabase = await createClient()
  await verifyAdmin(supabase)

  const { start, end } = periodBounds(year, month)

  try {
    // Fetch everything the algorithm needs in parallel
    const [
      familiesRes,
      childrenRes,
      classesRes,
      availRes,
      conflictsRes,
      holidaysRes,
      dropinsRes,
    ] = await Promise.all([
      supabase.from('families').select('*'),
      supabase.from('children').select('*'),
      supabase.from('classes').select('*'),
      supabase.from('availability').select('*').eq('period_month', start),
      supabase.from('family_conflicts').select('*'),
      supabase.from('holidays').select('date').gte('date', start).lte('date', end),
      supabase
        .from('dropin_requests')
        .select('class_id, date')
        .eq('status', 'approved')
        .gte('date', start)
        .lte('date', end),
    ])

    const families = (familiesRes.data as FamilyRow[]) ?? []
    const children = (childrenRes.data as ChildRow[]) ?? []
    const classes = (classesRes.data as ClassRow[]) ?? []
    const availability = (availRes.data as AvailabilityRow[]) ?? []
    const conflicts = (conflictsRes.data as FamilyConflictRow[]) ?? []
    const holidayDates = new Set(
      (holidaysRes.data ?? []).map((h: { date: string }) => h.date)
    )

    // Build drop-in counts keyed by `${class_id}:${date}`
    const dropinCounts: Record<string, number> = {}
    for (const d of (dropinsRes.data as { class_id: string; date: string }[]) ?? []) {
      const key = `${d.class_id}:${d.date}`
      dropinCounts[key] = (dropinCounts[key] ?? 0) + 1
    }

    // Run the pure algorithm
    const result = proposeSchedule({
      year,
      month,
      families,
      children,
      classes,
      availability,
      conflicts,
      holidayDates,
      dropinCounts,
    })

    // Wipe existing PROPOSED shifts for the month — leave confirmed/completed untouched
    const { error: deleteError } = await supabase
      .from('shifts')
      .delete()
      .eq('status', 'proposed')
      .gte('date', start)
      .lte('date', end)

    if (deleteError) return { error: 'Failed to clear previous draft. Please try again.' }

    // Insert new proposed shifts
    if (result.shifts.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertError } = await (supabase.from('shifts') as any).insert(
        result.shifts.map(s => ({
          date: s.date,
          class_id: s.class_id,
          family_id: s.family_id,
          status: 'proposed',
          conflict_warning: s.conflict_warning,
        }))
      )

      if (insertError) return { error: 'Failed to save proposed schedule. Please try again.' }
    }

    const conflictCount = result.shifts.filter(s => s.conflict_warning).length

    return {
      summary: {
        shiftCount: result.shifts.length,
        conflictCount,
        unmetFamilyIds: result.unmetFamilies,
        unfilledSlots: result.unfilledSlots,
      },
    }
  } catch (err) {
    console.error('[proposeScheduleAction]', err)
    return { error: 'An unexpected error occurred. Please try again.' }
  }
}

// ── Publish ───────────────────────────────────────────────────────────────────

export async function publishScheduleAction(
  year: number,
  month: number
): Promise<{ error?: string; success?: boolean; publishedCount?: number }> {
  const supabase = await createClient()
  await verifyAdmin(supabase)

  const { start, end } = periodBounds(year, month)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (supabase.from('shifts') as any)
      .update({ status: 'confirmed' })
      .eq('status', 'proposed')
      .gte('date', start)
      .lte('date', end)
      .select()

    if (error) return { error: 'Failed to publish schedule. Please try again.' }

    // Notify all families — non-blocking, best-effort
    try {
      const { data: allFamilies } = await supabase
        .from('families')
        .select('id, email')
        .returns<{ id: string; email: string }[]>()

      if (allFamilies && allFamilies.length > 0) {
        const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', {
          month: 'long', year: 'numeric',
        })
        await notifyFamilies(
          supabase,
          allFamilies.map(f => f.id),
          {
            title: 'Schedule Published',
            message: `Your volunteer schedule for ${monthName} has been published. Log in to see your assigned shifts.`,
            type: 'schedule',
            link: '/parent/schedule',
          }
        )
        // Send emails in parallel
        await Promise.all(
          allFamilies.map(f =>
            sendEmail({
              to: f.email,
              subject: `Bloom: ${monthName} Schedule Published`,
              html: emailHtml(
                `${monthName} Schedule Published`,
                `Your volunteer schedule for ${monthName} has been published. Please log in to view your assigned shifts.`,
                '/parent/schedule',
                'View My Schedule'
              ),
            })
          )
        )
      }
    } catch (notifyErr) {
      console.error('[publishScheduleAction] Notification error (non-fatal):', notifyErr)
    }

    return { success: true, publishedCount: count ?? 0 }
  } catch (err) {
    console.error('[publishScheduleAction]', err)
    return { error: 'An unexpected error occurred. Please try again.' }
  }
}

// ── Reassign ──────────────────────────────────────────────────────────────────

export async function reassignShiftAction(
  shiftId: string,
  newFamilyId: string
): Promise<{ error?: string }> {
  const supabase = await createClient()
  await verifyAdmin(supabase)

  const { data: shift } = await supabase
    .from('shifts')
    .select('id, date, class_id')
    .eq('id', shiftId)
    .returns<{ id: string; date: string; class_id: string }[]>()
    .maybeSingle()

  if (!shift) return { error: 'Shift not found.' }

  const { data: sameDayShifts } = await supabase
    .from('shifts')
    .select('family_id')
    .eq('date', shift.date)
    .neq('id', shiftId)
    .returns<{ family_id: string }[]>()

  const otherFamilyIds = (sameDayShifts ?? []).map(s => s.family_id)

  const { data: conflictRows } = await supabase
    .from('family_conflicts')
    .select('family_a_id, family_b_id')
    .returns<FamilyConflictRow[]>()

  const conflictWarning = computeConflictWarning(
    newFamilyId,
    otherFamilyIds,
    conflictRows ?? []
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('shifts') as any)
    .update({ family_id: newFamilyId, conflict_warning: conflictWarning })
    .eq('id', shiftId)

  if (error) return { error: error.message }
  revalidatePath('/admin/schedule')
  return {}
}
