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
