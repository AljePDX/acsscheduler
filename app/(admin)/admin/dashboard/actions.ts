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

  const { data: ur } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .returns<{ role: string }[]>()
    .maybeSingle()

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

  const monthDate = new Date(targetMonth + 'T00:00:00Z')
  const monthLabel = monthDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

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
          `Hi ${family.name} Family,<br><br>Please submit your availability for ${monthLabel} so we can schedule your volunteer shifts. If you have any planned absences, be sure to mark those too.`,
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
