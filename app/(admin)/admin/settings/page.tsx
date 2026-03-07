import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SettingsForm } from './SettingsForm'
import type { SchoolSettingsRow } from '@/lib/types'

export const metadata = { title: 'Admin · Settings' }

export default async function AdminSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userRow } = await supabase
    .from('users').select('role').eq('id', user.id)
    .returns<{ role: string }[]>().maybeSingle()
  if (userRow?.role !== 'admin') redirect('/parent/dashboard')

  let settings: SchoolSettingsRow | null = null
  try {
    const { data } = await supabase
      .from('school_settings').select('*').eq('id', 1)
      .returns<SchoolSettingsRow[]>().maybeSingle()
    settings = data
  } catch { /* not configured */ }

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{
          fontFamily: 'var(--font-playfair), "Playfair Display", serif',
          fontSize: '1.5rem', fontWeight: 500, color: 'var(--text)', margin: '0 0 0.35rem',
        }}>
          School Settings
        </h1>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Fee amounts used across the scheduler. Changes take effect immediately.
        </p>
      </div>
      <SettingsForm settings={settings} />
    </div>
  )
}
