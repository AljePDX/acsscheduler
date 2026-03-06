'use client'

/**
 * Parent swaps client component.
 * Shows upcoming shifts eligible for swap + existing swap requests.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestSwapAction, cancelSwapAction } from './actions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Shift {
  id: string
  date: string
  class_name: string
  status: string
}

interface SwapRequest {
  id: string
  shift_date: string
  class_name: string
  reason: string | null
  status: string
  created_at: string
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    open: 'Pending review',
    approved: 'Approved',
    rejected: 'Rejected',
  }
  const colors: Record<string, { bg: string; color: string }> = {
    open:     { bg: 'var(--daisy-light)',   color: 'var(--daisy)' },
    approved: { bg: 'var(--sage-light)',    color: 'var(--sage-dark)' },
    rejected: { bg: 'var(--warning-light)', color: 'var(--warning)' },
  }
  const style = colors[status] ?? { bg: 'var(--border)', color: 'var(--text-muted)' }
  return (
    <span style={{
      fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' as const,
      letterSpacing: '0.06em', padding: '0.2rem 0.55rem',
      borderRadius: '999px', background: style.bg, color: style.color,
    }}>
      {labels[status] ?? status}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SwapsClient({
  shifts,
  swapRequests,
}: {
  shifts: Shift[]
  swapRequests: SwapRequest[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedShiftId, setSelectedShiftId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedShiftId) { setError('Please select a shift.'); return }
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      const result = await requestSwapAction(selectedShiftId, reason)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        setSelectedShiftId('')
        setReason('')
        router.refresh()
      }
    })
  }

  function handleCancel(swapId: string) {
    startTransition(async () => {
      const result = await cancelSwapAction(swapId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  // Shifts that already have an open swap pending (to disable in picker)
  const pendingSwapShiftDates = new Set(
    swapRequests
      .filter(sr => sr.status === 'open')
      .map(sr => sr.shift_date)
  )

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <h1 style={{
        fontFamily: 'var(--font-playfair), "Playfair Display", serif',
        fontSize: '1.5rem', fontWeight: 500, color: 'var(--text)',
        margin: '0 0 1.75rem',
      }}>
        Shift Swaps
      </h1>

      {/* ── Request form ──────────────────────────────────────────────────── */}
      <section style={{
        background: 'var(--warm-white)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '1.25rem', marginBottom: '1.75rem',
      }}>
        <h2 className="label-section" style={{ margin: '0 0 1rem' }}>
          Request a Swap
        </h2>

        {success && (
          <div style={{
            padding: '0.75rem', borderRadius: '8px',
            background: 'var(--sage-light)', color: 'var(--sage-dark)',
            fontSize: '0.875rem', marginBottom: '1rem',
          }}>
            Swap request submitted! The administrator will review and assign a covering volunteer.
          </div>
        )}

        {error && (
          <div style={{
            padding: '0.75rem', borderRadius: '8px',
            background: 'var(--warning-light)', color: 'var(--warning)',
            fontSize: '0.875rem', marginBottom: '1rem',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block', fontSize: '0.78rem', fontWeight: 600,
              color: 'var(--text-muted)', marginBottom: '0.4rem',
            }}>
              Select shift to swap
            </label>
            <select
              value={selectedShiftId}
              onChange={e => setSelectedShiftId(e.target.value)}
              style={{
                width: '100%', padding: '0.6rem 0.75rem',
                border: '1px solid var(--border)', borderRadius: '8px',
                background: 'var(--warm-white)', color: 'var(--text)', fontSize: '0.9rem',
              }}
            >
              <option value="">— Choose a shift —</option>
              {shifts.map(s => {
                const hasPending = pendingSwapShiftDates.has(s.date)
                return (
                  <option key={s.id} value={s.id} disabled={hasPending}>
                    {s.date} · {s.class_name}{hasPending ? ' (swap pending)' : ''}
                  </option>
                )
              })}
            </select>
            {shifts.length === 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                You have no upcoming shifts eligible for a swap.
              </p>
            )}
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block', fontSize: '0.78rem', fontWeight: 600,
              color: 'var(--text-muted)', marginBottom: '0.4rem',
            }}>
              Reason <span style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Family conflict, travel..."
              rows={2}
              style={{
                width: '100%', padding: '0.6rem 0.75rem',
                border: '1px solid var(--border)', borderRadius: '8px',
                background: 'var(--warm-white)', color: 'var(--text)',
                fontSize: '0.9rem', resize: 'vertical' as const, boxSizing: 'border-box' as const,
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isPending || shifts.length === 0}
            style={{
              background: 'var(--sage)', color: '#fff',
              border: 'none', borderRadius: '8px',
              padding: '0.6rem 1.25rem', fontSize: '0.9rem',
              fontWeight: 600, cursor: isPending ? 'not-allowed' : 'pointer',
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? 'Submitting…' : 'Submit Swap Request'}
          </button>
        </form>
      </section>

      {/* ── Existing swap requests ─────────────────────────────────────────── */}
      {swapRequests.length > 0 && (
        <section>
          <h2 className="label-section" style={{ margin: '0 0 0.75rem' }}>
            Your Requests
          </h2>
          {swapRequests.map(sr => (
            <div key={sr.id} style={{
              padding: '0.85rem 0', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
            }}>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>
                  {sr.shift_date} · {sr.class_name}
                </div>
                {sr.reason && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {sr.reason}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                <StatusBadge status={sr.status} />
                {sr.status === 'open' && (
                  <button
                    onClick={() => handleCancel(sr.id)}
                    disabled={isPending}
                    style={{
                      fontSize: '0.78rem', color: 'var(--warning)', background: 'none',
                      border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600,
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {swapRequests.length === 0 && shifts.length === 0 && (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', textAlign: 'center' as const, marginTop: '2rem' }}>
          No upcoming shifts yet. Check back after the schedule is published.
        </p>
      )}
    </div>
  )
}
