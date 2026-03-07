/**
 * Admin Dashboard — /admin/dashboard
 *
 * Server component. Shows pending action counts and quick links.
 * Fetches counts from swap_requests, dropin_requests, makeup_debts,
 * and buyout_requests in parallel.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ReminderButton } from './ReminderButton'

export const metadata = { title: 'Admin Dashboard' }

interface StatCard {
  label: string
  count: number
  href: string
  accent: string
  note?: string
}

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Next-month reminder section data ─────────────────────────────────────────
  const now = new Date()
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const nextMonthStart = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`
  const nextMonthLabel = nextMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // ── Fetch pending action counts in parallel ────────────────────────────────
  let openSwaps = 0
  let pendingAdminSwaps = 0
  let pendingDropins = 0
  let outstandingDebts = 0
  let pendingBuyouts = 0
  let totalFamilies = 0

  try {
    const [
      openSwapsRes,
      adminSwapsRes,
      dropinsRes,
      debtsRes,
      buyoutsRes,
      familiesRes,
    ] = await Promise.all([
      supabase
        .from('swap_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open'),

      supabase
        .from('swap_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending_admin'),

      supabase
        .from('dropin_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),

      supabase
        .from('makeup_debts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'outstanding'),

      supabase
        .from('buyout_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),

      supabase
        .from('families')
        .select('*', { count: 'exact', head: true }),
    ])

    openSwaps = openSwapsRes.count ?? 0
    pendingAdminSwaps = adminSwapsRes.count ?? 0
    pendingDropins = dropinsRes.count ?? 0
    outstandingDebts = debtsRes.count ?? 0
    pendingBuyouts = buyoutsRes.count ?? 0
    totalFamilies = familiesRes.count ?? 0
  } catch {
    // Supabase not configured
  }

  // ── Fetch submitted count for next month ──────────────────────────────────
  let submittedCount = 0
  try {
    const submittedRes = await supabase
      .from('availability')
      .select('family_id', { count: 'exact', head: true })
      .eq('period_month', nextMonthStart)
    submittedCount = submittedRes.count ?? 0
  } catch {
    // Supabase not configured
  }

  const totalPendingSwaps = openSwaps + pendingAdminSwaps

  const statCards: StatCard[] = [
    {
      label: 'Swap Requests',
      count: totalPendingSwaps,
      href: '/admin/swaps',
      accent: 'var(--daisy)',
      note:
        totalPendingSwaps > 0
          ? `${openSwaps} open · ${pendingAdminSwaps} awaiting approval`
          : undefined,
    },
    {
      label: 'Pending Drop-ins',
      count: pendingDropins,
      href: '/admin/dropins',
      accent: 'var(--azalea)',
    },
    {
      label: 'Outstanding Debts',
      count: outstandingDebts,
      href: '/admin/makeup',
      accent: 'var(--warning)',
    },
    {
      label: 'Buyout Requests',
      count: pendingBuyouts,
      href: '/admin/reports',
      accent: 'var(--sage)',
    },
  ]

  const quickLinks = [
    { label: 'Propose / Publish Schedule', href: '/admin/schedule', desc: 'Generate the monthly draft and publish to families.' },
    { label: 'Review Swap Requests', href: '/admin/swaps', desc: 'Approve or reject pending swap requests.' },
    { label: 'Review Drop-in Requests', href: '/admin/dropins', desc: 'Approve or reject drop-in day requests.' },
    { label: 'Manage Families', href: '/admin/families', desc: 'View and edit family records, add conflict flags.' },
    { label: 'Manage Holidays', href: '/admin/holidays', desc: 'Define school holidays and closures.' },
    { label: 'Reports', href: '/admin/reports', desc: 'Shift completion, buyouts, drop-in revenue.' },
  ]

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* ── Heading ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), "Playfair Display", serif',
            fontSize: '1.5rem',
            fontWeight: 500,
            color: 'var(--text)',
            margin: '0 0 0.25rem',
          }}
        >
          Admin Dashboard
        </h1>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          {totalFamilies > 0 ? `${totalFamilies} enrolled families` : 'No families enrolled yet'} &middot; pending actions below
        </p>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
          Pending Actions
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {statCards.map(card => (
            <Link
              key={card.href}
              href={card.href}
              style={{ textDecoration: 'none' }}
            >
              <div
                style={{
                  background: 'var(--warm-white)',
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${card.count > 0 ? card.accent : 'var(--border)'}`,
                  borderRadius: '12px',
                  padding: '1rem 1.25rem',
                  boxShadow: 'var(--shadow)',
                  transition: 'box-shadow 0.15s',
                }}
              >
                <div
                  style={{
                    fontSize: '2rem',
                    fontWeight: 700,
                    color: card.count > 0 ? card.accent : 'var(--text-muted)',
                    lineHeight: 1,
                    marginBottom: '0.3rem',
                  }}
                >
                  {card.count}
                </div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text)',
                    marginBottom: card.note ? '0.2rem' : 0,
                  }}
                >
                  {card.label}
                </div>
                {card.note && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {card.note}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Quick links ───────────────────────────────────────────────────────── */}
      <section>
        <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
          Quick Actions
        </h2>
        <div
          style={{
            background: 'var(--warm-white)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          {quickLinks.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.9rem 1.25rem',
                borderBottom: i < quickLinks.length - 1 ? '1px solid var(--border)' : 'none',
                textDecoration: 'none',
                gap: '1rem',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: 'var(--text)',
                    marginBottom: '0.15rem',
                  }}
                >
                  {link.label}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {link.desc}
                </div>
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: '1rem', flexShrink: 0 }}>
                &rsaquo;
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Availability reminder section ─────────────────────────────────────── */}
      <ReminderButton
        targetMonth={nextMonthStart}
        monthLabel={nextMonthLabel}
        totalFamilies={totalFamilies}
        submittedCount={submittedCount}
      />
    </div>
  )
}
