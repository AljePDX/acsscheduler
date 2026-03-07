// lib/schedule-utils.ts
// Pure helper functions for schedule operations.

export interface ConflictPair {
  family_a_id: string
  family_b_id: string
}

/**
 * Returns true if `familyId` has a known conflict with any family in `otherFamilyIds`.
 */
export function computeConflictWarning(
  familyId: string,
  otherFamilyIds: string[],
  conflictPairs: ConflictPair[]
): boolean {
  const others = new Set(otherFamilyIds)
  return conflictPairs.some(
    p =>
      (p.family_a_id === familyId && others.has(p.family_b_id)) ||
      (p.family_b_id === familyId && others.has(p.family_a_id))
  )
}
