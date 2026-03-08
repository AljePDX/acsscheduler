/**
 * Shared TypeScript types for the Bloom Co-op Scheduler.
 *
 * These types mirror the Supabase database schema exactly.
 * The Database type is used to give the Supabase client full type safety.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type UserRole = 'parent' | 'admin'

export type ShiftStatus =
  | 'proposed'
  | 'confirmed'
  | 'completed'
  | 'missed'
  | 'bought_out'

export type SwapStatus =
  | 'open'
  | 'pending_covering_approval'
  | 'pending_admin'
  | 'approved'
  | 'rejected'
  | 'cancelled'

export type MakeupDebtStatus =
  | 'outstanding'
  | 'pending_admin_review'
  | 'fulfilled'
  | 'bought_out'
  | 'forgiven'
  | 'rolled_over'

export type BuyoutStatus = 'pending' | 'approved' | 'rejected'

export type DropinStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

// ─── Row types (match DB columns exactly) ─────────────────────────────────────

export interface ClassRow {
  id: string
  name: string
  student_teacher_ratio: number
  created_at: string
}

export interface FamilyRow {
  id: string
  name: string
  email: string
  phone: string | null
  notes: string | null
  shift_override: number | null
  created_at: string
}

export interface ChildRow {
  id: string
  family_id: string
  class_id: string
  name: string
  days_per_week: number
  /** Specific days child attends. null = all 5 days (M–Fr). */
  days_of_week: string[] | null
  /** Days requested by parent, pending admin approval. null = no pending change. */
  days_change_pending: string[] | null
  /** 'pending' when a day-change request is awaiting admin approval, else null. */
  days_change_status: 'pending' | null
}

export interface UserRow {
  id: string
  family_id: string | null
  role: UserRole
  full_name: string
  email: string
}

export interface FamilyConflictRow {
  id: string
  family_a_id: string
  family_b_id: string
  reason: string | null
  created_at: string
}

export interface AvailabilityRow {
  id: string
  family_id: string
  period_month: string // ISO date string: first day of month
  available_dates: string[] // ISO date strings
  preferred_dates: string[] // always a subset of available_dates
  planned_absences: PlannedAbsence[]
  extra_shifts_willing: '0' | '1-2' | '3-4' | '5+'
  notes: string | null
  submitted_at: string
}

export type ExtraShiftsWilling = '0' | '1-2' | '3-4' | '5+'

/** Sort rank for extra shift willingness — higher = more willing. */
export const EXTRA_SHIFTS_RANK: Record<ExtraShiftsWilling, number> = {
  '5+': 4,
  '3-4': 3,
  '1-2': 2,
  '0':  1,
}

export interface PlannedAbsence {
  child_id: string
  date: string // ISO date string
}

export interface ShiftRow {
  id: string
  date: string // ISO date string
  class_id: string
  family_id: string | null
  status: ShiftStatus
  conflict_warning: boolean
  created_at: string
}

export interface HolidayRow {
  id: string
  date: string // ISO date string
  name: string
  created_at: string
}

export interface SwapRequestRow {
  id: string
  shift_id: string
  requesting_family_id: string
  covering_family_id: string | null
  reason: string | null
  status: SwapStatus
  admin_notes: string | null
  created_at: string
}

export interface MakeupDebtRow {
  id: string
  family_id: string
  swap_request_id: string
  debt_date: string // ISO date string
  due_month: string // ISO date string: first day of month
  fulfilling_shift_id: string | null
  status: MakeupDebtStatus
  resolved_at: string | null
  admin_notes: string | null
  created_at: string
}

export interface BuyoutRequestRow {
  id: string
  family_id: string
  shift_id: string | null
  makeup_debt_id: string | null
  amount: number
  status: BuyoutStatus
  admin_notes: string | null
  created_at: string
}

export interface DropinRequestRow {
  id: string
  family_id: string
  child_id: string
  class_id: string
  date: string // ISO date string
  fee: number
  status: DropinStatus
  admin_notes: string | null
  created_at: string
}

export interface SchoolSettingsRow {
  id: number // always 1
  school_year_start: string // ISO date string
  school_year_end: string // ISO date string
  buyout_amount_per_shift: number
  dropin_fee: number
  availability_deadline_day: number
  missed_shift_fee: number
  extra_shift_credit: number
}

export interface NotificationRow {
  id: string
  family_id: string
  title: string
  message: string
  type: string // 'swap' | 'makeup' | 'schedule' | 'dropin' | 'buyout' | 'reminder'
  link: string | null
  read: boolean
  created_at: string
}

// ─── Supabase Database type (used for typed client) ───────────────────────────

export type Database = {
  public: {
    Tables: {
      classes: {
        Row: ClassRow
        Insert: Omit<ClassRow, 'id' | 'created_at'>
        Update: Partial<Omit<ClassRow, 'id' | 'created_at'>>
      }
      families: {
        Row: FamilyRow
        Insert: Omit<FamilyRow, 'id' | 'created_at'>
        Update: Partial<Omit<FamilyRow, 'id' | 'created_at'>>
      }
      children: {
        Row: ChildRow
        Insert: Omit<ChildRow, 'id'>
        Update: Partial<Omit<ChildRow, 'id'>>
      }
      users: {
        Row: UserRow
        Insert: Omit<UserRow, 'id'>
        Update: Partial<Omit<UserRow, 'id'>>
      }
      family_conflicts: {
        Row: FamilyConflictRow
        Insert: Omit<FamilyConflictRow, 'id' | 'created_at'>
        Update: Partial<Omit<FamilyConflictRow, 'id' | 'created_at'>>
      }
      availability: {
        Row: AvailabilityRow
        Insert: Omit<AvailabilityRow, 'id' | 'submitted_at'>
        Update: Partial<Omit<AvailabilityRow, 'id' | 'submitted_at'>>
      }
      shifts: {
        Row: ShiftRow
        Insert: Omit<ShiftRow, 'id' | 'created_at'>
        Update: Partial<Omit<ShiftRow, 'id' | 'created_at'>>
      }
      holidays: {
        Row: HolidayRow
        Insert: Omit<HolidayRow, 'id' | 'created_at'>
        Update: Partial<Omit<HolidayRow, 'id' | 'created_at'>>
      }
      swap_requests: {
        Row: SwapRequestRow
        Insert: Omit<SwapRequestRow, 'id' | 'created_at'>
        Update: Partial<Omit<SwapRequestRow, 'id' | 'created_at'>>
      }
      makeup_debts: {
        Row: MakeupDebtRow
        Insert: Omit<MakeupDebtRow, 'id' | 'created_at'>
        Update: Partial<Omit<MakeupDebtRow, 'id' | 'created_at'>>
      }
      buyout_requests: {
        Row: BuyoutRequestRow
        Insert: Omit<BuyoutRequestRow, 'id' | 'created_at'>
        Update: Partial<Omit<BuyoutRequestRow, 'id' | 'created_at'>>
      }
      dropin_requests: {
        Row: DropinRequestRow
        Insert: Omit<DropinRequestRow, 'id' | 'created_at'>
        Update: Partial<Omit<DropinRequestRow, 'id' | 'created_at'>>
      }
      school_settings: {
        Row: SchoolSettingsRow
        Insert: Omit<SchoolSettingsRow, 'id'>
        Update: Partial<Omit<SchoolSettingsRow, 'id'>>
      }
      notifications: {
        Row: NotificationRow
        Insert: Omit<NotificationRow, 'id' | 'created_at'>
        Update: Partial<Omit<NotificationRow, 'id' | 'created_at'>>
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// ─── Convenience joined types (used in UI) ────────────────────────────────────

/** Child row with its class details joined */
export interface ChildWithClass extends ChildRow {
  classes: ClassRow
}

/** Family with all children (and their classes) */
export interface FamilyWithChildren extends FamilyRow {
  children: ChildWithClass[]
}

/** Shift with class and family details joined */
export interface ShiftWithDetails extends ShiftRow {
  classes: ClassRow
  families: FamilyRow
}

/** Swap request with all related rows joined */
export interface SwapRequestWithDetails extends SwapRequestRow {
  shifts: ShiftWithDetails
  requesting_family: FamilyRow
  covering_family: FamilyRow | null
}

/** Makeup debt with swap and family details */
export interface MakeupDebtWithDetails extends MakeupDebtRow {
  families: FamilyRow
  swap_requests: SwapRequestWithDetails
  fulfilling_shift: ShiftWithDetails | null
}
