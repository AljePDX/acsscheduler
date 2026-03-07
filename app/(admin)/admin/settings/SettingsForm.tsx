'use client'

import { useState, useTransition } from 'react'
import { updateSchoolSettingsAction } from './actions'
import type { SchoolSettingsRow } from '@/lib/types'

interface Props { settings: SchoolSettingsRow | null }

const FIELDS: { key: keyof SchoolSettingsRow; label: string; description: string }[] = [
  { key: 'dropin_fee',              label: 'Drop-in Fee',        description: 'Flat fee per drop-in day' },
  { key: 'buyout_amount_per_shift', label: 'Buyout Amount',      description: 'Cost to buy out a scheduled shift or makeup debt' },
  { key: 'missed_shift_fee',        label: 'Missed Shift Fee',   description: 'Fee charged when a shift is marked as missed' },
  { key: 'extra_shift_credit',      label: 'Extra Shift Credit', description: 'Credit earned for completing a shift beyond the monthly requirement' },
]

export function SettingsForm({ settings }: Props) {
  const [values, setValues] = useState({
    dropin_fee:              settings?.dropin_fee ?? 0,
    buyout_amount_per_shift: settings?.buyout_amount_per_shift ?? 0,
    missed_shift_fee:        settings?.missed_shift_fee ?? 0,
    extra_shift_credit:      settings?.extra_shift_credit ?? 0,
  })
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await updateSchoolSettingsAction(values)
      if (res.error) { setError(res.error) } else { setSaved(true) }
    })
  }

  return (
    <div style={{ background: 'var(--warm-white)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem' }}>
      {FIELDS.map(({ key, label, description }) => (
        <div key={key} style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label}
          </label>
          <p style={{ margin: '0 0 0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{description}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={values[key as keyof typeof values]}
              onChange={e => setValues(v => ({ ...v, [key]: parseFloat(e.target.value) || 0 }))}
              style={{
                width: '120px', padding: '0.5rem 0.75rem',
                border: '1px solid var(--border)', borderRadius: '8px',
                fontSize: '0.95rem', background: 'var(--cream)', color: 'var(--text)',
              }}
            />
          </div>
        </div>
      ))}
      {error && <p style={{ fontSize: '0.85rem', color: 'var(--danger)', marginBottom: '0.75rem' }}>{error}</p>}
      {saved && <p style={{ fontSize: '0.85rem', color: 'var(--sage-dark)', marginBottom: '0.75rem' }}>Settings saved.</p>}
      <button
        onClick={handleSave}
        disabled={isPending}
        style={{
          background: 'var(--sage)', color: 'white', border: 'none',
          borderRadius: '8px', padding: '0.6rem 1.25rem',
          fontSize: '0.875rem', fontWeight: 500,
          cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  )
}
