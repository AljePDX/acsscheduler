/**
 * Admin Reports — /admin/reports
 *
 * Server component. Shows school-year-to-date statistics:
 *   - Shift completion breakdown (confirmed, completed, missed, bought_out)
 *   - Per-family shift completion rate
 *   - Drop-in revenue (sum of approved drop-in fees)
 *   - Outstanding makeup debt count
 *   - Buyout revenue
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ShiftRow, FamilyRow, DropinRequestRow, BuyoutRequestRow } from '@/lib/types'

export const metadata = { title: 'Admin · Reports' }

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let shifts: ShiftRow[] = []
  let families: FamilyRow[] = []
  let dropins: Pick<DropinRequestRow, 'fee'>[] = []
  let buyouts: Pick<BuyoutRequestRow, 'amount'>[] = []
  let outstandingDebts = 0

  try {
    const [shiftsRes, familiesRes, dropinsRes, buyoutsRes, debtsRes] = await Promise.all([
      supabase.from('shifts').select('*'),
      supabase.from('families').select('*').order('name'),
      supabase.from('dropin_requests').select('fee').eq('status', 'approved'),
      supabase.from('buyout_requests').select('amount').eq('status', 'approved'),
      supabase.from('makeup_debts').select('*', { count: 'exact', head: true }).eq('status', 'outstanding'),
    ])
    shifts = (shiftsRes.data as ShiftRow[]) ?? []
    families = (familiesRes.data as FamilyRow[]) ?? []
    dropins = (dropinsRes.data as Pick<DropinRequestRow, 'fee'>[]) ?? []
    buyouts = (buyoutsRes.data as Pick<BuyoutRequestRow, 'amount'>[]) ?? []
    outstandingDebts = debtsRes.count ?? 0
  } catch { /* Supabase not configured */ }

  // ── Shift stats ────────────────────────────────────────────────────────────
  const byStatus = {
    proposed: shifts.filter(s => s.status === 'proposed').length,
    confirmed: shifts.filter(s => s.status === 'confirmed').length,
    completed: shifts.filter(s => s.status === 'completed').length,
    missed: shifts.filter(s => s.status === 'missed').length,
    bought_out: shifts.filter(s => s.status === 'bought_out').length,
  }
  const totalAssigned = shifts.length

  // ── Per-family stats ────────────────────────────────────────────────────────
  const familyShifts = new Map<string, { completed: number; missed: number; buyout: number; total: number }>()
  for (const s of shifts) {
    if (!s.family_id) continue
    const cur = familyShifts.get(s.family_id) ?? { completed: 0, missed: 0, buyout: 0, total: 0 }
    cur.total++
    if (s.status === 'completed') cur.completed++
    if (s.status === 'missed') cur.missed++
    if (s.status === 'bought_out') cur.buyout++
    familyShifts.set(s.family_id, cur)
  }

  // ── Revenue ────────────────────────────────────────────────────────────────
  const dropinRevenue = dropins.reduce((sum, d) => sum + (d.fee ?? 0), 0)
  const buyoutRevenue = buyouts.reduce((sum, b) => sum + (b.amount ?? 0), 0)

  const familyMap = new Map(families.map(f => [f.id, f.name]))

  const statCardStyle = {
    background: 'var(--warm-white)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '1rem 1.25rem',
    boxShadow: 'var(--shadow)',
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), "Playfair Display", serif',
            fontSize: '1.5rem', fontWeight: 500, color: 'var(--text)', margin: '0 0 0.25rem',
          }}
        >
          Reports
        </h1>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          School-year-to-date summary across all families.
        </p>
      </div>

      {/* ── Shift overview ───────────────────────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>Shift Completion</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {[
            { label: 'Total Assigned', value: totalAssigned, accent: 'var(--sage)' },
            { label: 'Confirmed', value: byStatus.confirmed, accent: 'var(--sage)' },
            { label: 'Completed', value: byStatus.completed, accent: 'var(--sage-dark)' },
            { label: 'Missed', value: byStatus.missed, accent: 'var(--danger)' },
            { label: 'Bought Out', value: byStatus.bought_out, accent: 'var(--daisy)' },
            { label: 'Draft', value: byStatus.proposed, accent: 'var(--text-muted)' },
          ].map(item => (
            <div key={item.label} style={{ ...statCardStyle, borderLeft: `3px solid ${item.accent}` }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: item.accent, lineHeight: 1, marginBottom: '0.25rem' }}>
                {item.value}
              </div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)' }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Revenue ──────────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>Revenue</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem' }}>
          {[
            { label: 'Drop-in Revenue', value: dropinRevenue, note: `${dropins.length} approved drop-ins` },
            { label: 'Buyout Revenue', value: buyoutRevenue, note: `${buyouts.length} approved buyouts` },
            { label: 'Outstanding Debts', value: outstandingDebts, isCurrency: false, note: 'families', accent: outstandingDebts > 0 ? 'var(--warning)' : 'var(--sage)' },
          ].map(item => (
            <div key={item.label} style={{ ...statCardStyle, borderLeft: `3px solid ${(item as { accent?: string }).accent ?? 'var(--sage)'}` }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: (item as { accent?: string }).accent ?? 'var(--sage-dark)', lineHeight: 1, marginBottom: '0.25rem' }}>
                {item.isCurrency === false ? item.value : `$${item.value.toFixed(2)}`}
              </div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.1rem' }}>
                {item.label}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Per-family breakdown ─────────────────────────────────────────────── */}
      <section>
        <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>Per-Family Breakdown</h2>
        {families.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No families enrolled.</p>
        ) : (
          <div
            style={{
              background: 'var(--warm-white)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 60px 60px 60px',
                padding: '0.6rem 1.25rem',
                borderBottom: '1px solid var(--border)',
                background: 'var(--cream)',
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                gap: '0.5rem',
              }}
            >
              <span>Family</span>
              <span style={{ textAlign: 'center' }}>Total</span>
              <span style={{ textAlign: 'center' }}>Done</span>
              <span style={{ textAlign: 'center' }}>Missed</span>
              <span style={{ textAlign: 'center' }}>Buyout</span>
            </div>
            {families.map((family, i) => {
              const stats = familyShifts.get(family.id) ?? { completed: 0, missed: 0, buyout: 0, total: 0 }
              const hasMissed = stats.missed > 0
              return (
                <div
                  key={family.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 60px 60px 60px 60px',
                    padding: '0.75rem 1.25rem',
                    borderBottom: i < families.length - 1 ? '1px solid var(--border)' : 'none',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: hasMissed ? '#fff8f6' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                    {familyMap.get(family.id) ?? family.id.slice(0, 8)}
                  </span>
                  <span style={{ fontSize: '0.875rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {stats.total}
                  </span>
                  <span style={{ fontSize: '0.875rem', textAlign: 'center', color: 'var(--sage-dark)', fontWeight: stats.completed > 0 ? 600 : 400 }}>
                    {stats.completed}
                  </span>
                  <span style={{ fontSize: '0.875rem', textAlign: 'center', color: stats.missed > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: stats.missed > 0 ? 700 : 400 }}>
                    {stats.missed}
                  </span>
                  <span style={{ fontSize: '0.875rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {stats.buyout}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
