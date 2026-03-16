'use server'

/**
 * Server actions for /admin/families/[id]
 *
 * All actions require admin role. Scoped to the specific familyId passed in,
 * which is verified server-side against the DB (not trusted from client).
 *
 * Uses `(supabase.from(...) as any)` for inserts — generated Insert types
 * resolve to `never` until Supabase types are regenerated.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .returns<{ role: string }[]>()
    .maybeSingle()
  if (userRow?.role !== 'admin') redirect('/parent/dashboard')
  return supabase
}

// ── Update family fields ───────────────────────────────────────────────────────

export interface UpdateFamilyInput {
  name: string
  email: string
  phone: string
  notes: string
  shift_override: string // empty string = null
  is_flexible_teacher: boolean
  is_assistant_teacher: boolean
}

export async function updateFamilyAction(
  familyId: string,
  input: UpdateFamilyInput
): Promise<{ error?: string }> {
  if (!input.name.trim()) return { error: 'Family name is required.' }
  if (!input.email.trim()) return { error: 'Email is required.' }

  let supabase: Awaited<ReturnType<typeof requireAdmin>>
  try {
    supabase = await requireAdmin()
  } catch {
    return { error: 'Not authenticated or not authorised.' }
  }

  const overrideRaw = input.shift_override.trim()
  const shift_override =
    overrideRaw === '' ? null : Math.max(0, parseInt(overrideRaw, 10) || 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('families') as any)
    .update({
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim() || null,
      notes: input.notes.trim() || null,
      shift_override,
      is_flexible_teacher: input.is_flexible_teacher,
      is_assistant_teacher: input.is_assistant_teacher,
    })
    .eq('id', familyId)

  if (error) return { error: error.message }
  revalidatePath('/admin/families')
  revalidatePath(`/admin/families/${familyId}`)
  return {}
}

// ── Add child ─────────────────────────────────────────────────────────────────

export interface ChildInput {
  name: string
  classId: string
  daysPerWeek: number
  daysOfWeek: string[] | null
}

export async function addChildToFamilyAction(
  familyId: string,
  input: ChildInput
): Promise<{ error?: string }> {
  const trimmed = input.name.trim()
  if (!trimmed) return { error: 'Child name is required.' }
  if (!input.classId) return { error: 'Please select a class.' }
  if (input.daysPerWeek < 3 || input.daysPerWeek > 5)
    return { error: 'Days per week must be 3, 4, or 5.' }

  let supabase: Awaited<ReturnType<typeof requireAdmin>>
  try {
    supabase = await requireAdmin()
  } catch {
    return { error: 'Not authenticated or not authorised.' }
  }

  const daysOfWeek = input.daysPerWeek === 5 ? null : input.daysOfWeek

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('children') as any).insert({
    family_id: familyId,
    name: trimmed,
    class_id: input.classId,
    days_per_week: input.daysPerWeek,
    days_of_week: daysOfWeek,
  })

  if (error) return { error: (error as { message: string }).message }
  revalidatePath('/admin/families')
  revalidatePath(`/admin/families/${familyId}`)
  return {}
}

// ── Update child ──────────────────────────────────────────────────────────────

export async function updateChildForFamilyAction(
  childId: string,
  familyId: string,
  input: ChildInput
): Promise<{ error?: string }> {
  const trimmed = input.name.trim()
  if (!trimmed) return { error: 'Child name is required.' }
  if (!input.classId) return { error: 'Please select a class.' }
  if (input.daysPerWeek < 3 || input.daysPerWeek > 5)
    return { error: 'Days per week must be 3, 4, or 5.' }

  let supabase: Awaited<ReturnType<typeof requireAdmin>>
  try {
    supabase = await requireAdmin()
  } catch {
    return { error: 'Not authenticated or not authorised.' }
  }

  const daysOfWeek = input.daysPerWeek === 5 ? null : input.daysOfWeek

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('children') as any)
    .update({
      name: trimmed,
      class_id: input.classId,
      days_per_week: input.daysPerWeek,
      days_of_week: daysOfWeek,
    })
    .eq('id', childId)
    .eq('family_id', familyId)

  if (error) return { error: error.message }
  revalidatePath('/admin/families')
  revalidatePath(`/admin/families/${familyId}`)
  return {}
}

// ── Delete child ──────────────────────────────────────────────────────────────

export async function deleteChildFromFamilyAction(
  childId: string,
  familyId: string
): Promise<{ error?: string }> {
  let supabase: Awaited<ReturnType<typeof requireAdmin>>
  try {
    supabase = await requireAdmin()
  } catch {
    return { error: 'Not authenticated or not authorised.' }
  }

  const { error } = await supabase
    .from('children')
    .delete()
    .eq('id', childId)
    .eq('family_id', familyId)

  if (error) return { error: error.message }
  revalidatePath('/admin/families')
  revalidatePath(`/admin/families/${familyId}`)
  return {}
}

// ── Approve pending day-of-week change ────────────────────────────────────────

export async function approveDayChangeAction(
  childId: string,
  familyId: string
): Promise<{ error?: string }> {
  let supabase: Awaited<ReturnType<typeof requireAdmin>>
  try {
    supabase = await requireAdmin()
  } catch {
    return { error: 'Not authenticated or not authorised.' }
  }

  // Fetch the pending days first
  const { data: child, error: fetchErr } = await supabase
    .from('children')
    .select('days_change_pending')
    .eq('id', childId)
    .eq('family_id', familyId)
    .returns<{ days_change_pending: string[] | null }[]>()
    .maybeSingle()

  if (fetchErr || !child) return { error: 'Child not found.' }
  if (!child.days_change_pending) return { error: 'No pending change to approve.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('children') as any)
    .update({
      days_of_week: child.days_change_pending,
      days_change_pending: null,
      days_change_status: null,
    })
    .eq('id', childId)
    .eq('family_id', familyId)

  if (error) return { error: error.message }
  revalidatePath('/admin/families')
  revalidatePath(`/admin/families/${familyId}`)
  return {}
}

// ── Reject pending day-of-week change ─────────────────────────────────────────

export async function rejectDayChangeAction(
  childId: string,
  familyId: string
): Promise<{ error?: string }> {
  let supabase: Awaited<ReturnType<typeof requireAdmin>>
  try {
    supabase = await requireAdmin()
  } catch {
    return { error: 'Not authenticated or not authorised.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('children') as any)
    .update({ days_change_pending: null, days_change_status: null })
    .eq('id', childId)
    .eq('family_id', familyId)

  if (error) return { error: error.message }
  revalidatePath('/admin/families')
  revalidatePath(`/admin/families/${familyId}`)
  return {}
}
