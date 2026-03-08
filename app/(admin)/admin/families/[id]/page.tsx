/**
 * Admin Family Detail — /admin/families/[id]
 *
 * Server component. Fetches the family, its children, and all classes.
 * Passes data to the FamilyDetailForm client component for editing.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FamilyDetailForm } from './FamilyDetailForm'
import { getRequiredShifts } from '@/lib/shifts'
import type { FamilyRow, ChildRow, ClassRow, AvailabilityRow } from '@/lib/types'

export const metadata = { title: 'Admin · Edit Family' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function FamilyDetailPage({ params }: PageProps) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Admin role check
  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .returns<{ role: string }[]>()
    .maybeSingle()
  if (userRow?.role !== 'admin') redirect('/parent/dashboard')

  let family: FamilyRow | null = null
  let children: ChildRow[] = []
  let classes: ClassRow[] = []
  let availabilityRows: Pick<AvailabilityRow, 'period_month' | 'available_dates' | 'preferred_dates' | 'notes' | 'submitted_at'>[] = []

  try {
    const [familyRes, childrenRes, classesRes, availRes] = await Promise.all([
      supabase
        .from('families')
        .select('*')
        .eq('id', id)
        .returns<FamilyRow[]>()
        .maybeSingle(),
      supabase
        .from('children')
        .select('*')
        .eq('family_id', id)
        .returns<ChildRow[]>()
        .order('name'),
      supabase.from('classes').select('*').returns<ClassRow[]>().order('name'),
      supabase
        .from('availability')
        .select('period_month, available_dates, preferred_dates, notes, submitted_at')
        .eq('family_id', id)
        .order('period_month', { ascending: false }),
    ])
    family = familyRes.data ?? null
    children = (childrenRes.data as ChildRow[]) ?? []
    classes = (classesRes.data as ClassRow[]) ?? []
    availabilityRows = (availRes.data as typeof availabilityRows) ?? []
  } catch {
    // Supabase not configured
  }

  if (!family) notFound()

  const shiftsPerMonth = getRequiredShifts(family, children)

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* ── Back link ──────────────────────────────────────────────────────── */}
      <Link
        href="/admin/families"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem',
          fontSize: '0.82rem',
          color: 'var(--text-muted)',
          textDecoration: 'none',
          marginBottom: '1.1rem',
        }}
      >
        ← All families
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-playfair), "Playfair Display", serif',
              fontSize: '1.5rem',
              fontWeight: 500,
              color: 'var(--text)',
              margin: '0 0 0.2rem',
            }}
          >
            {family.name}
          </h1>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            {family.email}
          </p>
        </div>

        {/* Shift requirement badge */}
        <div
          style={{
            textAlign: 'right',
            flexShrink: 0,
            background: 'var(--warm-white)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '0.6rem 1rem',
          }}
        >
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              lineHeight: 1,
              color:
                shiftsPerMonth === null ? 'var(--warning)' : 'var(--sage-dark)',
            }}
          >
            {shiftsPerMonth !== null ? shiftsPerMonth : '—'}
          </div>
          <div
            style={{
              fontSize: '0.62rem',
              color: 'var(--text-muted)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginTop: '0.1rem',
            }}
          >
            {family.shift_override !== null
              ? 'shifts/mo (override)'
              : shiftsPerMonth === null
              ? 'set override'
              : 'shifts/mo'}
          </div>
        </div>
      </div>

      {/* ── Edit form ──────────────────────────────────────────────────────── */}
      <FamilyDetailForm
        family={family}
        childRecords={children}
        classes={classes}
      />

      {/* ── Availability history ────────────────────────────────────────────── */}
      <section
        style={{
          background: 'var(--warm-white)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '1.25rem',
        }}
      >
        <p
          style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            margin: '0 0 0.85rem',
          }}
        >
          Availability submissions
        </p>

        {availabilityRows.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
            No availability submissions on record.
          </p>
        ) : (
          <div>
            {availabilityRows.map((avail, i) => {
              const month = new Date(avail.period_month + 'T00:00:00').toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })
              const isLast = i === availabilityRows.length - 1
              return (
                <div
                  key={avail.period_month}
                  style={{
                    padding: '0.75rem 0',
                    borderBottom: isLast ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text)' }}>
                      {month}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {avail.available_dates.length} available day{avail.available_dates.length !== 1 ? 's' : ''}
                      {avail.preferred_dates && avail.preferred_dates.length > 0
                        ? ` · ${avail.preferred_dates.length} preferred`
                        : ''}
                    </span>
                  </div>
                  {avail.notes && (
                    <p
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--text-muted)',
                        fontStyle: 'italic',
                        margin: '0.3rem 0 0',
                      }}
                    >
                      📝 {avail.notes}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
