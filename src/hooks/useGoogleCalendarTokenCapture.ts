import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { saveCalendarConnectionFromSession } from '@/lib/ai/api'
import { supabase, type Session } from '@/lib/supabase'

interface OAuthSession extends Session {
  provider_token?: string | null
}

export function useGoogleCalendarTokenCapture() {
  const lastTokenRef = useRef<string | null>(null)

  useEffect(() => {
    if (!supabase) return

    async function persistProviderToken(session: Session | null) {
      const oauthSession = session as OAuthSession | null
      const token = oauthSession?.provider_token ?? null
      if (!token || token === lastTokenRef.current) return

      lastTokenRef.current = token
      try {
        const saved = await saveCalendarConnectionFromSession(session)
        if (saved) toast.success('Google Calendar 已连接')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Google Calendar 连接失败'
        toast.error(message)
      }
    }

    void supabase.auth.getSession().then(({ data }) => persistProviderToken(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void persistProviderToken(session)
    })

    return () => data.subscription.unsubscribe()
  }, [])
}
