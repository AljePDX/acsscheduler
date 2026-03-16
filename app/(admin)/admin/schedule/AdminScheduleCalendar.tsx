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
 * - Clicking a day cell opens DayManagementPanel (add/remove/move shifts).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  proposeScheduleAction,
  publishScheduleAction,
  addShiftAction,
  removeAssignmentAction,
  moveShiftClassAction,
} from './actions'
import type { ProposalSummary } from './actions'
import type { ClassRow, FamilyConflictRow } from '@/lib/types'
import { computeConflictWarning } from '@/lib/schedule-utils'

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
  offDayWarning: boolean
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
  familyAvailability: Record<string, {
    availableDates: string[]
    preferredDates: string[]
    notes: string | null
  }>
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

// ── DayManagementPanel ────────────────────────────────────────────────────────

interface DayManagementPanelProps {
  date: string
  classes: ClassRow[]
  dayShifts: EnrichedShift[]
  familyStats: FamilyShiftStats[]
  familyAvailability: Record<string, {
    availableDates: string[]
    preferredDates: string[]
    notes: string | null
  }>
  conflictPairs: FamilyConflictRow[]
  onClose: () => void
}

function DayManagementPanel({
  date,
  classes,
  dayShifts,
  familyStats,
  familyAvailability,
  conflictPairs,
  onClose,
}: DayManagementPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Families assigned on this day (non-null family_id)
  const assignedFamilyIds = dayShifts
    .filter(s => s.familyId !== null)
    .map(s => s.familyId as string)

  // Eligible families for "+ Add": available this date, not already assigned, quota remaining
  const eligibleFamilies = familyStats.filter(fam => {
    const avail = familyAvailability[fam.id]
    if (!avail?.availableDates.includes(date)) return false
    if (assignedFamilyIds.includes(fam.id)) return false
    if (fam.assigned >= fam.required) return false
    return true
  })

  const hasConflictOnDay = (familyId: string) =>
    computeConflictWarning(familyId, assignedFamilyIds, conflictPairs)

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const CLASS_COLORS: Record<string, string> = {
    Rose: 'var(--rose)', Daisy: 'var(--daisy)', Azalea: 'var(--azalea)',
  }
  const CLASS_BG: Record<string, string> = {
    Rose: 'var(--rose-light)', Daisy: 'var(--daisy-light)', Azalea: 'var(--azalea-light)',
  }

  function handleRemove(shiftId: string) {
    setError(null)
    startTransition(async () => {
      const res = await removeAssignmentAction(shiftId)
      if (res.error) setError(res.error)
    })
  }

  function handleMove(shiftId: string, newClassId: string) {
    setError(null)
    startTransition(async () => {
      const res = await moveShiftClassAction(shiftId, newClassId)
      if (res.error) setError(res.error)
    })
  }

  function handleAdd(classId: string, familyId: string) {
    setError(null)
    startTransition(async () => {
      const res = await addShiftAction(date, classId, familyId)
      if (res.error) setError(res.error)
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40,
        }}
      />
      {/* Panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: '360px',
          background: 'var(--warm-white)', borderLeft: '1px solid var(--border)',
          zIndex: 50, overflowY: 'auto', display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--shadow)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.25rem 1.25rem 0.75rem',
          borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              Manage Day
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)', marginTop: '0.1rem' }}>
              {formattedDate}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Class sections */}
        <div style={{ flex: 1, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {classes.map(cls => {
            const classShifts = dayShifts.filter(s => s.classId === cls.id)
            const classEligible = eligibleFamilies.filter(f =>
              !classShifts.some(s => s.familyId === f.id)
            )
            const otherClassIds = classes
              .filter(c => c.id !== cls.id)
              .map(c => ({ id: c.id, name: c.name }))

            return (
              <div key={cls.id}>
                {/* Class header */}
                <div style={{
                  fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: CLASS_COLORS[cls.name] ?? 'var(--text-muted)',
                  marginBottom: '0.5rem', borderLeft: `3px solid ${CLASS_COLORS[cls.name] ?? 'var(--border)'}`,
                  paddingLeft: '0.5rem',
                }}>
                  {cls.name}
                </div>

                {/* Assigned families */}
                {classShifts.length === 0 && (
                  <div style={{
                    padding: '0.6rem 0.75rem',
                    background: 'var(--warning-light)', borderRadius: '8px',
                    border: '1px solid var(--warning)',
                    fontSize: '0.8rem', color: 'var(--warning)', fontWeight: 600,
                  }}>
                    ⚠ Unfilled — needs a volunteer
                  </div>
                )}
                {classShifts.map(shift => {
                  if (shift.familyId === null) {
                    return (
                      <div key={shift.id} style={{
                        padding: '0.6rem 0.75rem', marginBottom: '0.4rem',
                        background: 'var(--warning-light)', borderRadius: '8px',
                        border: '1px solid var(--warning)',
                        fontSize: '0.8rem', color: 'var(--warning)', fontWeight: 600,
                      }}>
                        ⚠ Unfilled slot
                      </div>
                    )
                  }
                  const avail = familyAvailability[shift.familyId]
                  const isPreferred = avail?.preferredDates.includes(date) ?? false
                  const hasNote = !!avail?.notes

                  return (
                    <div key={shift.id} style={{
                      padding: '0.65rem 0.75rem', marginBottom: '0.4rem',
                      background: 'var(--cream)', borderRadius: '8px',
                      border: '1px solid var(--border)',
                    }}>
                      {/* Family name row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>
                          {isPreferred && <span title="Preferred day" style={{ color: 'var(--daisy)', marginRight: '0.3rem' }}>★</span>}
                          {shift.familyName}
                          {shift.conflictWarning && (
                            <span title="Conflict warning" style={{ color: 'var(--warning)', marginLeft: '0.3rem', fontSize: '0.75rem' }}>⚠</span>
                          )}
                          {shift.offDayWarning && (
                            <span title="Scheduled on a non-attendance day" style={{ color: 'var(--warning)', marginLeft: '0.3rem', fontSize: '0.75rem' }}>★</span>
                          )}
                        </span>
                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                          {/* Move to another class */}
                          {otherClassIds.map(oc => (
                            <button
                              key={oc.id}
                              onClick={() => handleMove(shift.id, oc.id)}
                              disabled={isPending}
                              title={`Move to ${oc.name}`}
                              style={{
                                fontSize: '0.7rem', padding: '0.2rem 0.4rem',
                                background: CLASS_BG[oc.name] ?? 'var(--cream)',
                                color: CLASS_COLORS[oc.name] ?? 'var(--text)',
                                border: `1px solid ${CLASS_COLORS[oc.name] ?? 'var(--border)'}`,
                                borderRadius: '4px', cursor: 'pointer', fontWeight: 600,
                              }}
                            >
                              → {oc.name}
                            </button>
                          ))}
                          {/* Remove */}
                          <button
                            onClick={() => handleRemove(shift.id)}
                            disabled={isPending}
                            title="Remove assignment"
                            style={{
                              fontSize: '0.75rem', padding: '0.2rem 0.45rem',
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              borderRadius: '4px', cursor: 'pointer',
                              color: 'var(--danger)',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* Note (if any) */}
                      {hasNote && (
                        <div style={{
                          fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic',
                          marginTop: '0.3rem',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {avail!.notes}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Add Family */}
                {classEligible.length > 0 && (
                  <div style={{ marginTop: '0.35rem' }}>
                    <select
                      value=""
                      onChange={e => {
                        if (e.target.value) handleAdd(cls.id, e.target.value)
                      }}
                      disabled={isPending}
                      style={{
                        width: '100%', padding: '0.45rem 0.6rem',
                        background: 'var(--warm-white)', border: '1px dashed var(--border)',
                        borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="">+ Add family…</option>
                      {classEligible.map(fam => {
                        const conflict = hasConflictOnDay(fam.id)
                        const preferred = familyAvailability[fam.id]?.preferredDates.includes(date)
                        return (
                          <option key={fam.id} value={fam.id}>
                            {preferred ? '★ ' : ''}{fam.name}{conflict ? ' ⚠' : ''} ({fam.required - fam.assigned} left)
                          </option>
                        )
                      })}
                    </select>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        {(isPending || error) && (
          <div style={{
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid var(--border)',
            fontSize: '0.8rem',
            color: error ? 'var(--danger)' : 'var(--text-muted)',
          }}>
            {isPending ? 'Saving…' : error}
          </div>
        )}
      </div>
    </>
  )
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
  familyAvailability,
}: Props) {
  const router = useRouter()
  const [isProposeP, startPropose] = useTransition()
  const [isPublishP, startPublish] = useTransition()

  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [conflictsAcknowledged, setConflictsAcknowledged] = useState(false)
  const [offDayAcknowledged, setOffDayAcknowledged] = useState(false)
  const [proposeResult, setProposeResult] = useState<ProposalSummary | null>(null)
  const [proposeError, setProposeError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  // Week view state — start on the Monday of the week containing the 1st of the month
  const [weekMonday, setWeekMonday] = useState<Date>(() =>
    getMondayOf(new Date(year, month - 1, 1))
  )

  // Day management panel state
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

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
  const offDayNeedAck = shifts.some(s => s.offDayWarning && s.status === 'proposed')

  // ── Actions ────────────────────────────────────────────────────────────────

  function handlePropose() {
    setProposeError(null)
    setProposeResult(null)
    setConflictsAcknowledged(false)
    setOffDayAcknowledged(false)
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

  function ShiftChip({ shift }: { shift: EnrichedShift }) {
    const abbr = CLASS_ABBR[shift.className] ?? shift.className[0]
    const colors = CLASS_CHIP[shift.className] ?? { bg: 'var(--sage-light)', color: 'var(--sage-dark)' }
    const isProposed = shift.status === 'proposed'

    if (shift.conflictWarning) {
      return (
        <div
          title={`${shift.familyName} — conflict warning`}
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
          }}
        >
          &#9888; {abbr} {shift.familyName.slice(0, 6)}
        </div>
      )
    }

    return (
      <div
        title={`${shift.className} · ${shift.familyName}`}
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
        }}
      >
        {abbr} {shift.familyName.slice(0, 8)}
      </div>
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
            const hasDayOffDay = dayShifts.some(s => s.offDayWarning)
            const hasUnfilled = dayShifts.some(s => s.familyId === null)

            return (
              <div
                key={date}
                onClick={() => { if (!isHoliday && !isWeekend) setSelectedDay(date) }}
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
                  cursor: isHoliday || isWeekend ? 'default' : 'pointer',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.2rem',
                    marginBottom: '0.2rem',
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
                      flexShrink: 0,
                    }}
                  >
                    {day}
                  </div>
                  {hasDayConflict && (
                    <span
                      title="Conflict warning"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '1.1rem', height: '1.1rem', borderRadius: '50%',
                        background: 'var(--warning)', color: '#fff',
                        fontSize: '0.6rem', fontWeight: 700,
                      }}
                    >
                      ⚠
                    </span>
                  )}
                  {hasDayOffDay && (
                    <span
                      title="Non-attendance day"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '1.1rem', height: '1.1rem', borderRadius: '50%',
                        background: 'var(--warning)', color: '#fff',
                        fontSize: '0.6rem', fontWeight: 700, marginLeft: '0.2rem',
                      }}
                    >
                      ★
                    </span>
                  )}
                  {hasUnfilled && (
                    <span
                      title="Unfilled slot"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '1.1rem', height: '1.1rem', borderRadius: '50%',
                        background: 'var(--warning)', color: '#fff',
                        fontSize: '0.6rem', fontWeight: 700, marginLeft: '0.2rem',
                      }}
                    >
                      ⚠
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  {dayShifts.map(s => (
                    <ShiftChip key={s.id} shift={s} />
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
            const hasDayOffDay = dayShifts.some(s => s.offDayWarning)
            const hasUnfilled = dayShifts.some(s => s.familyId === null)
            const isToday = date === todayStr

            if (isWeekend || isHoliday) return null

            return (
              <div
                key={date}
                onClick={() => setSelectedDay(date)}
                style={{
                  background: hasDayConflict ? 'var(--warning-light)' : 'var(--warm-white)',
                  border: `1px solid ${hasDayConflict ? 'var(--warning)' : 'var(--border)'}`,
                  borderRadius: '10px',
                  overflow: 'hidden',
                  cursor: 'pointer',
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
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
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
                    {hasDayOffDay && (
                      <span
                        title="Non-attendance day"
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: '1.1rem', height: '1.1rem', borderRadius: '50%',
                          background: 'var(--warning)', color: '#fff',
                          fontSize: '0.6rem', fontWeight: 700, marginLeft: '0.2rem',
                        }}
                      >
                        ★
                      </span>
                    )}
                    {hasUnfilled && (
                      <span
                        title="Unfilled slot"
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: '1.1rem', height: '1.1rem', borderRadius: '50%',
                          background: 'var(--warning)', color: '#fff',
                          fontSize: '0.6rem', fontWeight: 700,
                        }}
                      >
                        ⚠
                      </span>
                    )}
                  </div>
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
                            <ShiftChip key={s.id} shift={s} />
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

      {/* ── Off-day acknowledgment banner ──────────────────────────────────────── */}
      {offDayNeedAck && !offDayAcknowledged && (
        <div
          style={{
            background: 'var(--warning-light)',
            border: '1px solid var(--warning)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
        >
          <span style={{ color: 'var(--warning)', fontSize: '1.1rem', lineHeight: 1 }}>★</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: 'var(--warning)', fontSize: '0.875rem' }}>
              Non-attendance day assignments
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Some parents are scheduled on days their children are not attending school.
              Review these assignments before publishing.
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={offDayAcknowledged}
              onChange={e => setOffDayAcknowledged(e.target.checked)}
            />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--warning)' }}>Acknowledge</span>
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
          disabled={!hasProposed || isPublishP || (conflictsNeedAck && !conflictsAcknowledged) || (offDayNeedAck && !offDayAcknowledged)}
          style={{
            background: (!hasProposed || (conflictsNeedAck && !conflictsAcknowledged) || (offDayNeedAck && !offDayAcknowledged)) ? 'var(--border)' : 'var(--sage-dark)',
            color: (!hasProposed || (conflictsNeedAck && !conflictsAcknowledged) || (offDayNeedAck && !offDayAcknowledged)) ? 'var(--text-muted)' : 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '0.6rem 1.25rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor:
              (!hasProposed || isPublishP || (conflictsNeedAck && !conflictsAcknowledged) || (offDayNeedAck && !offDayAcknowledged))
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

      {/* Day management panel (renders as fixed overlay) */}
      {selectedDay && (
        <DayManagementPanel
          date={selectedDay}
          classes={classes}
          dayShifts={shifts.filter(s => s.date === selectedDay)}
          familyStats={familyStats}
          familyAvailability={familyAvailability}
          conflictPairs={conflictPairs}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  )
}
