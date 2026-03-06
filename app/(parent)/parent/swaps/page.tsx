/**
 * Parent swaps page — /parent/swaps
 *
 * Server component. Fetches upcoming shifts + swap request history,
 * passes to SwapsClient for interactivity.
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
      .select('id, date, status, classes(name)')
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shifts = (shiftsRes.data ?? []).map((s: any) => ({
    id: s.id as string,
    date: s.date as string,
    class_name: (s.classes?.name ?? 'Unknown') as string,
    status: s.status as string,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const swapRequests = (swapsRes.data ?? []).map((sr: any) => ({
    id: sr.id as string,
    shift_date: (sr.shifts?.date ?? '') as string,
    class_name: (sr.shifts?.classes?.name ?? 'Unknown') as string,
    reason: sr.reason as string | null,
    status: sr.status as string,
    created_at: sr.created_at as string,
  }))

  return <SwapsClient shifts={shifts} swapRequests={swapRequests} />
}
