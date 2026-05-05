import {
  errorResponse,
  jsonResponse,
  requireUser,
  type PagesContext,
} from '../../_shared/http'
import { hasCalendarConnection } from '../../_shared/calendar'

export async function onRequestGet({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const connected = await hasCalendarConnection(user.id, env)
    return jsonResponse({ connected })
  } catch (error) {
    return errorResponse(error)
  }
}
