'use client'

/**
 * Admin swap detail client component.
 * Shows swap details and a sorted list of eligible covering families.
 * Admin selects a covering family and approves or rejects.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveSwapAction, rejectSwapAction } from '../actions'
import type { ExtraShiftsWilling } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EligibleFamily {
  id: string
  name: string
  extra_shifts_willing: ExtraShiftsWilling
  confirmed_shifts_this_month: number
  has_conflict: boolean
}

export interface SwapDetailProps {
  swapId: string
  shiftDate: string
  className: string
  requestingFamily: string
  reason: string | null
  status: string
  eligibleFamilies: EligibleFamily[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const WILLINGNESS_LABEL: Record<string, string> = {
  '5+': '5+ extra shifts',
  '3-4': '3–4 extra',
  '1-2': '1–2 extra',
  '0':   'Required only',
}

const WILLINGNESS_RANK: Record<string, number> = {
  '5+': 4, '3-4': 3, '1-2': 2, '0': 1,
}

function sortFamilies(families: EligibleFamily[]) {
  return [...families].sort((a, b) => {
    // Extra-willing families come first (rank > 0 means willing; '0' scores 0)
    const ra = a.extra_shifts_willing !== '0'
      ? (WILLINGNESS_RANK[a.extra_shifts_willing] ?? 0) + 10
      : 0
    const rb = b.extra_shifts_willing !== '0'
      ? (WILLINGNESS_RANK[b.extra_shifts_willing] ?? 0) + 10
      : 0
    if (ra !== rb) return rb - ra
    return a.name.localeCompare(b.name)
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SwapDetailClient({
  swapId, shiftDate, className, requestingFamily, reason, status, eligibleFamilies,
}: SwapDetailProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sorted = sortFamilies(eligibleFamilies)
  const groupA = sorted.filter(f => f.extra_shifts_willing !== '0')
  const groupB = sorted.filter(f => f.extra_shifts_willing === '0')
  const isOpen = status === 'open'

  function handleApprove() {
    if (!selectedId) { setError('Please select a covering family.'); return }
    setError(null)
    startTransition(async () => {
      const result = await approveSwapAction(swapId, selectedId)
      if (result?.error) {
        setError(result.error)
      } else {
        router.push('/admin/swaps')
        router.refresh()
      }
    })
  }

  function handleReject() {
    startTransition(async () => {
      await rejectSwapAction(swapId)
      router.push('/admin/swaps')
      router.refresh()
    })
  }

  function FamilyCard({ family }: { family: EligibleFamily }) {
    const selected = selectedId === family.id
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => isOpen && setSelectedId(family.id)}
        onKeyDown={e => e.key === 'Enter' && isOpen && setSelectedId(family.id)}
        style={{
          padding: '0.85rem 1rem',
          border: `2px solid ${selected ? 'var(--sage)' : 'var(--border)'}`,
          borderRadius: '10px',
          background: selected ? 'var(--sage-light)' : 'var(--warm-white)',
          cursor: isOpen ? 'pointer' : 'default',
          marginBottom: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem' }}>
            {family.name} Family
            {family.has_conflict && (
              <span style={{ marginLeft: '0.5rem', color: 'var(--warning)', fontSize: '0.8rem' }}>
                ⚠ Conflict
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {WILLINGNESS_LABEL[family.extra_shifts_willing] ?? 'Required only'} ·{' '}
            {family.confirmed_shifts_this_month} confirmed shift{family.confirmed_shifts_this_month !== 1 ? 's' : ''} this month
          </div>
        </div>
        {selected && (
          <span style={{
            fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' as const,
            letterSpacing: '0.06em', padding: '0.2rem 0.55rem',
            borderRadius: '999px', background: 'var(--sage)', color: '#fff',
          }}>
            Selected
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* Back link */}
      <a
        href="/admin/swaps"
        style={{ fontSize: '0.8rem', color: 'var(--sage)', textDecoration: 'none', display: 'block', marginBottom: '1rem' }}
      >
        ← Back to swaps
      </a>

      <h1 style={{
        fontFamily: 'var(--font-playfair), "Playfair Display", serif',
        fontSize: '1.5rem', fontWeight: 500, color: 'var(--text)', margin: '0 0 1.5rem',
      }}>
        Swap Request
      </h1>

      {/* ── Request summary ───────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--warm-white)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem',
      }}>
        <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text)' }}>
          <div><strong>Family:</strong> {requestingFamily} Family</div>
          <div><strong>Shift:</strong> {shiftDate} · {className}</div>
          {reason && <div><strong>Reason:</strong> {reason}</div>}
          <div>
            <strong>Status:</strong>{' '}
            <span style={{ textTransform: 'capitalize' as const }}>{status}</span>
          </div>
        </div>
      </div>

      {isOpen ? (
        <>
          {error && (
            <div style={{
              padding: '0.75rem', borderRadius: '8px',
              background: 'var(--warning-light)', color: 'var(--warning)',
              fontSize: '0.875rem', marginBottom: '1rem',
            }}>
              {error}
            </div>
          )}

          {/* ── Group A: willing to work extra ───────────────────────────── */}
          {groupA.length > 0 && (
            <section style={{ marginBottom: '1.25rem' }}>
              <h2 className="label-section" style={{ margin: '0 0 0.6rem' }}>
                Available &amp; Willing to Work Extra
              </h2>
              {groupA.map(f => <FamilyCard key={f.id} family={f} />)}
            </section>
          )}

          {/* ── Group B: available only ───────────────────────────────────── */}
          {groupB.length > 0 && (
            <section style={{ marginBottom: '1.25rem' }}>
              <h2 className="label-section" style={{ margin: '0 0 0.6rem' }}>
                Available
              </h2>
              {groupB.map(f => <FamilyCard key={f.id} family={f} />)}
            </section>
          )}

          {eligibleFamilies.length === 0 && (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              No families have submitted availability for this date.
            </p>
          )}

          {/* ── Action buttons ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' as const }}>
            <button
              onClick={handleApprove}
              disabled={isPending}
              style={{
                background: 'var(--sage)', color: '#fff', border: 'none',
                borderRadius: '8px', padding: '0.65rem 1.5rem',
                fontSize: '0.9rem', fontWeight: 600,
                cursor: isPending ? 'not-allowed' : 'pointer',
                opacity: isPending ? 0.7 : 1,
              }}
            >
              {isPending ? 'Saving…' : 'Approve & Assign'}
            </button>
            <button
              onClick={handleReject}
              disabled={isPending}
              style={{
                background: 'none', color: 'var(--warning)',
                border: '1px solid var(--warning)', borderRadius: '8px',
                padding: '0.65rem 1.25rem', fontSize: '0.9rem',
                fontWeight: 600, cursor: isPending ? 'not-allowed' : 'pointer',
              }}
            >
              Reject Request
            </button>
          </div>
        </>
      ) : (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          This request has already been {status}.
        </p>
      )}
    </div>
  )
}
