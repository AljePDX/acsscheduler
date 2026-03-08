// lib/availability-utils.ts

export interface AvailabilitySnapshot {
  availableDates: string[]
  absences: { child_id: string; date: string }[]
}

export interface AvailabilityDiff {
  addedDates: string[]
  removedDates: string[]
  addedAbsences: number
  removedAbsences: number
  isEmpty: boolean
}

export function computeAvailabilityDiff(
  before: AvailabilitySnapshot,
  after: AvailabilitySnapshot
): AvailabilityDiff {
  const beforeDates = new Set(before.availableDates)
  const afterDates = new Set(after.availableDates)

  const addedDates = after.availableDates.filter(d => !beforeDates.has(d))
  const removedDates = before.availableDates.filter(d => !afterDates.has(d))

  const beforeAbsKeys = new Set(before.absences.map(a => `${a.child_id}:${a.date}`))
  const afterAbsKeys = new Set(after.absences.map(a => `${a.child_id}:${a.date}`))

  const addedAbsences = after.absences.filter(a => !beforeAbsKeys.has(`${a.child_id}:${a.date}`)).length
  const removedAbsences = before.absences.filter(a => !afterAbsKeys.has(`${a.child_id}:${a.date}`)).length

  const isEmpty =
    addedDates.length === 0 &&
    removedDates.length === 0 &&
    addedAbsences === 0 &&
    removedAbsences === 0

  return { addedDates, removedDates, addedAbsences, removedAbsences, isEmpty }
}

/** Human-readable summary for the admin notification body */
export function diffSummary(diff: AvailabilityDiff): string {
  const parts: string[] = []
  if (diff.addedDates.length > 0)
    parts.push(`${diff.addedDates.length} date${diff.addedDates.length !== 1 ? 's' : ''} added`)
  if (diff.removedDates.length > 0)
    parts.push(`${diff.removedDates.length} date${diff.removedDates.length !== 1 ? 's' : ''} removed`)
  if (diff.addedAbsences > 0)
    parts.push(`${diff.addedAbsences} absence${diff.addedAbsences !== 1 ? 's' : ''} added`)
  if (diff.removedAbsences > 0)
    parts.push(`${diff.removedAbsences} absence${diff.removedAbsences !== 1 ? 's' : ''} removed`)
  return parts.join(', ')
}
