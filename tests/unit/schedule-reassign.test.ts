import { describe, it, expect } from 'vitest'
import { computeConflictWarning } from '@/lib/schedule-utils'

describe('computeConflictWarning', () => {
  it('returns true when new family conflicts with a family on the same date', () => {
    const conflictPairs = [{ family_a_id: 'fam-a', family_b_id: 'fam-b' }]
    const otherFamiliesOnDate = ['fam-b']
    expect(computeConflictWarning('fam-a', otherFamiliesOnDate, conflictPairs)).toBe(true)
  })

  it('returns false when new family has no conflicts on the date', () => {
    const conflictPairs = [{ family_a_id: 'fam-a', family_b_id: 'fam-b' }]
    const otherFamiliesOnDate = ['fam-c']
    expect(computeConflictWarning('fam-a', otherFamiliesOnDate, conflictPairs)).toBe(false)
  })

  it('returns false when conflict list is empty', () => {
    expect(computeConflictWarning('fam-a', ['fam-b'], [])).toBe(false)
  })
})
