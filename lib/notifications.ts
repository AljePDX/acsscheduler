/**
 * In-app notification helpers.
 *
 * All functions are non-throwing — notification failures are logged but
 * never bubble up to callers. Email / notification should never break
 * the action that triggered them.
 *
 * Notifications schema:
 *   { id, family_id, title, message, type, link, read, created_at }
 *
 * Type values: 'schedule' | 'swap' | 'makeup' | 'dropin' | 'buyout' | 'reminder'
 */

import type { createClient } from './supabase/server'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export interface NotificationPayload {
  title: string
  message: string
  type: 'schedule' | 'swap' | 'makeup' | 'dropin' | 'buyout' | 'reminder' | 'availability'
  link?: string
}

/**
 * Creates an in-app notification for a single family.
 */
export async function notifyFamily(
  supabase: SupabaseClient,
  familyId: string,
  payload: NotificationPayload
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('notifications') as any).insert({
      family_id: familyId,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      link: payload.link ?? null,
      read: false,
    })
  } catch (err) {
    console.error('[notifyFamily] Failed to create notification:', err)
  }
}

/**
 * Bulk-creates in-app notifications for multiple families in a single INSERT.
 * Used for schedule publication and other broadcast events.
 */
export async function notifyFamilies(
  supabase: SupabaseClient,
  familyIds: string[],
  payload: NotificationPayload
): Promise<void> {
  if (familyIds.length === 0) return
  try {
    const rows = familyIds.map(id => ({
      family_id: id,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      link: payload.link ?? null,
      read: false,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('notifications') as any).insert(rows)
  } catch (err) {
    console.error('[notifyFamilies] Failed to create bulk notifications:', err)
  }
}

/**
 * Creates in-app notifications for all admin users that have a family_id.
 * Used when admins need to take action (swap pending, drop-in submitted, etc.).
 *
 * Note: admin users without a family_id will not receive in-app notifications
 * but will still receive emails if sendEmail is called separately.
 */
export async function notifyAdmins(
  supabase: SupabaseClient,
  payload: NotificationPayload
): Promise<void> {
  try {
    const { data: adminUsers } = await supabase
      .from('users')
      .select('family_id')
      .eq('role', 'admin')
      .not('family_id', 'is', null)
      .returns<{ family_id: string }[]>()

    if (!adminUsers || adminUsers.length === 0) return

    const rows = adminUsers
      .filter(u => u.family_id)
      .map(u => ({
        family_id: u.family_id,
        title: payload.title,
        message: payload.message,
        type: payload.type,
        link: payload.link ?? null,
        read: false,
      }))

    if (rows.length === 0) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('notifications') as any).insert(rows)
  } catch (err) {
    console.error('[notifyAdmins] Failed to create admin notifications:', err)
  }
}
