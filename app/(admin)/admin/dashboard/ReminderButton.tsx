'use client'

/**
 * ReminderButton — shows availability submission progress for a month
 * and lets admin send reminder emails to families who haven't submitted.
 */

import { useState, useTransition } from 'react'
import { sendAvailabilityRemindersAction } from './actions'

interface ReminderButtonProps {
  targetMonth: string   // YYYY-MM-01
  monthLabel: string    // e.g. "April 2026"
  totalFamilies: number
  submittedCount: number
}

export function ReminderButton({
  targetMonth,
  monthLabel,
  totalFamilies,
  submittedCount,
}: ReminderButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ sent: number; skipped: number; failed: number } | null>(null)

  const unsubmittedCount = Math.max(0, totalFamilies - submittedCount)
  const progressPct = totalFamilies > 0 ? Math.round((submittedCount / totalFamilies) * 100) : 0

  function handleSend() {
    startTransition(async () => {
      const r = await sendAvailabilityRemindersAction(targetMonth)
      if (!r.error) setResult(r)
    })
  }

  return (
    <div style={{
      background: 'var(--warm-white)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '1.25rem',
      marginTop: '1.75rem',
    }}>
      <h2 className="label-section" style={{ margin: '0 0 0.75rem' }}>
        {monthLabel} Availability
      </h2>

      {/* Progress bar */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{
          height: '6px',
          borderRadius: '3px',
          background: 'var(--border)',
          overflow: 'hidden',
          marginBottom: '0.4rem',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPct}%`,
            background: 'var(--sage)',
            borderRadius: '3px',
            transition: 'width 0.3s ease',
          }} />
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          {submittedCount} of {totalFamilies} families have submitted
        </p>
      </div>

      {/* Result toast */}
      {result && (
        <div style={{
          padding: '0.65rem 0.9rem',
          borderRadius: '8px',
          background: 'var(--sage-light)',
          color: 'var(--sage-dark)',
          fontSize: '0.85rem',
          marginBottom: '0.75rem',
        }}>
          &#10003; Reminders sent to {result.sent} {result.sent === 1 ? 'family' : 'families'}
          {result.skipped > 0 && ` · ${result.skipped} skipped (no email on file)`}
          {result.failed > 0 && ` · ${result.failed} failed`}
        </div>
      )}

      {/* Send button */}
      <button
        onClick={handleSend}
        disabled={isPending || unsubmittedCount === 0}
        style={{
          background: unsubmittedCount > 0 ? 'var(--sage)' : 'var(--border)',
          color: unsubmittedCount > 0 ? '#fff' : 'var(--text-muted)',
          border: 'none',
          borderRadius: '8px',
          padding: '0.6rem 1.25rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: (unsubmittedCount > 0 && !isPending) ? 'pointer' : 'not-allowed',
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending
          ? 'Sending\u2026'
          : unsubmittedCount > 0
            ? `Send Reminder to ${unsubmittedCount} ${unsubmittedCount === 1 ? 'Family' : 'Families'}`
            : 'All Families Have Submitted \u2713'}
      </button>
    </div>
  )
}
