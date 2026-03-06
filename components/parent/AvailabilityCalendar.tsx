'use client'

/**
 * AvailabilityCalendar — interactive two-mode calendar for the availability form.
 *
 * Mode "available": clicking a school day toggles it sage-green (volunteer available).
 * Mode "absent":   clicking a school day marks it daisy-yellow for the selected child.
 *
 * A date that is BOTH available and has an absence is shown as a diagonal split:
 *   background: linear-gradient(135deg, var(--sage-light) 50%, var(--daisy-light) 50%)
 *
 * Holidays and weekends are non-interactive (grayed out).
 *
 * The summary strip at the bottom always shows the shift obligation note:
 *   "Planned absences don't change your shift obligation."
 */

import { useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { submitAvailabilityAction } from '@/app/(parent)/parent/availability/actions'
import type { ChildRow, PlannedAbsence } from '@/lib/types'

// ── Types ──────────────────────────────────────────────────────────────────────────────

type CalendarMode = 'available' | 'absent'

interface Props {
  year: number
  month: number // 1-based
  familyId: string | null
  /** Renamed from 'familyChildren' to avoid conflict with React's built-in familyChildren prop */
  familyChildren: ChildRow[]
  /** Array of YYYY-MM-DD strings — passed from server (not Set, which isn't serializable) */
  holidayDates: string[]
  initialAvailableDates: string[]
  initialAbsences: PlannedAbsence[]
  initialExtraShiftsWilling?: string
  requiredShifts: number | null
}

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/**
 * Maps JS getDay() result (0=Sun…6=Sat) to our day abbreviation strings.
 * Weekends are null — they're never valid school days.
 */
const DOW_TO_ABBREV: Record<number, string> = {
  1: 'M',
  2: 'T',
  3: 'W',
  4: 'Th',
  5: 'Fr',
}

// ── Component ────────────────────────────────────────────────────────────────────────────

export function AvailabilityCalendar({
  year,
  month,
  familyId,
  familyChildren,
  holidayDates,
  initialAvailableDates,
  initialAbsences,
  initialExtraShiftsWilling,
  requiredShifts,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // ── Local state ─────────────────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<CalendarMode>('available')
  const [selectedChildId, setSelectedChildId] = useState<string>(familyChildren[0]?.id ?? '')

  const [availableDates, setAvailableDates] = useState<Set<string>>(
    () => new Set(initialAvailableDates)
  )

  // Map<childId, Set<YYYY-MM-DD>>
  const [absences, setAbsences] = useState<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>()
    for (const a of initialAbsences) {
      if (!map.has(a.child_id)) map.set(a.child_id, new Set())
      map.get(a.child_id)!.add(a.date)
    }
    return map
  })

  const [extraShiftsWilling, setExtraShiftsWilling] = useState<string>(
    initialExtraShiftsWilling ?? '0'
  )

  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // ── Derived calendar data ──────────────────────────────────────────────────────────────────────────
  const holidaySet = new Set(holidayDates)
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  // Grid cells: null = blank padding, number = day of month
  const cells: (number | null)[] = [
    ...Array<null>(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  // ── Date helpers ───────────────────────────────────────────────────────────────────────────
  function toISO(day: number): string {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  function isWeekend(day: number): boolean {
    return [0, 6].includes(new Date(year, month - 1, day).getDay())
  }

  function isDisabled(day: number): boolean {
    return isWeekend(day) || holidaySet.has(toISO(day))
  }

  /**
   * Returns true if the currently-selected child is scheduled to attend school
   * on the given day of the month. Used to show an attending-day indicator dot.
   *
   * Rules:
   *  - Only relevant in "absent" mode (where a child is selected).
   *  - 5-day children (days_of_week === null) → no indicator per design spec.
   *  - Part-time children → check if the day-of-week is in their days_of_week.
   */
  function childAttendsDay(day: number): boolean {
    if (mode !== 'absent') return false
    const child = familyChildren.find(c => c.id === selectedChildId)
    if (!child || !child.days_of_week) return false // null = 5-day, no indicator
    const dow = new Date(year, month - 1, day).getDay()
    const abbrev = DOW_TO_ABBREV[dow]
    if (!abbrev) return false
    return child.days_of_week.includes(abbrev)
  }

  // ── Toggle handlers ──────────────────────────────────────────────────────────────────────────
  const toggleDate = useCallback(
    (day: number) => {
      if (isDisabled(day)) return
      setSaveSuccess(false)

      const d = toISO(day)

      if (mode === 'available') {
        setAvailableDates(prev => {
          const next = new Set(prev)
          if (next.has(d)) next.delete(d)
          else next.add(d)
          return next
        })
      } else {
        if (!selectedChildId) return
        setAbsences(prev => {
          const next = new Map(prev)
          const childSet = new Set(next.get(selectedChildId) ?? [])
          if (childSet.has(d)) childSet.delete(d)
          else childSet.add(d)
          next.set(selectedChildId, childSet)
          return next
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, selectedChildId, year, month, holidaySet]
  )

  // ── Save ─────────────────────────────────────────────────────────────────────────────────────
  function handleSave() {
    setSaveError(null)
    setSaveSuccess(false)

    if (!familyId) {
      setSaveError('No family account linked. Contact your administrator to get set up.')
      return
    }

    const periodMonth = `${year}-${String(month).padStart(2, '0')}-01`
    const absenceList: PlannedAbsence[] = []
    for (const [childId, dates] of Array.from(absences)) {
      for (const d of Array.from(dates)) {
        absenceList.push({ child_id: childId, date: d })
      }
    }

    startTransition(async () => {
      const result = await submitAvailabilityAction(
        familyId,
        periodMonth,
        Array.from(availableDates).sort(),
        absenceList,
        extraShiftsWilling
      )
      if (result.error) setSaveError(result.error)
      else setSaveSuccess(true)
    })
  }

  // ── Month navigation (pushes new URL → server re-fetch) ──────────────────────────────────────────────────────────
  function navigateMonth(delta: number) {
    let y = year
    let m = month + delta
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    router.push(`/parent/availability?year=${y}&month=${m}`)
  }

  // ── Cell style helpers ──────────────────────────────────────────────────────────────────────────
  function getCellStyle(day: number): React.CSSProperties {
    const disabled = isDisabled(day)
    const d = toISO(day)
    const available = availableDates.has(d)
    const absent = Array.from(absences.values()).some(s => s.has(d))

    if (disabled) {
      return {
        opacity: 0.35,
        cursor: 'default',
        background: 'transparent',
        border: '1px solid transparent',
        color: 'var(--text-muted)',
      }
    }

    if (available && absent) {
      return {
        background: 'linear-gradient(135deg, var(--sage-light) 50%, var(--daisy-light) 50%)',
        border: '1px solid var(--sage)',
        color: 'var(--text)',
        fontWeight: 600,
        cursor: 'pointer',
      }
    }

    if (available) {
      return {
        background: 'var(--sage-light)',
        border: '1px solid var(--sage)',
        color: 'var(--sage-dark)',
        fontWeight: 600,
        cursor: 'pointer',
      }
    }

    if (absent) {
      return {
        background: 'var(--daisy-light)',
        border: '1px solid var(--daisy)',
        color: 'var(--text)',
        fontWeight: 600,
        cursor: 'pointer',
      }
    }

    return {
      background: 'transparent',
      border: '1px solid transparent',
      color: 'var(--text)',
      cursor: 'pointer',
    }
  }

  // ── Summary stats ──────────────────────────────────────────────────────────────────────────
  const volunteerDays = availableDates.size

  // ── Render ───────────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: '480px' }}>
      {/* Month navigation */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1rem',
        }}
      >
        <button onClick={() => navigateMonth(-1)} style={navBtnStyle} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <span
          style={{
            fontFamily: 'var(--font-playfair), "Playfair Display", serif',
            fontSize: '1.05rem',
            fontWeight: 500,
            color: 'var(--text)',
          }}
        >
          {monthLabel}
        </span>
        <button onClick={() => navigateMonth(1)} style={navBtnStyle} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Mode toggle — full width pill buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {(['available', 'absent'] as CalendarMode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            style={{
              flex: 1,
              padding: '0.5rem',
              borderRadius: '999px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
              transition: 'background 0.15s, color 0.15s',
              background:
                mode === m
                  ? m === 'available'
                    ? 'var(--sage)'
                    : 'var(--daisy)'
                  : 'var(--border)',
              color:
                mode === m
                  ? m === 'available'
                    ? '#fff'
                    : 'var(--text)'
                  : 'var(--text-muted)',
            }}
          >
            {m === 'available' ? '✓ Volunteer available' : '✕ Child absent'}
          </button>
        ))}
      </div>

      {/* Child picker — only shown in absent mode */}
      {mode === 'absent' && familyChildren.length > 0 && (
        <div
          style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}
        >
          {familyChildren.map(child => {
            const active = selectedChildId === child.id
            return (
              <button
                key={child.id}
                onClick={() => setSelectedChildId(child.id)}
                aria-pressed={active}
                style={{
                  padding: '0.3rem 0.85rem',
                  borderRadius: '999px',
                  border: active ? '2px solid var(--daisy)' : '1px solid var(--border)',
                  background: active ? 'var(--daisy-light)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  fontSize: '0.82rem',
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {child.name}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Extra shift willingness ───────────────────────────────────── */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label
          htmlFor="extra-shifts"
          style={{
            display: 'block',
            fontSize: '0.75rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            marginBottom: '0.5rem',
          }}
        >
          Extra shifts this month
        </label>
        <select
          id="extra-shifts"
          value={extraShiftsWilling}
          onChange={e => setExtraShiftsWilling(e.target.value)}
          style={{
            width: '100%',
            padding: '0.6rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            background: 'var(--warm-white)',
            color: 'var(--text)',
            fontSize: '0.9rem',
          }}
        >
          <option value="0">None — just my required shifts</option>
          <option value="1-2">1–2 extra shifts</option>
          <option value="3-4">3–4 extra shifts</option>
          <option value="5+">5 or more extra shifts</option>
        </select>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
          This helps us match volunteers when families request swaps.
        </p>
      </div>

      {/* Calendar grid */}
      <div
        style={{
          background: 'var(--warm-white)',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '0.75rem',
        }}
      >
        {/* Day-of-week headers */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '2px',
            marginBottom: '4px',
          }}
        >
          {DAYS_OF_WEEK.map(d => (
            <div
              key={d}
              style={{
                textAlign: 'center',
                fontSize: '0.68rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.04em',
                padding: '0.2rem 0',
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}
        >
          {cells.map((day, idx) => {
            if (!day) return <div key={`blank-${idx}`} aria-hidden />

            const disabled = isDisabled(day)
            const cellStyle = getCellStyle(day)
            const attends = !disabled && childAttendsDay(day)

            return (
              <button
                key={toISO(day)}
                onClick={() => toggleDate(day)}
                disabled={disabled}
                title={holidaySet.has(toISO(day)) ? 'Holiday — no school' : attends ? 'Your child attends on this day' : undefined}
                aria-label={`${toISO(day)}${availableDates.has(toISO(day)) ? ', available' : ''}${Array.from(absences.values()).some(s => s.has(toISO(day))) ? ', absent' : ''}${attends ? ', child attends' : ''}`}
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '0.4rem',
                  fontSize: '0.82rem',
                  padding: 0,
                  transition: 'background 0.1s, border-color 0.1s',
                  ...cellStyle,
                }}
              >
                {day}
                {/* Attending-day dot: shown for part-time children in absent mode */}
                {attends && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: '0.15rem',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '0.28rem',
                      height: '0.28rem',
                      borderRadius: '50%',
                      background: 'var(--daisy)',
                      display: 'block',
                    }}
                    aria-hidden
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginTop: '0.65rem',
          flexWrap: 'wrap',
        }}
      >
        {[
          { bg: 'var(--sage-light)', border: 'var(--sage)', label: 'Available to volunteer', dot: false },
          { bg: 'var(--daisy-light)', border: 'var(--daisy)', label: 'Child absent', dot: false },
          {
            bg: 'linear-gradient(135deg, var(--sage-light) 50%, var(--daisy-light) 50%)',
            border: 'var(--sage)',
            label: 'Both',
            dot: false,
          },
          { bg: 'transparent', border: 'var(--border)', label: 'Child\'s school day', dot: true },
        ].map(item => (
          <div
            key={item.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
            }}
          >
            {item.dot ? (
              /* Dot legend item */
              <span
                style={{
                  width: '0.8rem',
                  height: '0.8rem',
                  border: `1px solid ${item.border}`,
                  borderRadius: '0.2rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  background: item.bg,
                }}
              >
                <span
                  style={{
                    width: '0.25rem',
                    height: '0.25rem',
                    background: 'var(--daisy)',
                    borderRadius: '50%',
                  }}
                />
              </span>
            ) : (
              <span
                style={{
                  width: '0.8rem',
                  height: '0.8rem',
                  background: item.bg,
                  border: `1px solid ${item.border}`,
                  borderRadius: '0.2rem',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
            )}
            {item.label}
          </div>
        ))}
      </div>

      {/* Summary strip */}
      <div
        style={{
          marginTop: '1rem',
          background: 'var(--warm-white)',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '0.85rem 1rem',
        }}
      >
        <p
          style={{
            margin: '0 0 0.5rem',
            fontSize: '0.68rem',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
          }}
        >
          Summary
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <SummaryRow label="Volunteer days selected" value={String(volunteerDays)} valueColor="var(--sage-dark)" />

          {familyChildren.map(child => (
            <SummaryRow
              key={child.id}
              label={`${child.name} absences`}
              value={String(absences.get(child.id)?.size ?? 0)}
              valueColor="var(--daisy)"
            />
          ))}

          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: '0.4rem',
              marginTop: '0.15rem',
            }}
          >
            <SummaryRow
              label="Shifts/month"
              value={requiredShifts !== null ? String(requiredShifts) : '—'}
              valueColor="var(--text)"
            />
            <p
              style={{
                margin: '0.3rem 0 0',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                fontStyle: 'italic',
              }}
            >
              Planned absences don&apos;t change your shift obligation.
            </p>
          </div>
        </div>
      </div>

      {/* Feedback */}
      {saveError && (
        <div
          role="alert"
          style={{
            marginTop: '0.75rem',
            padding: '0.65rem 0.85rem',
            background: 'var(--warning-light)',
            border: '1px solid var(--warning)',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--warning)',
          }}
        >
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div
          role="status"
          style={{
            marginTop: '0.75rem',
            padding: '0.65rem 0.85rem',
            background: 'var(--sage-light)',
            border: '1px solid var(--sage)',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--sage-dark)',
          }}
        >
          Availability saved for {monthLabel}. ✓
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={isPending}
        style={{
          width: '100%',
          marginTop: '0.75rem',
          padding: '0.7rem 1rem',
          background: isPending ? 'var(--sage-light)' : 'var(--sage)',
          color: isPending ? 'var(--sage-dark)' : '#fff',
          border: 'none',
          borderRadius: '0.5rem',
          fontSize: '0.95rem',
          fontWeight: 500,
          cursor: isPending ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s',
        }}
      >
        {isPending ? 'Saving…' : 'Save availability'}
      </button>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────────────────────

function SummaryRow({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor: string
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: valueColor }}>{value}</span>
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2rem',
  height: '2rem',
  border: '1px solid var(--border)',
  borderRadius: '0.4rem',
  background: 'var(--warm-white)',
  cursor: 'pointer',
  color: 'var(--text-muted)',
}
