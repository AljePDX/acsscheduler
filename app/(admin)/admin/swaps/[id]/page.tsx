/**
 * Admin swap detail page — /admin/swaps/[id]
 *
 * Server component. Fetches the swap request and builds the sorted list
 * of eligible covering families for admin selection.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SwapDetailClient from './SwapDetailClient'
import type { ExtraShiftsWilling } from '@/lib/types'

interface PageProps {
  params: { id: string }
}

export default async function AdminSwapDetailPage({ params }: PageProps) {
  const supabase = await createClient()

  // Auth + admin guard
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ur } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .returns<{ role: string }[]>()
    .maybeSingle()
  if (ur?.role !== 'admin') redirect('/parent/dashboard')

  const swapId = params.id

  // Fetch swap with shift + class + requesting family
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: swap } = await (supabase as any)
    .from('swap_requests')
    .select('id, status, reason, requesting_family_id, shift_id, shifts(date, classes(name)), families!requesting_family_id(name)')
    .eq('id', swapId)
    .maybeSingle()

  if (!swap) redirect('/admin/swaps')

  const shiftDate: string = swap.shifts?.date ?? ''
  // First day of shift's month for availability lookup
  const shiftMonth = shiftDate.slice(0, 7) + '-01' // YYYY-MM-01

  // Compute last day of shift's month for confirmed-shifts count range
  const [yr, mo] = shiftDate.split('-').map(Number)
  const lastDay = new Date(yr, mo, 0).getDate()
  const monthEnd = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Fetch availability records for the shift's month
  const { data: avail } = await supabase
    .from('availability')
    .select('family_id, available_dates, extra_shifts_willing')
    .eq('period_month', shiftMonth)
    .returns<{ family_id: string; available_dates: string[]; extra_shifts_willing: string }[]>()

  // Filter: must have submitted AND have the shift date in their available_dates
  // Exclude the requesting family
  const eligibleAvail = (avail ?? []).filter(a =>
    a.family_id !== swap.requesting_family_id &&
    a.available_dates.includes(shiftDate)
  )

  const eligibleFamilyIds = eligibleAvail.map(a => a.family_id)

  if (eligibleFamilyIds.length === 0) {
    return (
      <SwapDetailClient
        swapId={swapId}
        shiftDate={shiftDate}
        className={swap.shifts?.classes?.name ?? ''}
        requestingFamily={swap.families?.name ?? ''}
        reason={swap.reason ?? null}
        status={swap.status}
        eligibleFamilies={[]}
      />
    )
  }

  // Parallel: family names, confirmed shift counts this month, conflicts
  const [familiesRes, shiftsCountRes, conflictsRes] = await Promise.all([
    supabase
      .from('families')
      .select('id, name')
      .in('id', eligibleFamilyIds)
      .returns<{ id: string; name: string }[]>(),

    supabase
      .from('shifts')
      .select('family_id')
      .in('family_id', eligibleFamilyIds)
      .eq('status', 'confirmed')
      .gte('date', shiftMonth)
      .lte('date', monthEnd)
      .returns<{ family_id: string }[]>(),

    supabase
      .from('family_conflicts')
      .select('family_a_id, family_b_id')
      .or(`family_a_id.eq.${swap.requesting_family_id},family_b_id.eq.${swap.requesting_family_id}`)
      .returns<{ family_a_id: string; family_b_id: string }[]>(),
  ])

  // Build count map
  const shiftCountMap = new Map<string, number>()
  ;(shiftsCountRes.data ?? []).forEach(s => {
    shiftCountMap.set(s.family_id, (shiftCountMap.get(s.family_id) ?? 0) + 1)
  })

  // Build conflict set (IDs of families that conflict with requesting family)
  const conflictSet = new Set(
    (conflictsRes.data ?? []).map(c =>
      c.family_a_id === swap.requesting_family_id ? c.family_b_id : c.family_a_id
    )
  )

  // Map availability data by family_id
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
      reason={swap.reason ?? null}
      status={swap.status}
      eligibleFamilies={eligibleFamilies}
    />
  )
}
