/**
 * Admin Swaps — /admin/swaps
 *
 * Server component. Displays all swap requests grouped by status:
 *   1. Pending admin approval (status = 'pending_admin') — approve / reject actions
 *   2. In-progress (open or awaiting covering family acceptance)
 *   3. Resolved (approved / rejected) — recent 20
 *
 * Each row shows: shift date + class, requesting family, covering family, reason.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { SwapRequestRow, ShiftRow, FamilyRow, ClassRow } from '@/lib/types'

export const metadata = { title: 'Admin · Swaps' }

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open:                       { label: 'Open',              color: 'var(--text-muted)' },
  pending_covering_approval:  { label: 'Awaiting coverage', color: 'var(--daisy)' },
  pending_admin:              { label: 'Pending admin',      color: 'var(--warning)' },
  approved:                   { label: 'Approved',           color: 'var(--sage-dark)' },
  rejected:                   { label: 'Rejected',           color: 'var(--danger)' },
  cancelled:                  { label: 'Cancelled',          color: 'var(--text-muted)' },
}

const CLASS_COLORS: Record<string, string> = {
  Rose:   'var(--rose)',
  Daisy:  'var(--daisy)',
  Azalea: 'var(--azalea)',
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export default async function AdminSwapsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let swaps: SwapRequestRow[] = []
  let shifts: ShiftRow[] = []
  let families: FamilyRow[] = []
  let classes: ClassRow[] = []

  try {
    // Fetch all non-resolved + recent resolved swaps
    const [swapsRes, familiesRes, classesRes] = await Promise.all([
      supabase
        .from('swap_requests')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase.from('families').select('*'),
      supabase.from('classes').select('*'),
    ])
    swaps    = (swapsRes.data    as SwapRequestRow[]) ?? []
    families = (familiesRes.data as FamilyRow[])      ?? []
    classes  = (classesRes.data  as ClassRow[])       ?? []

    // Fetch all relevant shifts
    const shiftIds = [...new Set(swaps.map(s => s.shift_id).filter(Boolean))]
    if (shiftIds.length > 0) {
      const { data } = await supabase
        .from('shifts')
        .select('*')
        .in('id', shiftIds)
      shifts = (data as ShiftRow[]) ?? []
    }
  } catch { /* Supabase not configured */ }

  // ── Build lookups ────────────────────────────────────────────────────────────
  const shiftMap    = new Map(shifts.map(s  => [s.id,  s]))
  const familyMap   = new Map(families.map(f => [f.id, f.name]))
  const classMap    = new Map(classes.map(c  => [c.id, c]))

  // ── Group by status ──────────────────────────────────────────────────────────
  const pending  = swaps.filter(s => s.status === 'open')
  const active   = swaps.filter(s => s.status === 'pending_covering_approval')
  const resolved = swaps.filter(s => s.status === 'approved' || s.status === 'rejected' || s.status === 'cancelled').slice(0, 20)

  const cardStyle = {
    background: 'var(--warm-white)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '0.9rem 1.1rem',
  }

  function SwapCard({
    swap,
    showActions,
  }: {
    swap: SwapRequestRow
    showActions: boolean
  }) {
    const shift = shiftMap.get(swap.shift_id)
    const cls   = shift ? classMap.get(shift.class_id) : undefined
    const statusInfo = STATUS_LABELS[swap.status] ?? { label: swap.status, color: 'var(--text-muted)' }
    const classColor = cls ? (CLASS_COLORS[cls.name] ?? 'var(--sage)') : 'var(--sage)'

    return (
      <div style={{ ...cardStyle, borderLeft: `3px solid ${classColor}` }}>
        {/* Top row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.45rem' }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>
              {shift ? formatDate(shift.date) : 'Unknown date'}
            </span>
            {cls && (
              <span
                style={{
                  marginLeft: '0.5rem', fontSize: '0.72rem', fontWeight: 600,
                  color: classColor,
                }}
              >
                {cls.name}
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: '0.68rem', fontWeight: 700, color: statusInfo.color,
              border: `1px solid ${statusInfo.color}`, borderRadius: '999px',
              padding: '0.1rem 0.5rem', whiteSpace: 'nowrap',
            }}
          >
            {statusInfo.label}
          </span>
        </div>

        {/* Family info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Requesting: </span>
            {familyMap.get(swap.requesting_family_id) ?? 'Unknown'}
          </div>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Covering: </span>
            {swap.covering_family_id ? (familyMap.get(swap.covering_family_id) ?? 'Unknown') : '—'}
          </div>
        </div>

        {swap.reason && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '0.4rem' }}>
            &ldquo;{swap.reason}&rdquo;
          </div>
        )}

        {/* Review link — navigates to detail page for family selection */}
        {showActions && (
          <div style={{ marginTop: '0.6rem' }}>
            <Link
              href={`/admin/swaps/${swap.id}`}
              style={{
                fontSize: '0.8rem', color: 'var(--sage)', fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Review →
            </Link>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), "Playfair Display", serif',
            fontSize: '1.5rem', fontWeight: 500, color: 'var(--text)', margin: '0 0 0.25rem',
          }}
        >
          Swap Requests
        </h1>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Review and approve swap requests between families.
        </p>
      </div>

      {/* ── Pending admin approval ──────────────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
          Needs Approval ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div
            style={{
              background: 'var(--warm-white)', border: '1px solid var(--border)',
              borderRadius: '10px', padding: '1.25rem', textAlign: 'center',
              fontSize: '0.875rem', color: 'var(--text-muted)',
            }}
          >
            No swaps awaiting your approval.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pending.map(swap => (
              <SwapCard key={swap.id} swap={swap} showActions />
            ))}
          </div>
        )}
      </section>

      {/* ── Active / in-progress ────────────────────────────────────────────── */}
      {active.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
            In Progress ({active.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {active.map(swap => (
              <SwapCard key={swap.id} swap={swap} showActions={false} />
            ))}
          </div>
        </section>
      )}

      {/* ── Resolved ────────────────────────────────────────────────────────── */}
      {resolved.length > 0 && (
        <section>
          <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
            Recently Resolved
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {resolved.map(swap => (
              <SwapCard key={swap.id} swap={swap} showActions={false} />
            ))}
          </div>
        </section>
      )}

      {swaps.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No swap requests yet.</p>
      )}
    </div>
  )
}
