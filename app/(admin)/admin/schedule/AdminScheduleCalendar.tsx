'use client'

/**
 * AdminScheduleCalendar — admin schedule management view.
 *
 * Features:
 * - Propose Schedule: runs the algorithm and saves a draft.
 * - Publish Schedule: promotes all proposed shifts to confirmed.
 * - Conflict warning: amber banner that must be acknowledged before publishing.
 * - Month view (calendar grid, default) and Week view (stacked day cards).
 * - Month/week navigation.
 * - Clickable shift chips open a reassign panel with alphabetical family list.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { proposeScheduleAction, publishScheduleAction, reassignShiftAction } from './actions'
import type { ProposalSummary } from './actions'
import type { ClassRow, FamilyConflictRow } from '@/lib/types'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EnrichedShift {
  id: string
  date: string
  classId: string
  className: string
  familyId: string | null
  familyName: string
  status: string
  conflictWarning: boolean
}

export interface FamilyShiftStats {
  id: string
  name: string
  required: number
  assigned: number
}

interface Props {
  year: number
  month: number
  shifts: EnrichedShift[]
  classes: ClassRow[]
  holidayDates: string[]
  hasConflicts: boolean
  hasProposed: boolean
  familyStats: FamilyShiftStats[]
  conflictPairs: FamilyConflictRow[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LABELS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const CLASS_ABBR: Record<string, string> = {
  Rose: 'R',
  Daisy: 'D',
  Azalea: 'A',
}

const CLASS_CHIP: Record<string, { bg: string; color: string }> = {
  Rose: { bg: 'var(--rose-light)', color: 'var(--rose)' },
  Daisy: { bg: 'var(--daisy-light)', color: '#8a6a00' },
  Azalea: { bg: 'var(--azalea-light)', color: 'var(--azalea)' },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const dow = d.getDay() // 0 = Sun
  const diff = (dow + 6) % 7 // distance from Monday
  d.setDate(d.getDate() - diff)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toISO(date: Date): string {
  return date.toISOString().split('T')[0]
}

function formatWeekDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminScheduleCalendar({
  year,
  month,
  shifts,
  classes,
  holidayDates,
  hasConflicts,
  hasProposed,
  familyStats,
  conflictPairs,
}: Props) {
  const router = useRouter()
  const [isProposeP, startPropose] = useTransition()
  const [isPublishP, startPublish] = useTransition()

  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [conflictsAcknowledged, setConflictsAcknowledged] = useState(false)
  const [proposeResult, setProposeResult] = useState<ProposalSummary | null>(null)
  const [proposeError, setProposeError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  // Week view state — start on the Monday of the week containing the 1st of the month
  const [weekMonday, setWeekMonday] = useState<Date>(() =>
    getMondayOf(new Date(year, month - 1, 1))
  )

  // Reassign panel state
  const [selectedShift, setSelectedShift] = useState<EnrichedShift | null>(null)
  const [isReassignPending, startReassign] = useTransition()
  const [reassignError, setReassignError] = useState<string | null>(null)

  // Build lookup map: date → shifts[]
  const shiftsByDate = new Map<string, EnrichedShift[]>()
  for (const s of shifts) {
    const list = shiftsByDate.get(s.date) ?? []
    list.push(s)
    shiftsByDate.set(s.date, list)
  }

  const holidaySet = new Set(holidayDates)
  const todayStr = new Date().toISOString().split('T')[0]
  const conflictsNeedAck = (hasConflicts || (proposeResult?.conflictCount ?? 0) > 0)

  // ── Reassign handler ───────────────────────────────────────────────────────

  function handleReassign(newFamilyId: string) {
    if (!selectedShift) return
    setReassignError(null)
    startReassign(async () => {
      const res = await reassignShiftAction(selectedShift.id, newFamilyId)
      if (res.error) {
        setReassignError(res.error)
      } else {
        setSelectedShift(null)
        router.refresh()
      }
    })
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function handlePropose() {
    setProposeError(null)
    setProposeResult(null)
    setConflictsAcknowledged(false)
    startPropose(async () => {
      const res = await proposeScheduleAction(year, month)
      if (res.error) {
        setProposeError(res.error)
      } else {
        setProposeResult(res.summary ?? null)
        router.refresh()
      }
    })
  }

  function handlePublish() {
    setPublishError(null)
    startPublish(async () => {
      const res = await publishScheduleAction(year, month)
      if (res.error) {
        setPublishError(res.error)
      } else {
        setPublishSuccess(true)
        router.refresh()
      }
    })
  }

  // Month navigation
  function navigateMonth(delta: number) {
    let y = year
    let m = month + delta
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    router.push(`/admin/schedule?year=${y}&month=${m}`)
  }

  // Week navigation
  function navigateWeek(delta: number) {
    setWeekMonday(d => addDays(d, delta * 7))
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function ShiftChip({ shift, onClick }: { shift: EnrichedShift; onClick?: () => void }) {
    const abbr = CLASS_ABBR[shift.className] ?? shift.className[0]
    const colors = CLASS_CHIP[shift.className] ?? { bg: 'var(--sage-light)', color: 'var(--sage-dark)' }
    const isProposed = shift.status === 'proposed'

    if (shift.conflictWarning) {
      return (
        <div
          title={`${shift.familyName} — conflict warning`}
          role={onClick ? 'button' : undefined}
          tabIndex={onClick ? 0 : undefined}
          onClick={onClick}
          onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
          style={{
            fontSize: '0.6rem',
            padding: '0.15rem 0.3rem',
            borderRadius: '4px',
            background: 'var(--warning-light)',
            color: 'var(--warning)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
            opacity: isProposed ? 0.75 : 1,
            cursor: onClick ? 'pointer' : 'default',
          }}
        >
          &#9888; {abbr} {shift.familyName.slice(0, 6)}
        </div>
      )
    }

    return (
      <div
        title={`${shift.className} · ${shift.familyName}`}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
        style={{
          fontSize: '0.6rem',
          padding: '0.15rem 0.3rem',
          borderRadius: '4px',
          background: colors.bg,
          color: colors.color,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
          opacity: isProposed ? 0.72 : 1,
          borderLeft: isProposed ? `2px dashed ${colors.color}` : 'none',
          cursor: onClick ? 'pointer' : 'default',
        }}
      >
        {abbr} {shift.familyName.slice(0, 8)}
      </div>
    )
  }

  // ── Reassign panel ─────────────────────────────────────────────────────────

  function ShiftReassignPanel() {
    if (!selectedShift) return null

    const otherFamiliesOnDate = (shiftsByDate.get(selectedShift.date) ?? [])
      .filter(s => s.id !== selectedShift.id)
      .map(s => s.familyId)

    const otherFamiliesSet = new Set(otherFamiliesOnDate)

    function hasConflictOnDate(familyId: string): boolean {
      return conflictPairs.some(
        p =>
          (p.family_a_id === familyId && otherFamiliesSet.has(p.family_b_id)) ||
          (p.family_b_id === familyId && otherFamiliesSet.has(p.family_a_id))
      )
    }

    const sortedFamilies = [...familyStats].sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    const shiftDate = new Date(
      Number(selectedShift.date.slice(0, 4)),
      Number(selectedShift.date.slice(5, 7)) - 1,
      Number(selectedShift.date.slice(8, 10))
    ).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

    const colors = CLASS_CHIP[selectedShift.className] ?? { bg: 'var(--sage-light)', color: 'var(--sage-dark)' }

    return (
      <>
        {/* Backdrop */}
        <div
          onClick={() => { setSelectedShift(null); setReassignError(null) }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40,
            background: 'rgba(0,0,0,0.25)',
          }}
        />

        {/* Panel */}
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 50,
            width: 'min(400px, 100vw)',
            background: 'var(--warm-white)',
            borderLeft: '1px solid var(--border)',
            boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--border)',
              background: 'var(--cream)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: '0.5rem',
              }}
            >
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                Reassign Shift
              </span>
              <button
                onClick={() => { setSelectedShift(null); setReassignError(null) }}
                aria-label="Close panel"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: '1.2rem',
                  lineHeight: 1,
                  padding: '0 0.25rem',
                }}
              >
                &times;
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  background: colors.bg,
                  color: colors.color,
                  fontWeight: 700,
                }}
              >
                {selectedShift.className}
              </span>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>
                {shiftDate}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Currently: <strong style={{ color: 'var(--text)' }}>{selectedShift.familyName}</strong>
            </p>
          </div>

          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto auto',
              gap: '0.5rem',
              padding: '0.5rem 1.25rem',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              background: 'var(--cream)',
            }}
          >
            <span>Family</span>
            <span style={{ textAlign: 'center' }}>Req</span>
            <span style={{ textAlign: 'center' }}>Done</span>
            <span style={{ textAlign: 'center' }}>Left</span>
          </div>

          {/* Scrollable family list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {sortedFamilies.map(fam => {
              const isCurrent = fam.id === selectedShift.familyId
              const hasConflict = hasConflictOnDate(fam.id)
              const remaining = Math.max(0, fam.required - fam.assigned)

              return (
                <button
                  key={fam.id}
                  disabled={isCurrent || isReassignPending}
                  onClick={() => handleReassign(fam.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto',
                    gap: '0.5rem',
                    alignItems: 'center',
                    width: '100%',
                    padding: '0.75rem 1.25rem',
                    borderBottom: '1px solid var(--border)',
                    background: isCurrent ? 'var(--sage-light)' : 'transparent',
                    border: 'none',
                    borderBottomColor: 'var(--border)',
                    borderBottomWidth: '1px',
                    borderBottomStyle: 'solid',
                    cursor: isCurrent ? 'default' : 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => {
                    if (!isCurrent) (e.currentTarget as HTMLButtonElement).style.background = 'var(--cream)'
                  }}
                  onMouseLeave={e => {
                    if (!isCurrent) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.875rem',
                      color: isCurrent ? 'var(--sage-dark)' : 'var(--text)',
                      fontWeight: isCurrent ? 600 : 400,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {hasConflict && (
                      <span style={{ color: 'var(--warning)', flexShrink: 0 }}>&#9888;</span>
                    )}
                    {fam.name}
                    {isCurrent && (
                      <span
                        style={{
                          fontSize: '0.65rem',
                          padding: '0.1rem 0.35rem',
                          borderRadius: '999px',
                          background: 'var(--sage)',
                          color: 'white',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        current
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      minWidth: '2rem',
                    }}
                  >
                    {fam.required}
                  </span>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      minWidth: '2rem',
                    }}
                  >
                    {fam.assigned}
                  </span>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: remaining > 0 ? 'var(--warning)' : 'var(--text-muted)',
                      fontWeight: remaining > 0 ? 600 : 400,
                      textAlign: 'center',
                      minWidth: '2rem',
                    }}
                  >
                    {remaining}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          {(reassignError || isReassignPending) && (
            <div
              style={{
                padding: '0.75rem 1.25rem',
                borderTop: '1px solid var(--border)',
                fontSize: '0.8rem',
                color: reassignError ? 'var(--danger)' : 'var(--text-muted)',
                background: reassignError ? '#ffe0de' : 'var(--cream)',
              }}
            >
              {isReassignPending ? 'Saving\u2026' : reassignError}
            </div>
          )}
        </div>
      </>
    )
  }

  // ── Month view ─────────────────────────────────────────────────────────────

  function MonthView() {
    const firstDow = new Date(year, month - 1, 1).getDay()
    const daysInMonth = new Date(year, month, 0).getDate()

    return (
      <div style={{ overflowX: 'auto' }}>
        {/* Day labels */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(80px, 1fr))',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {DAY_LABELS.map(d => (
            <div
              key={d}
              style={{
                padding: '0.5rem 0',
                textAlign: 'center',
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(80px, 1fr))',
          }}
        >
          {Array.from({ length: firstDow }).map((_, i) => (
            <div
              key={`pad-${i}`}
              style={{
                minHeight: '5rem',
                borderRight: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
                background: 'var(--cream)',
              }}
            />
          ))}

          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const day = idx + 1
            const date = isoDate(year, month, day)
            const dayShifts = shiftsByDate.get(date) ?? []
            const isHoliday = holidaySet.has(date)
            const dow = new Date(year, month - 1, day).getDay()
            const isWeekend = dow === 0 || dow === 6
            const isToday = date === todayStr
            const colIndex = (firstDow + idx) % 7
            const hasDayConflict = dayShifts.some(s => s.conflictWarning)

            return (
              <div
                key={date}
                style={{
                  minHeight: '5rem',
                  padding: '0.3rem',
                  borderRight: colIndex < 6 ? '1px solid var(--border)' : 'none',
                  borderBottom: '1px solid var(--border)',
                  background: hasDayConflict
                    ? 'var(--warning-light)'
                    : isHoliday || isWeekend
                    ? 'var(--cream)'
                    : 'transparent',
                  opacity: isHoliday ? 0.5 : 1,
                }}
              >
                <div
                  style={{
                    width: '1.5rem',
                    height: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    fontSize: '0.75rem',
                    fontWeight: isToday ? 700 : 400,
                    color: isToday
                      ? 'var(--sage-dark)'
                      : isHoliday || isWeekend
                      ? 'var(--text-muted)'
                      : hasDayConflict
                      ? 'var(--warning)'
                      : 'var(--text)',
                    background: isToday ? 'var(--sage-light)' : 'transparent',
                    marginBottom: '0.2rem',
                  }}
                >
                  {day}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  {dayShifts.map(s => (
                    <ShiftChip key={s.id} shift={s} onClick={() => setSelectedShift(s)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Week view ──────────────────────────────────────────────────────────────

  function WeekView() {
    // Build the 7 days of this week
    const weekDays: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekMonday, i)
      if (d.getFullYear() === year && d.getMonth() === month - 1) {
        weekDays.push(toISO(d))
      }
    }

    const weekStart = toISO(weekMonday)
    const weekEnd = toISO(addDays(weekMonday, 6))

    return (
      <div>
        {/* Week navigation */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border)',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
          }}
        >
          <button
            onClick={() => navigateWeek(-1)}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.3rem 0.7rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            &larr;
          </button>
          <span>
            {formatWeekDay(weekStart)} &ndash; {formatWeekDay(weekEnd)}
          </span>
          <button
            onClick={() => navigateWeek(1)}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.3rem 0.7rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            &rarr;
          </button>
        </div>

        {/* Day cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.75rem' }}>
          {weekDays.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1rem' }}>
              No school days in this week for the current month.
            </p>
          )}
          {weekDays.map(date => {
            const [y, m, d] = date.split('-').map(Number)
            const dow = new Date(y, m - 1, d).getDay()
            const isWeekend = dow === 0 || dow === 6
            const isHoliday = holidaySet.has(date)
            const dayShifts = shiftsByDate.get(date) ?? []
            const hasDayConflict = dayShifts.some(s => s.conflictWarning)
            const isToday = date === todayStr

            if (isWeekend || isHoliday) return null

            return (
              <div
                key={date}
                style={{
                  background: hasDayConflict ? 'var(--warning-light)' : 'var(--warm-white)',
                  border: `1px solid ${hasDayConflict ? 'var(--warning)' : 'var(--border)'}`,
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}
              >
                {/* Day header */}
                <div
                  style={{
                    padding: '0.6rem 1rem',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: hasDayConflict ? 'var(--warning-light)' : 'var(--cream)',
                  }}
                >
                  <span
                    style={{
                      fontWeight: isToday ? 700 : 600,
                      fontSize: '0.875rem',
                      color: hasDayConflict ? 'var(--warning)' : 'var(--text)',
                    }}
                  >
                    {formatWeekDay(date)}
                    {isToday && (
                      <span
                        style={{
                          marginLeft: '0.4rem',
                          fontSize: '0.68rem',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '999px',
                          background: 'var(--sage-light)',
                          color: 'var(--sage-dark)',
                          fontWeight: 600,
                          verticalAlign: 'middle',
                        }}
                      >
                        Today
                      </span>
                    )}
                  </span>
                  {hasDayConflict && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '999px',
                        background: 'var(--warning)',
                        color: 'white',
                        fontWeight: 700,
                      }}
                    >
                      &#9888; Conflict
                    </span>
                  )}
                </div>

                {/* Class rows */}
                {classes.map((cls, ci) => {
                  const clsShifts = dayShifts.filter(s => s.classId === cls.id)
                  const colors = CLASS_CHIP[cls.name] ?? { bg: 'var(--sage-light)', color: 'var(--sage-dark)' }

                  return (
                    <div
                      key={cls.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.6rem 1rem',
                        borderBottom: ci < classes.length - 1 ? '1px solid var(--border)' : 'none',
                      }}
                    >
                      {/* Class badge */}
                      <span
                        style={{
                          fontSize: '0.72rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          background: colors.bg,
                          color: colors.color,
                          fontWeight: 700,
                          flexShrink: 0,
                          minWidth: '3rem',
                          textAlign: 'center',
                        }}
                      >
                        {cls.name}
                      </span>

                      {/* Assigned families */}
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', flex: 1 }}>
                        {clsShifts.length === 0 ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Unfilled
                          </span>
                        ) : (
                          clsShifts.map(s => (
                            <ShiftChip key={s.id} shift={s} onClick={() => setSelectedShift(s)} />
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Full render ────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* ── Page heading ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-playfair), "Playfair Display", serif',
            fontSize: '1.5rem',
            fontWeight: 500,
            color: 'var(--text)',
            margin: '0 0 0.25rem',
          }}
        >
          Schedule
        </h1>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Propose a draft schedule from submitted availability, then publish when ready.
        </p>
      </div>

      {/* ── Propose result banner ─────────────────────────────────────────────── */}
      {proposeResult && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            background: proposeResult.conflictCount > 0 ? 'var(--warning-light)' : 'var(--sage-light)',
            border: `1px solid ${proposeResult.conflictCount > 0 ? 'var(--warning)' : 'var(--sage)'}`,
            marginBottom: '1rem',
            fontSize: '0.875rem',
            color: proposeResult.conflictCount > 0 ? 'var(--warning)' : 'var(--sage-dark)',
          }}
        >
          <strong>Draft created:</strong> {proposeResult.shiftCount} shifts assigned.
          {proposeResult.conflictCount > 0 && (
            <span> {proposeResult.conflictCount} conflict warning{proposeResult.conflictCount !== 1 ? 's' : ''} flagged.</span>
          )}
          {proposeResult.unmetFamilyIds.length > 0 && (
            <span> {proposeResult.unmetFamilyIds.length} family quota{proposeResult.unmetFamilyIds.length !== 1 ? 's' : ''} unmet.</span>
          )}
          {proposeResult.unfilledSlots.length > 0 && (
            <span> {proposeResult.unfilledSlots.length} slot{proposeResult.unfilledSlots.length !== 1 ? 's' : ''} unfilled.</span>
          )}
        </div>
      )}
      {proposeError && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            background: '#ffe0de',
            border: '1px solid var(--danger)',
            marginBottom: '1rem',
            fontSize: '0.875rem',
            color: 'var(--danger)',
          }}
        >
          {proposeError}
        </div>
      )}
      {publishSuccess && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            background: 'var(--sage-light)',
            border: '1px solid var(--sage)',
            marginBottom: '1rem',
            fontSize: '0.875rem',
            color: 'var(--sage-dark)',
          }}
        >
          <strong>Schedule published!</strong> All families have been notified.
        </div>
      )}
      {publishError && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            background: '#ffe0de',
            border: '1px solid var(--danger)',
            marginBottom: '1rem',
            fontSize: '0.875rem',
            color: 'var(--danger)',
          }}
        >
          {publishError}
        </div>
      )}

      {/* ── Conflict acknowledgment banner ────────────────────────────────────── */}
      {conflictsNeedAck && !conflictsAcknowledged && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            background: 'var(--warning-light)',
            border: '1px solid var(--warning)',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
        >
          <input
            type="checkbox"
            id="ack-conflicts"
            checked={conflictsAcknowledged}
            onChange={e => setConflictsAcknowledged(e.target.checked)}
            style={{ marginTop: '0.15rem', cursor: 'pointer', flexShrink: 0 }}
          />
          <label
            htmlFor="ack-conflicts"
            style={{ fontSize: '0.875rem', color: 'var(--warning)', cursor: 'pointer', lineHeight: 1.4 }}
          >
            <strong>Conflict warnings present.</strong> This schedule places families with
            known conflicts on the same day. Check this box to acknowledge and enable publishing.
          </label>
        </div>
      )}

      {/* ── Action bar ───────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        {/* Propose button */}
        <button
          onClick={handlePropose}
          disabled={isProposeP}
          style={{
            background: 'var(--sage)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '0.6rem 1.25rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: isProposeP ? 'default' : 'pointer',
            opacity: isProposeP ? 0.7 : 1,
          }}
        >
          {isProposeP ? 'Proposing\u2026' : 'Propose Schedule'}
        </button>

        {/* Publish button — always rendered; disabled when no proposed shifts exist */}
        <button
          onClick={handlePublish}
          disabled={!hasProposed || isPublishP || (conflictsNeedAck && !conflictsAcknowledged)}
          style={{
            background: (!hasProposed || (conflictsNeedAck && !conflictsAcknowledged)) ? 'var(--border)' : 'var(--sage-dark)',
            color: (!hasProposed || (conflictsNeedAck && !conflictsAcknowledged)) ? 'var(--text-muted)' : 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '0.6rem 1.25rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor:
              (!hasProposed || isPublishP || (conflictsNeedAck && !conflictsAcknowledged))
                ? 'default'
                : 'pointer',
            opacity: isPublishP ? 0.7 : 1,
          }}
        >
          {isPublishP ? 'Publishing\u2026' : 'Publish Schedule'}
        </button>

        {/* View toggle */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
          {(['month', 'week'] as const).map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              style={{
                background: viewMode === v ? 'var(--sage-light)' : 'transparent',
                color: viewMode === v ? 'var(--sage-dark)' : 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '0.4rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: viewMode === v ? 600 : 400,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* ── Calendar card ────────────────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--warm-white)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: 'var(--shadow)',
        }}
      >
        {/* Month header (month view) or inline week header */}
        {viewMode === 'month' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <button
              onClick={() => navigateMonth(-1)}
              aria-label="Previous month"
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '0.35rem 0.85rem',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              &larr;
            </button>
            <span
              style={{
                fontFamily: 'var(--font-playfair), "Playfair Display", serif',
                fontSize: '1.1rem',
                fontWeight: 500,
                color: 'var(--text)',
              }}
            >
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button
              onClick={() => navigateMonth(1)}
              aria-label="Next month"
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '0.35rem 0.85rem',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              &rarr;
            </button>
          </div>
        )}

        {viewMode === 'week' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1.25rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-playfair), "Playfair Display", serif',
                fontSize: '1.1rem',
                fontWeight: 500,
                color: 'var(--text)',
              }}
            >
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => navigateMonth(-1)}
                title="Previous month"
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '0.3rem 0.6rem',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                &#8249; Mo
              </button>
              <button
                onClick={() => navigateMonth(1)}
                title="Next month"
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '0.3rem 0.6rem',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                Mo &#8250;
              </button>
            </div>
          </div>
        )}

        {/* Calendar body */}
        {viewMode === 'month' ? <MonthView /> : <WeekView />}

        {/* Legend */}
        <div
          style={{
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            alignItems: 'center',
          }}
        >
          {['Rose', 'Daisy', 'Azalea'].map(name => {
            const c = CLASS_CHIP[name]!
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span
                  style={{
                    background: c.bg,
                    color: c.color,
                    borderRadius: '4px',
                    padding: '0.1rem 0.35rem',
                    fontWeight: 700,
                    fontSize: '0.6rem',
                  }}
                >
                  {name[0]}
                </span>
                {name}
              </div>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span
              style={{
                background: 'var(--warning-light)',
                color: 'var(--warning)',
                borderRadius: '4px',
                padding: '0.1rem 0.35rem',
                fontWeight: 700,
                fontSize: '0.6rem',
              }}
            >
              &#9888;
            </span>
            Conflict
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span
              style={{
                background: 'var(--sage-light)',
                color: 'var(--sage-dark)',
                borderRadius: '4px',
                padding: '0.1rem 0.35rem',
                fontWeight: 700,
                fontSize: '0.6rem',
                borderLeft: '2px dashed var(--sage-dark)',
              }}
            >
              D
            </span>
            Draft (proposed)
          </div>
        </div>
      </div>

      {/* Day label row for mobile reference */}
      {viewMode === 'month' && (
        <p
          style={{
            marginTop: '0.5rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textAlign: 'right',
          }}
        >
          {DAY_LABELS_SHORT.join(' · ')}
        </p>
      )}

      {/* Reassign panel (renders as fixed overlay) */}
      <ShiftReassignPanel />
    </div>
  )
}
