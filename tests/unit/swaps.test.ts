import { describe, it, expect } from 'vitest'
import { EXTRA_SHIFTS_RANK } from '@/lib/types'

// ── Sort helper (mirrors logic in SwapDetailClient) ───────────────────────────

const WILLINGNESS_RANK: Record<string, number> = { '5+': 4, '3-4': 3, '1-2': 2, '0': 1 }

function sortEligibleFamilies(families: Array<{
  id: string
  name: string
  extra_shifts_willing: string
}>) {
  return [...families].sort((a, b) => {
    const ra = a.extra_shifts_willing !== '0'
      ? (WILLINGNESS_RANK[a.extra_shifts_willing] ?? 0) + 10
      : 0
    const rb = b.extra_shifts_willing !== '0'
      ? (WILLINGNESS_RANK[b.extra_shifts_willing] ?? 0) + 10
      : 0
    if (ra !== rb) return rb - ra
    return a.name.localeCompare(b.name)
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EXTRA_SHIFTS_RANK', () => {
  it('has the correct rank values', () => {
    expect(EXTRA_SHIFTS_RANK['5+']).toBe(4)
    expect(EXTRA_SHIFTS_RANK['3-4']).toBe(3)
    expect(EXTRA_SHIFTS_RANK['1-2']).toBe(2)
    expect(EXTRA_SHIFTS_RANK['0']).toBe(1)
  })
})

describe('sortEligibleFamilies', () => {
  it('puts willing families before required-only families', () => {
    const families = [
      { id: '1', name: 'Adams', extra_shifts_willing: '0' },
      { id: '2', name: 'Brown', extra_shifts_willing: '1-2' },
    ]
    const sorted = sortEligibleFamilies(families)
    expect(sorted[0].id).toBe('2') // Brown is willing
    expect(sorted[1].id).toBe('1') // Adams is required only
  })

  it('sorts within willing group by willingness level descending', () => {
    const families = [
      { id: '1', name: 'Adams', extra_shifts_willing: '1-2' },
      { id: '2', name: 'Brown', extra_shifts_willing: '5+' },
      { id: '3', name: 'Clark', extra_shifts_willing: '3-4' },
    ]
    const sorted = sortEligibleFamilies(families)
    expect(sorted.map(f => f.id)).toEqual(['2', '3', '1'])
  })

  it('sorts alphabetically within the same willingness level', () => {
    const families = [
      { id: '1', name: 'Zorn', extra_shifts_willing: '1-2' },
      { id: '2', name: 'Adams', extra_shifts_willing: '1-2' },
    ]
    const sorted = sortEligibleFamilies(families)
    expect(sorted[0].name).toBe('Adams')
    expect(sorted[1].name).toBe('Zorn')
  })

  it('sorts required-only families alphabetically among themselves', () => {
    const families = [
      { id: '1', name: 'Zorn',   extra_shifts_willing: '0' },
      { id: '2', name: 'Adams',  extra_shifts_willing: '0' },
      { id: '3', name: 'Miller', extra_shifts_willing: '0' },
    ]
    const sorted = sortEligibleFamilies(families)
    expect(sorted.map(f => f.name)).toEqual(['Adams', 'Miller', 'Zorn'])
  })

  it('returns empty array unchanged', () => {
    expect(sortEligibleFamilies([])).toEqual([])
  })

  it('handles a single family', () => {
    const families = [{ id: '1', name: 'Smith', extra_shifts_willing: '3-4' }]
    expect(sortEligibleFamilies(families)).toHaveLength(1)
    expect(sortEligibleFamilies(families)[0].id).toBe('1')
  })
})
