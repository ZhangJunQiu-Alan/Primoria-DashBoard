import { createClient, type Session, type User } from '@supabase/supabase-js'
import type { DashboardSnapshotData, WidgetDataSnapshot } from '@/lib/cloudSnapshots'

export type { Session, User }

export interface DashboardSnapshotRow {
  user_id: string
  dashboard_state: DashboardSnapshotData | null
  widget_data: WidgetDataSnapshot | null
  background_path: string | null
  updated_at: string
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null

export const DASHBOARD_ASSETS_BUCKET = 'dashboard-assets'
