'use client'

/**
 * FamilyDetailForm — client component for /admin/families/[id]
 *
 * Two sections:
 *   1. Family info: name, email, phone, notes (admin-only), shift override
 *   2. Children: list with inline edit (including days-of-week) + remove + add-child form
 *
 * Pending day-of-week change requests from parents are shown as amber banners
 * with Approve / Reject buttons. Admins can also edit days directly without approval.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { FamilyRow, ChildRow, ClassRow } from '@/lib/types'
import {
  updateFamilyAction,
  addChildToFamilyAction,
  updateChildForFamilyAction,
  deleteChildFromFamilyAction,
  approveDayChangeAction,
  rejectDayChangeAction,
  type UpdateFamilyInput,
} from './actions'

// ── Constants ──────────────────────────────────────────────────────────────────

const ALL_DAYS = ['M', 'T', 'W', 'Th', 'Fr']

// ── Shared style helpers ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.55rem 0.75rem',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '0.875rem',
  background: 'var(--warm-white)',
  color: 'var(--text)',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
  marginBottom: '0.3rem',
}

const sectionHeadStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
  margin: '0 0 0.85rem',
}

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.1rem',
  background: 'var(--sage)',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  fontSize: '0.875rem',
  fontWeight: 600,
  cursor: 'pointer',
}

const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: 'transparent',
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '0.875rem',
  cursor: 'pointer',
}

const btnDanger: React.CSSProperties = {
  padding: '0.4rem 0.85rem',
  background: 'transparent',
  color: 'var(--danger)',
  border: '1px solid var(--danger)',
  borderRadius: '8px',
  fontSize: '0.8rem',
  cursor: 'pointer',
}

const errorStyle: React.CSSProperties = {
  marginTop: '0.5rem',
  padding: '0.5rem 0.75rem',
  background: 'var(--warning-light)',
  border: '1px solid var(--warning)',
  borderRadius: '8px',
  color: 'var(--warning)',
  fontSize: '0.8rem',
}

const successStyle: React.CSSProperties = {
  marginTop: '0.5rem',
  padding: '0.5rem 0.75rem',
  background: 'var(--sage-light)',
  border: '1px solid var(--sage)',
  borderRadius: '8px',
  color: 'var(--sage-dark)',
  fontSize: '0.8rem',
}

// ── Class accent colours ───────────────────────────────────────────────────────

const CLASS_ACCENTS: Record<string, { bg: string; color: string }> = {
  Rose:   { bg: 'var(--rose-light)',   color: 'var(--rose)' },
  Daisy:  { bg: 'var(--daisy-light)',  color: 'var(--daisy)' },
  Azalea: { bg: 'var(--azalea-light)', color: 'var(--azalea)' },
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  family: FamilyRow
  childRecords: ChildRow[]
  classes: ClassRow[]
}

// ── Day picker sub-component ──────────────────────────────────────────────────

function DayPicker({
  selected,
  onChange,
  daysPerWeek,
}: {
  selected: string[]
  onChange: (days: string[]) => void
  daysPerWeek: number
}) {
  const countMatch = selected.length === daysPerWeek

  function toggle(day: string) {
    if (selected.includes(day)) {
      onChange(selected.filter(d => d !== day))
    } else {
      onChange([...selected, day])
    }
  }

  return (
    <div>
      <label style={labelStyle}>
        Attending days ({selected.length}/{daysPerWeek} selected)
      </label>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {ALL_DAYS.map(day => {
          const active = selected.includes(day)
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggle(day)}
              style={{
                padding: '0.3rem 0.7rem',
                borderRadius: '999px',
                border: `1.5px solid ${active ? 'var(--sage)' : 'var(--border)'}`,
                background: active ? 'var(--sage)' : 'transparent',
                color: active ? '#fff' : 'var(--text-muted)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {day}
            </button>
          )
        })}
      </div>
      {selected.length > 0 && !countMatch && (
        <p style={{ margin: '0.3rem 0 0', fontSize: '0.72rem', color: 'var(--warning)' }}>
          Select exactly {daysPerWeek} days to match enrollment.
        </p>
      )}
    </div>
  )
}

// ── Family info section ────────────────────────────────────────────────────────

function FamilyInfoSection({ family }: { family: FamilyRow }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState(family.name)
  const [email, setEmail] = useState(family.email)
  const [phone, setPhone] = useState(family.phone ?? '')
  const [notes, setNotes] = useState(family.notes ?? '')
  const [override, setOverride] = useState(
    family.shift_override !== null ? String(family.shift_override) : ''
  )
  const [isFlexibleTeacher, setIsFlexibleTeacher] = useState(family.is_flexible_teacher)
  const [isAssistantTeacher, setIsAssistantTeacher] = useState(family.is_assistant_teacher)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setError(null)
    setSaved(false)
    const input: UpdateFamilyInput = {
      name,
      email,
      phone,
      notes,
      shift_override: override,
      is_flexible_teacher: isFlexibleTeacher,
      is_assistant_teacher: isAssistantTeacher,
    }
    startTransition(async () => {
      const result = await updateFamilyAction(family.id, input)
      if (result.error) {
        setError(result.error)
      } else {
        setSaved(true)
        router.refresh()
      }
    })
  }

  return (
    <div>
      <p style={sectionHeadStyle}>Family Information</p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '0.85rem',
          marginBottom: '0.85rem',
        }}
      >
        <div>
          <label style={labelStyle}>Family name</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Anderson" />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="parent@example.com" />
        </div>
        <div>
          <label style={labelStyle}>Phone (optional)</label>
          <input style={inputStyle} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 000-0000" />
        </div>
        <div>
          <label style={labelStyle}>Shift override / mo (optional)</label>
          <input style={inputStyle} type="number" min={0} max={20} value={override} onChange={e => setOverride(e.target.value)} placeholder="Leave blank to auto-calculate" />
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Use for 3+ child families or special arrangements.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: '0.85rem' }}>
        <label style={labelStyle}>Admin notes (never shown to parents)</label>
        <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes about this family…" />
      </div>

      {/* Teacher Settings — admin only */}
      <div style={{ marginTop: '1.5rem', marginBottom: '0.85rem' }}>
        <div style={{
          fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.75rem',
        }}>
          Teacher Settings
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            name="is_flexible_teacher"
            checked={isFlexibleTeacher}
            onChange={e => setIsFlexibleTeacher(e.target.checked)}
          />
          <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>
            Flexible Teacher
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
            Can be assigned to any class, not just their child&apos;s
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            name="is_assistant_teacher"
            checked={isAssistantTeacher}
            onChange={e => setIsAssistantTeacher(e.target.checked)}
          />
          <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>
            Assistant Teacher
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
            Scheduled for extra shifts last (higher cost to school)
          </span>
        </label>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {saved && <div style={successStyle}>Changes saved.</div>}

      <div style={{ marginTop: '0.75rem' }}>
        <button style={btnPrimary} onClick={handleSave} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save family info'}
        </button>
      </div>
    </div>
  )
}

// ── Single child card (view + inline edit) ────────────────────────────────────

function ChildCard({
  child,
  familyId,
  classes,
}: {
  child: ChildRow
  familyId: string
  classes: ClassRow[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [approvePending, startApproveTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(child.name)
  const [classId, setClassId] = useState(child.class_id)
  const [days, setDays] = useState(child.days_per_week)
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>(child.days_of_week ?? [])
  const [error, setError] = useState<string | null>(null)

  const cls = classes.find(c => c.id === child.class_id)
  const accent = cls
    ? (CLASS_ACCENTS[cls.name] ?? { bg: 'var(--sage-light)', color: 'var(--sage-dark)' })
    : { bg: 'var(--sage-light)', color: 'var(--sage-dark)' }

  const hasPending = child.days_change_status === 'pending'

  function formatDays(d: string[] | null | undefined): string {
    if (!d || d.length === 0) return 'M, T, W, Th, Fr'
    return d.join(', ')
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await updateChildForFamilyAction(child.id, familyId, {
        name,
        classId,
        daysPerWeek: days,
        daysOfWeek: days === 5 ? null : daysOfWeek,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setEditing(false)
        router.refresh()
      }
    })
  }

  function handleDelete() {
    if (!confirm(`Remove ${child.name} from this family? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await deleteChildFromFamilyAction(child.id, familyId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  function handleApprove() {
    startApproveTransition(async () => {
      const result = await approveDayChangeAction(child.id, familyId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  function handleReject() {
    startApproveTransition(async () => {
      const result = await rejectDayChangeAction(child.id, familyId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  if (!editing) {
    return (
      <div
        style={{
          padding: '0.65rem 0',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* Pending day-change banner */}
        {hasPending && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              padding: '0.5rem 0.75rem',
              background: 'var(--warning-light)',
              border: '1px solid var(--warning)',
              borderRadius: '8px',
              marginBottom: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--warning)', marginBottom: '0.1rem' }}>
                ⏳ Day change requested by parent
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--warning)' }}>
                Current: <strong>{formatDays(child.days_of_week)}</strong>
                {' → '}
                Requested: <strong>{formatDays(child.days_change_pending)}</strong>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
              <button
                style={{ ...btnPrimary, fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                onClick={handleApprove}
                disabled={approvePending}
              >
                Approve
              </button>
              <button
                style={{ ...btnDanger, fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                onClick={handleReject}
                disabled={approvePending}
              >
                Reject
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>
              {child.name}
            </span>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                background: accent.bg,
                color: accent.color,
                borderRadius: '999px',
                padding: '0.15rem 0.6rem',
              }}
            >
              {cls?.name ?? '?'} · {child.days_per_week}d/wk
            </span>
            {child.days_per_week < 5 && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {formatDays(child.days_of_week)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button style={btnSecondary} onClick={() => setEditing(true)}>Edit</button>
            <button style={btnDanger} onClick={handleDelete} disabled={isPending}>Remove</button>
          </div>
        </div>

        {error && <p style={{ fontSize: '0.78rem', color: 'var(--danger)', marginTop: '0.3rem' }}>{error}</p>}
      </div>
    )
  }

  return (
    <div
      style={{
        padding: '0.75rem',
        background: 'var(--cream)',
        borderRadius: '8px',
        margin: '0.4rem 0',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '0.6rem',
          marginBottom: '0.6rem',
        }}
      >
        <div>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Class</label>
          <select style={inputStyle} value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">Select class…</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Days / week</label>
          <select
            style={inputStyle}
            value={days}
            onChange={e => {
              const val = Number(e.target.value)
              setDays(val)
              if (val === 5) setDaysOfWeek([])
            }}
          >
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
          </select>
        </div>
      </div>

      {/* Day picker — only for < 5 days */}
      {days < 5 && (
        <div style={{ marginBottom: '0.6rem' }}>
          <DayPicker
            selected={daysOfWeek}
            onChange={setDaysOfWeek}
            daysPerWeek={days}
          />
        </div>
      )}

      {error && <div style={errorStyle}>{error}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
        <button style={btnPrimary} onClick={handleSave} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button style={btnSecondary} onClick={() => { setEditing(false); setError(null) }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Add child form ─────────────────────────────────────────────────────────────

function AddChildForm({ familyId, classes }: { familyId: string; classes: ClassRow[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [classId, setClassId] = useState('')
  const [days, setDays] = useState(3)
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  function handleAdd() {
    setError(null)
    startTransition(async () => {
      const result = await addChildToFamilyAction(familyId, {
        name,
        classId,
        daysPerWeek: days,
        daysOfWeek: days === 5 ? null : daysOfWeek,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setName('')
        setClassId('')
        setDays(3)
        setDaysOfWeek([])
        setOpen(false)
        router.refresh()
      }
    })
  }

  if (!open) {
    return (
      <button style={{ ...btnSecondary, marginTop: '0.75rem' }} onClick={() => setOpen(true)}>
        + Add child
      </button>
    )
  }

  return (
    <div
      style={{
        marginTop: '0.75rem',
        padding: '0.85rem',
        background: 'var(--cream)',
        border: '1px dashed var(--border)',
        borderRadius: '10px',
      }}
    >
      <p style={{ ...sectionHeadStyle, marginBottom: '0.65rem' }}>New child</p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '0.6rem',
          marginBottom: '0.6rem',
        }}
      >
        <div>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="First name" />
        </div>
        <div>
          <label style={labelStyle}>Class</label>
          <select style={inputStyle} value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">Select class…</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Days / week</label>
          <select
            style={inputStyle}
            value={days}
            onChange={e => {
              const val = Number(e.target.value)
              setDays(val)
              if (val === 5) setDaysOfWeek([])
            }}
          >
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
          </select>
        </div>
      </div>

      {/* Day picker — only for < 5 days */}
      {days < 5 && (
        <div style={{ marginBottom: '0.6rem' }}>
          <DayPicker
            selected={daysOfWeek}
            onChange={setDaysOfWeek}
            daysPerWeek={days}
          />
        </div>
      )}

      {error && <div style={errorStyle}>{error}</div>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button style={btnPrimary} onClick={handleAdd} disabled={isPending}>
          {isPending ? 'Adding…' : 'Add child'}
        </button>
        <button style={btnSecondary} onClick={() => { setOpen(false); setError(null) }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────

export function FamilyDetailForm({ family, childRecords, classes }: Props) {
  const pendingCount = childRecords.filter(c => c.days_change_status === 'pending').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* ── Section 1: Family info ───────────────────────────────────────── */}
      <section
        style={{
          background: 'var(--warm-white)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '1.25rem',
        }}
      >
        <FamilyInfoSection family={family} />
      </section>

      {/* ── Section 2: Children ─────────────────────────────────────────── */}
      <section
        style={{
          background: 'var(--warm-white)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
          <p style={{ ...sectionHeadStyle, margin: 0 }}>Children ({childRecords.length})</p>
          {pendingCount > 0 && (
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                background: 'var(--warning-light)',
                color: 'var(--warning)',
                border: '1px solid var(--warning)',
                borderRadius: '999px',
                padding: '0.1rem 0.5rem',
              }}
            >
              {pendingCount} pending
            </span>
          )}
        </div>

        {childRecords.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
            No children linked to this family yet.
          </p>
        ) : (
          <div>
            {childRecords.map(child => (
              <ChildCard
                key={child.id}
                child={child}
                familyId={family.id}
                classes={classes}
              />
            ))}
          </div>
        )}

        <AddChildForm familyId={family.id} classes={classes} />
      </section>
    </div>
  )
}
