/**
 * Admin Families — /admin/families
 *
 * Server component. Lists all enrolled families with:
 *   - Conflict badge (⚠ amber) if the family appears in any family_conflict record
 *   - Child chips (class-colored: Rose/Daisy/Azalea) with days/week
 *   - Monthly shift requirement (from lib/shifts or shift_override)
 *   - Admin-only notes (displayed inline; never sent to parents)
 *
 * Conflict reason is never shown here — admins only see the presence of a flag.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRequiredShifts } from '@/lib/shifts'
import { AddFamilyForm } from './AddFamilyForm'
import type { FamilyRow, ChildRow, ClassRow, FamilyConflictRow } from '@/lib/types'

export const metadata = { title: 'Admin · Families' }

const CLASS_ACCENTS: Record<string, { bg: string; color: string }> = {
  Rose:   { bg: 'var(--rose-light)',   color: 'var(--rose)' },
  Daisy:  { bg: 'var(--daisy-light)',  color: 'var(--daisy)' },
  Azalea: { bg: 'var(--azalea-light)', color: 'var(--azalea)' },
}

export default async function FamiliesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let families: FamilyRow[] = []
  let children: ChildRow[] = []
  let classes: ClassRow[] = []
  let conflicts: FamilyConflictRow[] = []

  try {
    const [familiesRes, childrenRes, classesRes, conflictsRes] = await Promise.all([
      supabase.from('families').select('*').order('name'),
      supabase.from('children').select('*'),
      supabase.from('classes').select('*'),
      supabase.from('family_conflicts').select('*'),
    ])
    families  = (familiesRes.data  as FamilyRow[])         ?? []
    children  = (childrenRes.data  as ChildRow[])          ?? []
    classes   = (classesRes.data   as ClassRow[])          ?? []
    conflicts = (conflictsRes.data as FamilyConflictRow[]) ?? []
  } catch { /* Supabase not configured */ }

  // ── Build lookups ────────────────────────────────────────────────────────────
  const childrenByFamily = new Map<string, ChildRow[]>()
  for (const child of children) {
    const arr = childrenByFamily.get(child.family_id) ?? []
    arr.push(child)
    childrenByFamily.set(child.family_id, arr)
  }

  const classMap = new Map(classes.map(c => [c.id, c]))

  const conflictedFamilyIds = new Set<string>()
  for (const c of conflicts) {
    conflictedFamilyIds.add(c.family_a_id)
    conflictedFamilyIds.add(c.family_b_id)
  }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-playfair), "Playfair Display", serif',
              fontSize: '1.5rem', fontWeight: 500, color: 'var(--text)', margin: '0 0 0.25rem',
            }}
          >
            Families
          </h1>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            {families.length} {families.length !== 1 ? 'families' : 'family'} enrolled this school year.
          </p>
        </div>
        <AddFamilyForm classes={classes} />
      </div>

      {/* ── Add-family form (expands inline above list) ────────────────────── */}

      {families.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No families enrolled yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {families.map(family => {
            const familyChildren = childrenByFamily.get(family.id) ?? []
            const hasConflict = conflictedFamilyIds.has(family.id)
            const shiftsPerMonth = getRequiredShifts(family, familyChildren)

            return (
              <div
                key={family.id}
                style={{
                  background: hasConflict ? 'var(--warning-light)' : 'var(--warm-white)',
                  border: '1px solid var(--border)',
                  borderLeft: hasConflict ? '3px solid var(--warning)' : '3px solid var(--sage-light)',
                  borderRadius: '12px',
                  padding: '1rem 1.25rem',
                }}
              >
                {/* ── Family name row ──────────────────────────────────────── */}
                <div
                  style={{
                    display: 'flex', alignItems: 'flex-start',
                    justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.4rem',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.975rem', fontWeight: 600, color: 'var(--text)' }}>
                        {family.name}
                      </span>

                      {hasConflict && (
                        <span
                          style={{
                            fontSize: '0.68rem', fontWeight: 700,
                            color: 'var(--warning)', border: '1px solid var(--warning)',
                            borderRadius: '999px', padding: '0.1rem 0.5rem',
                          }}
                        >
                          ⚠ Conflict
                        </span>
                      )}

                      {family.is_flexible_teacher && (
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '999px',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            background: 'var(--sage-light)',
                            color: 'var(--sage-dark)',
                            marginLeft: '0.35rem',
                            letterSpacing: '0.04em',
                          }}
                        >
                          FT
                        </span>
                      )}

                      {family.is_assistant_teacher && (
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '999px',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            background: 'var(--daisy-light)',
                            color: 'var(--daisy)',
                            marginLeft: '0.35rem',
                            letterSpacing: '0.04em',
                          }}
                        >
                          AT
                        </span>
                      )}

                      {family.notes && (
                        <span
                          style={{
                            fontSize: '0.68rem', color: 'var(--text-muted)',
                            border: '1px solid var(--border)',
                            borderRadius: '999px', padding: '0.1rem 0.5rem',
                          }}
                        >
                          Has notes
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      {family.email}
                    </div>
                  </div>

                  {/* Shift requirement badge + Edit link */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontSize: '1.3rem', fontWeight: 700, lineHeight: 1,
                          color: shiftsPerMonth === null ? 'var(--warning)' : 'var(--sage-dark)',
                        }}
                      >
                        {shiftsPerMonth !== null ? shiftsPerMonth : '—'}
                      </div>
                      <div
                        style={{
                          fontSize: '0.62rem', color: 'var(--text-muted)',
                          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}
                      >
                        {family.shift_override !== null ? 'shifts/mo (override)' : shiftsPerMonth === null ? 'set override' : 'shifts/mo'}
                      </div>
                    </div>
                    <Link
                      href={`/admin/families/${family.id}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.35rem 0.8rem',
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        textDecoration: 'none',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Edit →
                    </Link>
                  </div>
                </div>

                {/* ── Child chips ──────────────────────────────────────────── */}
                {familyChildren.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
                    {familyChildren.map(child => {
                      const cls = classMap.get(child.class_id)
                      const accent = cls ? (CLASS_ACCENTS[cls.name] ?? { bg: 'var(--sage-light)', color: 'var(--sage-dark)' }) : { bg: 'var(--sage-light)', color: 'var(--sage-dark)' }
                      return (
                        <span
                          key={child.id}
                          style={{
                            fontSize: '0.72rem', fontWeight: 600,
                            background: accent.bg, color: accent.color,
                            borderRadius: '999px', padding: '0.2rem 0.65rem',
                          }}
                        >
                          {child.name} · {cls?.name ?? '?'} · {child.days_per_week}d/wk
                        </span>
                      )
                    })}
                  </div>
                )}

                {/* ── Admin notes ──────────────────────────────────────────── */}
                {family.notes && (
                  <div
                    style={{
                      marginTop: '0.6rem', padding: '0.45rem 0.75rem',
                      background: 'var(--cream)', borderRadius: '6px',
                      fontSize: '0.78rem', color: 'var(--text-muted)',
                      borderLeft: '2px solid var(--border)',
                    }}
                  >
                    {family.notes}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p
        style={{
          marginTop: '1.5rem', fontSize: '0.72rem', color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        Conflict flags are visible to admins only. Conflict details are never shown to families.
      </p>
    </div>
  )
}
