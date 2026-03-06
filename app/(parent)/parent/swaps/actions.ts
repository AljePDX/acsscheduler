'use server'

/**
 * Swap server actions.
 *
 * requestSwapAction         — creates a new swap_request with status='open'.
 * cancelSwapAction          — cancels an open swap request (before admin acts on it).
 * acceptSwapCoverageAction  — covering family confirms they will cover the shift.
 *   Moves status from pending_covering_approval → pending_admin.
 *
 * declineSwapCoverageAction — covering family declines.
 *   Resets status to open and clears covering_family_id so other families can volunteer.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { notifyFamily, notifyAdmins } from '@/lib/notifications'

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

// ── Accept ────────────────────────────────────────────────────────────────────

export async function acceptSwapCoverageAction(
  swapId: string
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient()

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

  const familyId = userRow?.family_id
  if (!familyId) return { error: 'No family account found.' }

  // Verify this swap is actually addressed to this family
  const { data: swap } = await supabase
    .from('swap_requests')
    .select('id, covering_family_id, status')
    .eq('id', swapId)
    .returns<{ id: string; covering_family_id: string | null; status: string }[]>()
    .maybeSingle()

  if (!swap) return { error: 'Swap request not found.' }
  if (swap.covering_family_id !== familyId) return { error: 'Not authorised.' }
  if (swap.status !== 'pending_covering_approval') {
    return { error: 'This swap is no longer awaiting your response.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('swap_requests') as any)
    .update({ status: 'pending_admin' })
    .eq('id', swapId)

  if (error) return { error: 'Failed to accept swap. Please try again.' }

  // Notify admins that a swap is ready for final approval — non-blocking
  try {
    await notifyAdmins(supabase, {
      title: 'Swap Ready for Review',
      message: 'A covering family has accepted a swap request. Please review and approve or reject it.',
      type: 'swap',
      link: '/admin/swaps',
    })
  } catch (err) {
    console.error('[acceptSwapCoverageAction] Notification error (non-fatal):', err)
  }

  return { success: true }
}

// ── Decline ───────────────────────────────────────────────────────────────────

export async function declineSwapCoverageAction(
  swapId: string
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient()

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

  const familyId = userRow?.family_id
  if (!familyId) return { error: 'No family account found.' }

  const { data: swap } = await supabase
    .from('swap_requests')
    .select('id, covering_family_id, status')
    .eq('id', swapId)
    .returns<{ id: string; covering_family_id: string | null; status: string }[]>()
    .maybeSingle()

  if (!swap) return { error: 'Swap request not found.' }
  if (swap.covering_family_id !== familyId) return { error: 'Not authorised.' }
  if (swap.status !== 'pending_covering_approval') {
    return { error: 'This swap is no longer awaiting your response.' }
  }

  // Reset to open so another family can volunteer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('swap_requests') as any)
    .update({ status: 'open', covering_family_id: null })
    .eq('id', swapId)

  if (error) return { error: 'Failed to decline swap. Please try again.' }

  // Notify the requesting family that coverage was declined — non-blocking.
  // Swap.covering_family_id was the declining family; we need requesting_family_id.
  try {
    const { data: fullSwap } = await supabase
      .from('swap_requests')
      .select('requesting_family_id')
      .eq('id', swapId)
      .returns<{ requesting_family_id: string }[]>()
      .maybeSingle()

    if (fullSwap) {
      await notifyFamily(supabase, fullSwap.requesting_family_id, {
        title: 'Swap Coverage Declined',
        message: 'The family you selected declined to cover your shift. Your swap request is open again — please select another family.',
        type: 'swap',
        link: '/parent/swaps',
      })
    }
  } catch (err) {
    console.error('[declineSwapCoverageAction] Notification error (non-fatal):', err)
  }

  return { success: true }
}
