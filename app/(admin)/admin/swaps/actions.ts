'use server'

/**
 * Admin swap server actions.
 *
 * approveSwapAction — multi-step:
 *   1. Updates swap status → 'approved'
 *   2. Reassigns the shift to the covering family
 *   3. Creates a makeup_debt for the requesting family
 *
 * rejectSwapAction — updates swap status → 'rejected'.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { notifyFamily } from '@/lib/notifications'
import { sendEmail, emailHtml } from '@/lib/email'

// ── Shared admin guard ────────────────────────────────────────────────────────

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .returns<{ role: string }[]>()
    .maybeSingle()

  if (userRow?.role !== 'admin') redirect('/parent/dashboard')
  return supabase
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approveSwapAction(
  swapId: string,
  coveringFamilyId: string
): Promise<{ error?: string }> {
  const supabase = await requireAdmin()

  // Fetch the swap
  const { data: swap } = await supabase
    .from('swap_requests')
    .select('id, shift_id, requesting_family_id, covering_family_id, status')
    .eq('id', swapId)
    .returns<{
      id: string
      shift_id: string
      requesting_family_id: string
      covering_family_id: string | null
      status: string
    }[]>()
    .maybeSingle()

  if (!swap || swap.status !== 'open') {
    return { error: 'Swap request is no longer open.' }
  }

  const today = new Date()
  const debtDate = today.toISOString().split('T')[0]
  const dueMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`

  // 1. Update swap → approved, set covering_family_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('swap_requests') as any)
    .update({ status: 'approved', covering_family_id: coveringFamilyId })
    .eq('id', swapId)

  // 2. Reassign shift to covering family
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('shifts') as any)
    .update({ family_id: coveringFamilyId, conflict_warning: false })
    .eq('id', swap.shift_id)

  // 3. Create makeup debt for the requesting family
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('makeup_debts') as any).insert({
    family_id: swap.requesting_family_id,
    swap_request_id: swapId,
    debt_date: debtDate,
    due_month: dueMonth,
    status: 'outstanding',
  })

  // 4. Notify both families — non-blocking
  try {
    const { data: families } = await supabase
      .from('families')
      .select('id, email')
      .in('id', [swap.requesting_family_id, coveringFamilyId])
      .returns<{ id: string; email: string }[]>()

    const familyMap = new Map(families?.map(f => [f.id, f.email]) ?? [])

    // Notify requesting family: swap approved, makeup debt created
    await notifyFamily(supabase, swap.requesting_family_id, {
      title: 'Swap Approved',
      message: 'Your swap request has been approved. A makeup debt has been added to your account.',
      type: 'swap',
      link: '/parent/makeup',
    })
    const requestingEmail = familyMap.get(swap.requesting_family_id)
    if (requestingEmail) {
      await sendEmail({
        to: requestingEmail,
        subject: 'Bloom: Your swap request was approved',
        html: emailHtml(
          'Swap Approved',
          'Your swap request has been approved. A makeup debt has been added to your account — please resolve it before the end of the month.',
          '/parent/makeup',
          'View Makeup Debt'
        ),
      })
    }

    // Notify covering family: shift confirmed
    await notifyFamily(supabase, coveringFamilyId, {
      title: 'Swap Confirmed',
      message: 'You have been confirmed as the covering volunteer for a shift. Check your schedule for the updated assignment.',
      type: 'swap',
      link: '/parent/schedule',
    })
    const coveringEmail = familyMap.get(coveringFamilyId)
    if (coveringEmail) {
      await sendEmail({
        to: coveringEmail,
        subject: 'Bloom: Your swap coverage has been confirmed',
        html: emailHtml(
          'Swap Coverage Confirmed',
          'Your offer to cover a shift has been approved by the administrator. The shift is now on your schedule.',
          '/parent/schedule',
          'View My Schedule'
        ),
      })
    }
  } catch (err) {
    console.error('[approveSwapAction] Notification error (non-fatal):', err)
  }

  revalidatePath('/admin/swaps')
  revalidatePath(`/admin/swaps/${swapId}`)
  return {}
}

// ── Reject ────────────────────────────────────────────────────────────────────

export async function rejectSwapAction(swapId: string) {
  const supabase = await requireAdmin()

  // Fetch swap first to get the requesting family for notification
  const { data: swap } = await supabase
    .from('swap_requests')
    .select('requesting_family_id')
    .eq('id', swapId)
    .returns<{ requesting_family_id: string }[]>()
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('swap_requests') as any)
    .update({ status: 'rejected' })
    .eq('id', swapId)

  // Notify requesting family — non-blocking
  if (swap) {
    try {
      await notifyFamily(supabase, swap.requesting_family_id, {
        title: 'Swap Request Rejected',
        message: 'Your swap request was not approved by the administrator. Please contact the school for more information.',
        type: 'swap',
        link: '/parent/swaps',
      })
      const { data: family } = await supabase
        .from('families').select('email').eq('id', swap.requesting_family_id)
        .returns<{ email: string }[]>().maybeSingle()
      if (family?.email) {
        await sendEmail({
          to: family.email,
          subject: 'Bloom: Your swap request was not approved',
          html: emailHtml(
            'Swap Request Not Approved',
            'Your swap request has been reviewed and was not approved. Please contact the school for more information.',
            '/parent/swaps',
            'View Swap Requests'
          ),
        })
      }
    } catch (err) {
      console.error('[rejectSwapAction] Notification error (non-fatal):', err)
    }
  }

  revalidatePath('/admin/swaps')
  revalidatePath(`/admin/swaps/${swapId}`)
}
