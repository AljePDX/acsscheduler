/**
 * Drop-ins — /parent/dropins
 *
 * Server component. Shows the family's existing drop-in requests and a form
 * to submit a new one. Drop-in requests are subject to admin approval.
 * No volunteer shift is required for drop-in days.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAvailableDropinSlots } from '@/lib/dropins'
import { DropinRequestForm } from './DropinRequestForm'
import type { DropinRequestRow, ChildRow, ClassRow, SchoolSettingsRow } from '@/lib/types'

export const metadata = { title: 'Drop-ins' }

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const parts = isoDate.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const DROPIN_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const DROPIN_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending: { bg: 'var(--daisy-light)', color: '#8a6a00' },
  approved: { bg: 'var(--sage-light)', color: 'var(--sage-dark)' },
  rejected: { bg: '#ffe0de', color: 'var(--danger)' },
  cancelled: { bg: 'var(--border)', color: 'var(--text-muted)' },
}

// Hoisted outside render to avoid re-creating on every map iteration
const CLASS_COLORS: Record<string, string> = {
  Rose: 'var(--rose)',
  Daisy: 'var(--daisy)',
  Azalea: 'var(--azalea)',
}

const CLASS_BG: Record<string, string> = {
  Rose: 'var(--rose-light)',
  Daisy: 'var(--daisy-light)',
  Azalea: 'var(--azalea-light)',
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function DropInsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let familyId: string | null = null
  let children: ChildRow[] = []
  let classes: ClassRow[] = []
  let dropinRequests: DropinRequestRow[] = []
  let dropinFee = 0
  const childMap = new Map<string, ChildRow>()
  const classMap = new Map<string, ClassRow>()
  let availableSlots: { date: string; classId: string; className: string }[] = []

  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('family_id')
      .eq('id', user.id)
      .returns<{ family_id: string | null }[]>()
      .maybeSingle()

    familyId = userRow?.family_id ?? null

    if (familyId) {
      const [childrenRes, classesRes, requestsRes, settingsRes] = await Promise.all([
        supabase.from('children').select('*').eq('family_id', familyId),

        supabase.from('classes').select('*').order('name'),

        supabase
          .from('dropin_requests')
          .select('*')
          .eq('family_id', familyId)
          .order('date', { ascending: false }),

        supabase
          .from('school_settings')
          .select('dropin_fee')
          .eq('id', 1)
          .returns<Pick<SchoolSettingsRow, 'dropin_fee'>[]>()
          .maybeSingle(),
      ])

      children = (childrenRes.data as ChildRow[]) ?? []
      classes = (classesRes.data as ClassRow[]) ?? []
      dropinRequests = (requestsRes.data as DropinRequestRow[]) ?? []
      dropinFee = settingsRes.data?.dropin_fee ?? 0

      for (const c of children) childMap.set(c.id, c)
      for (const cls of classes) classMap.set(cls.id, cls)

      // ── Compute available drop-in slots for current month and next ──────────
      const now = new Date()
      const months = [
        { year: now.getFullYear(), month: now.getMonth() + 1 },
        {
          year: now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear(),
          month: now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2,
        },
      ]

      try {
        const allChildren = (
          (await supabase.from('children').select('id, class_id, days_of_week')).data ?? []
        ) as { id: string; class_id: string; days_of_week: string[] | null }[]

        const childrenByClass: Record<string, { id: string; days_of_week: string[] | null }[]> = {}
        for (const c of allChildren) {
          const list = childrenByClass[c.class_id] ?? []
          list.push({ id: c.id, days_of_week: c.days_of_week })
          childrenByClass[c.class_id] = list
        }

        for (const { year, month } of months) {
          const periodMonth = `${year}-${String(month).padStart(2, '0')}-01`
          const lastDay = new Date(year, month, 0).getDate()
          const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

          const [availRes, dropinRes, holidayRes] = await Promise.all([
            supabase
              .from('availability')
              .select('planned_absences, family_id')
              .gte('period_month', periodMonth)
              .lte('period_month', periodMonth),
            supabase
              .from('dropin_requests')
              .select('class_id, date')
              .eq('status', 'approved')
              .gte('date', periodMonth)
              .lte('date', monthEnd),
            supabase
              .from('holidays')
              .select('date')
              .gte('date', periodMonth)
              .lte('date', monthEnd),
          ])

          const holidayDates = new Set(
            ((holidayRes.data ?? []) as { date: string }[]).map((h) => h.date)
          )

          // Build absences by class
          const absencesByClass: Record<string, { child_id: string; date: string }[]> = {}
          for (const avRow of (availRes.data ?? []) as {
            planned_absences: { child_id: string; date: string }[]
          }[]) {
            for (const abs of avRow.planned_absences ?? []) {
              const child = allChildren.find((c) => c.id === abs.child_id)
              if (!child) continue
              const list = absencesByClass[child.class_id] ?? []
              list.push(abs)
              absencesByClass[child.class_id] = list
            }
          }

          // Build approved dropin counts
          const approvedDropinsByClass: Record<string, Record<string, number>> = {}
          for (const d of (dropinRes.data ?? []) as { class_id: string; date: string }[]) {
            const byDate = approvedDropinsByClass[d.class_id] ?? {}
            byDate[d.date] = (byDate[d.date] ?? 0) + 1
            approvedDropinsByClass[d.class_id] = byDate
          }

          const slots = getAvailableDropinSlots({
            year,
            month,
            classes: classes.map((c) => ({
              id: c.id,
              name: c.name,
              student_teacher_ratio: c.student_teacher_ratio,
            })),
            childrenByClass,
            absencesByClass,
            approvedDropinsByClass,
            holidayDates,
          })
          availableSlots = [...availableSlots, ...slots]
        }
      } catch {
        // Non-fatal — slots remain empty
      }
    }
  } catch {
    // Supabase not configured — empty state
  }

  return (
    <div
      style={{
        maxWidth: '720px',
        margin: '0 auto',
        padding: '1.5rem 1rem',
      }}
    >
      {/* ── Heading ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), "Playfair Display", serif',
            fontSize: '1.5rem',
            fontWeight: 500,
            color: 'var(--text)',
            margin: '0 0 0.35rem',
          }}
        >
          Drop-ins
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}
        >
          Request a drop-in day for your child when they are not normally
          scheduled. Drop-ins are subject to availability and administrator
          approval. No volunteer shift is required for drop-in days.
        </p>
      </div>

      {!familyId ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No family account found. Contact your administrator to get set up.
        </p>
      ) : (
        <>
          {/* ── Available drop-in dates ───────────────────────────────────────── */}
          {availableSlots.length > 0 && (
            <section style={{ marginBottom: '2rem' }}>
              <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
                Available Drop-in Dates
              </h2>
              <div
                style={{
                  background: 'var(--warm-white)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                }}
              >
                {availableSlots.map((slot, i) => (
                  <div
                    key={`${slot.classId}-${slot.date}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.75rem',
                      padding: '0.85rem 1.25rem',
                      borderBottom:
                        i < availableSlots.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          background: CLASS_BG[slot.className] ?? 'var(--border)',
                          color: CLASS_COLORS[slot.className] ?? 'var(--text)',
                        }}
                      >
                        {slot.className}
                      </span>
                      <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>
                        {formatDate(slot.date)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        ${dropinFee}
                      </span>
                      <span
                        style={{
                          fontSize: '0.78rem',
                          color: 'var(--sage-dark)',
                          fontWeight: 600,
                        }}
                      >
                        ↓ Request below
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Request form ─────────────────────────────────────────────────── */}
          {children.length > 0 && classes.length > 0 ? (
            <section style={{ marginBottom: '2rem' }}>
              <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
                New Request
              </h2>
              <div
                style={{
                  background: 'var(--warm-white)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '1.25rem',
                }}
              >
                <DropinRequestForm
                  familyChildren={children}
                  classes={classes}
                  dropinFee={dropinFee}
                />
              </div>
            </section>
          ) : (
            <div
              style={{
                background: 'var(--warm-white)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '1.5rem',
                marginBottom: '2rem',
                fontSize: '0.875rem',
                color: 'var(--text-muted)',
              }}
            >
              No children or classes configured yet. Contact your administrator.
            </div>
          )}

          {/* ── Existing requests ────────────────────────────────────────────── */}
          <section>
            <h2 className="label-section" style={{ marginBottom: '0.75rem' }}>
              Your Requests
            </h2>

            {dropinRequests.length === 0 ? (
              <div
                style={{
                  background: 'var(--warm-white)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  fontSize: '0.875rem',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}
              >
                No drop-in requests yet.
              </div>
            ) : (
              <div
                style={{
                  background: 'var(--warm-white)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                }}
              >
                {dropinRequests.map((req, i) => {
                  const child = childMap.get(req.child_id)
                  const cls = classMap.get(req.class_id)
                  const statusColors =
                    DROPIN_STATUS_COLORS[req.status] ?? DROPIN_STATUS_COLORS.pending

                  return (
                    <div
                      key={req.id}
                      style={{
                        padding: '0.85rem 1.25rem',
                        borderBottom:
                          i < dropinRequests.length - 1
                            ? '1px solid var(--border)'
                            : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            color: 'var(--text)',
                            marginBottom: '0.15rem',
                          }}
                        >
                          {formatDate(req.date)}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {child?.name ?? 'Unknown child'}
                          {cls ? ` \u2022 ${cls.name} class` : ''}
                          {' \u2022 '}${req.fee}
                        </div>
                        {req.admin_notes && req.status === 'rejected' && (
                          <div
                            style={{
                              fontSize: '0.78rem',
                              color: 'var(--text-muted)',
                              fontStyle: 'italic',
                              marginTop: '0.2rem',
                            }}
                          >
                            {req.admin_notes}
                          </div>
                        )}
                      </div>

                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '999px',
                          background: statusColors.bg,
                          color: statusColors.color,
                          fontWeight: 600,
                          flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {DROPIN_STATUS_LABELS[req.status] ?? req.status}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
