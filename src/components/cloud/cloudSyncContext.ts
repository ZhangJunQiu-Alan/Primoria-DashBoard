import { createContext, useContext } from 'react'
import type { User } from '@/lib/supabase'

export type SyncStatus = 'local' | 'checking' | 'ready' | 'syncing' | 'error'

export interface CloudSyncContextValue {
  configured: boolean
  user: User | null
  status: SyncStatus
  message: string | null
  updatedAt: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  pushNow: () => Promise<void>
}

export const CloudSyncContext = createContext<CloudSyncContextValue | null>(null)

export function useCloudSync() {
  const context = useContext(CloudSyncContext)
  if (!context) throw new Error('useCloudSync must be used inside CloudSyncProvider')
  return context
}
