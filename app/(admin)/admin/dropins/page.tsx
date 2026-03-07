/**
 * Admin Drop-ins — /admin/dropins
 *
 * Server component. Lists all drop-in requests:
 *   - Pending: approve / reject actions
 *   - Non-pending (approved, rejected, cancelled): status badge only
 *
 * Each row shows: family, child name, class, date, fee.
 *
 * Also shows a monthly capacity grid for the current month — which classes
 * have open drop-in slots on each school day.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { approveDropinAction, rejectDropinAction } from './actions'
import { getAvailableDropinSlots, getSchoolDaysInMonth } from '@/lib/dropins'
import type { DropinRequestRow, FamilyRow, ChildRow, ClassRow } from '@/lib/types'

export const metadata = { title: 'Admin · Drop-ins' }

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pending',   color: 'var(--warning)' },
  approved:  { label: 'Approved',  color: 'var(--sage-dark)' },
  rejected:  { label: 'Rejected',  color: 'var(--danger)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)' },
}

const CLASS_COLORS: Record<string, string> = {
  Rose:   'var(--rose)',
  Daisy:  'var(--daisy)',
  Azalea: 'var(--azalea)',
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default async function AdminDropInsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let dropins: DropinRequestRow[] = []
  let families: FamilyRow[] = []
  let children: ChildRow[] = []
  let classes: ClassRow[] = []

  // Capacity grid state
  const now = new Date()
  const capYear = now.getFullYear()
  const capMonth = now.getMonth() + 1
  const capStart = `${capYear}-${String(capMonth).padStart(2, '0')}-01`
  const lastDayOfCapMonth = new Date(capYear, capMonth, 0).getDate()
  const capEnd = `${capYear}-${String(capMonth).padStart(2, '0')}-${String(lastDayOfCapMonth).padStart(2, '0')}`

  let schoolDays: string[] = []
  let capacitySlots: { date: string; classId: string; className: string }[] = []

  try {
    const [dropinsRes, familiesRes, childrenRes, classesRes] = await Promise.all([
      supabase.from('dropin_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('families').select('*'),
      supabase.from('children').select('*'),
      supabase.from('classes').select('*'),
    ])
    dropins  = (dropinsRes.data  as DropinRequestRow[]) ?? []
    families = (familiesRes.data as FamilyRow[])        ?? []
    children = (childrenRes.data as ChildRow[])         ?? []
    classes  = (classesRes.data  as ClassRow[])         ?? []

    // ── Capacity grid computation ────────────────────────────────────────────
    const [capAvailRes, capDropinRes, capHolidayRes] = await Promise.all([
      supabase.from('availability').select('planned_absences').gte('period_month', capStart).lte('period_month', capStart),
      supabase.from('dropin_requests').select('class_id, date').eq('status', 'approved').gte('date', capStart).lte('date', capEnd),
      supabase.from('holidays').select('date').gte('date', capStart).lte('date', capEnd),
    ])

    const capHolidayDates = new Set((capHolidayRes.data ?? []).map((h: { date: string }) => h.date))
    schoolDays = getSchoolDaysInMonth(capYear, capMonth, capHolidayDates)

    // Build childrenByClass
    const childrenByClass: Record<string, { id: string; days_of_week: string[] | null }[]> = {}
    for (const c of children) {
      const list = childrenByClass[c.class_id] ?? []
      list.push({ id: c.id, days_of_week: c.days_of_week })
      childrenByClass[c.class_id] = list
    }

    // Build absencesByClass
    const absencesByClass: Record<string, { child_id: string; date: string }[]> = {}
    for (const avRow of (capAvailRes.data ?? []) as { planned_absences: { child_id: string; date: string }[] }[]) {
      for (const abs of avRow.planned_absences ?? []) {
        const child = children.find(c => c.id === abs.child_id)
        if (!child) continue
        const list = absencesByClass[child.class_id] ?? []
        list.push(abs)
        absencesByClass[child.class_id] = list
      }
    }

    // Build approved dropin counts by class and date
    const approvedDropinsByClass: Record<string, Record<string, number>> = {}
    for (const d of (capDropinRes.data ?? []) as { class_id: string; date: string }[]) {
      const byDate = approvedDropinsByClass[d.class_id] ?? {}
      byDate[d.date] = (byDate[d.date] ?? 0) + 1
      approvedDropinsByClass[d.class_id] = byDate
    }

    capacitySlots = getAvailableDropinSlots({
      year: capYear,
      month: capMonth,
      classes: classes.map(c => ({ id: c.id, name: c.name, student_teacher_ratio: c.student_teacher_ratio })),
      childrenByClass,
      absencesByClass,
      approvedDropinsByClass,
      holidayDates: capHolidayDates,
    })
  } catch { /* Supabase not configured */ }

  // ── Build lookups ────────────────────────────────────────────────────────────
  const familyMap = new Map(families.map(f => [f.id, f.name]))
  const childMap  = new Map(children.map(c => [c.id, c.name]))
  const classMap  = new Map(classes.map(c => [c.id, c]))

  const pendingDropins = dropins.filter(d => d.status === 'pending')
  const otherDropins   = dropins.filter(d => d.status !== 'pending')

  const cardStyle = {
    background: 'var(--warm-white)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '0.9rem 1.1rem',
  }

  const btnBase: React.CSSProperties = {
    border: 'none', borderRadius: '6px', padding: '0.35rem 0.8rem',
    fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
  }

  function DropinCard({ dropin, showActions }: { dropin: DropinRequestRow; showActions: boolean }) {
    const cls         = classMap.get(dropin.class_id)
    const statusInfo  = STATUS_LABELS[dropin.status] ?? { label: dropin.status, color: 'var(--text-muted)' }
    const classColor  = cls ? (CLASS_COLORS[cls.name] ?? 'var(--sage)') : 'var(--sage)'
    const borderColor = dropin.status === 'pending' ? 'var(--warning)' : classColor

    return (
      <div style={{ ...cardStyle, borderLeft: `3px solid ${borderColor}` }}>
        {/* Top row */}
        <div
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            gap: '0.5rem', marginBottom: '0.4rem',
          }}
        >
          <div>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>
              {familyMap.get(dropin.family_id) ?? 'Unknown family'}
            </span>
            <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              for {childMap.get(dropin.child_id) ?? 'Unknown child'}
            </span>
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

        {/* Details row */}
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '0.25rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)',
          }}
        >
          <div>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Date: </span>
            {formatDate(dropin.date)}
          </div>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Class: </span>
            <span style={{ color: classColor, fontWeight: 600 }}>{cls?.name ?? '—'}</span>
          </div>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Fee: </span>
            ${dropin.fee.toFixed(2)}
          </div>
        </div>

        {dropin.admin_notes && (
          <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            {dropin.admin_notes}
          </div>
        )}

        {/* Action buttons */}
        {showActions && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem' }}>
            <form action={approveDropinAction.bind(null, dropin.id)}>
              <button
                type="submit"
                style={{ ...btnBase, background: 'var(--sage)', color: 'white' }}
              >
                Approve
              </button>
            </form>
            <form action={rejectDropinAction.bind(null, dropin.id)}>
              <button
                type="submit"
                style={{ ...btnBase, background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' }}
              >
                Reject
              </button>
            </form>
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
          Drop-in Requests
        </h1>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Review and approve drop-in day requests from enrolled families.
        </p>
      </div>

      {/* ── Capacity grid ──────────────────────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
          Drop-in Capacity — {MONTH_NAMES[capMonth - 1]} {capYear}
        </h2>
        <div style={{ background: 'var(--warm-white)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.68rem' }}>Date</th>
                {classes.map(cls => (
                  <th key={cls.id} style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: CLASS_COLORS[cls.name] ?? 'var(--text)', fontWeight: 700, fontSize: '0.75rem' }}>{cls.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schoolDays.length === 0 ? (
                <tr>
                  <td
                    colSpan={classes.length + 1}
                    style={{ padding: '1.25rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)' }}
                  >
                    No school days found for this month.
                  </td>
                </tr>
              ) : (
                schoolDays.map((date, i) => (
                  <tr key={date} style={{ borderBottom: i < schoolDays.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <td style={{ padding: '0.5rem 1rem', color: 'var(--text)', fontWeight: 500 }}>{formatDate(date)}</td>
                    {classes.map(cls => {
                      const isOpen = capacitySlots.some(s => s.date === date && s.classId === cls.id)
                      return (
                        <td key={cls.id} style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                          {isOpen
                            ? <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--azalea)', background: 'var(--azalea-light)', borderRadius: '4px', padding: '0.15rem 0.4rem' }}>Open</span>
                            : <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>—</span>
                          }
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Pending ──────────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
          Pending Review ({pendingDropins.length})
        </h2>
        {pendingDropins.length === 0 ? (
          <div
            style={{
              background: 'var(--warm-white)', border: '1px solid var(--border)',
              borderRadius: '10px', padding: '1.25rem', textAlign: 'center',
              fontSize: '0.875rem', color: 'var(--text-muted)',
            }}
          >
            No pending drop-in requests.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pendingDropins.map(d => (
              <DropinCard key={d.id} dropin={d} showActions />
            ))}
          </div>
        )}
      </section>

      {/* ── Past requests ────────────────────────────────────────────────────── */}
      {otherDropins.length > 0 && (
        <section>
          <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
            Past Requests
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {otherDropins.slice(0, 30).map(d => (
              <DropinCard key={d.id} dropin={d} showActions={false} />
            ))}
          </div>
        </section>
      )}

      {dropins.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No drop-in requests yet.</p>
      )}
    </div>
  )
}
