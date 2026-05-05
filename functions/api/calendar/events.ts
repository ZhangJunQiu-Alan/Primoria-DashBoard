import {
  errorResponse,
  HttpError,
  jsonResponse,
  requireUser,
  type PagesContext,
} from '../../_shared/http'
import { fetchGoogleCalendarEvents } from '../../_shared/calendar'

export async function onRequestGet({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const url = new URL(request.url)
    const timeMin = url.searchParams.get('timeMin')
    const timeMax = url.searchParams.get('timeMax')

    if (!timeMin || !timeMax) {
      throw new HttpError(400, 'timeMin and timeMax are required')
    }

    const events = await fetchGoogleCalendarEvents({
      env,
      timeMax,
      timeMin,
      userId: user.id,
    })

    return jsonResponse({ connected: true, events })
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return jsonResponse({ connected: false, events: [] })
    }
    return errorResponse(error)
  }
}
