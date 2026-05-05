import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireUser,
  type PagesContext,
} from '../../_shared/http'
import { saveCalendarConnection } from '../../_shared/calendar'

interface ConnectBody {
  providerToken?: string
  providerRefreshToken?: string | null
  expiresIn?: number
  scope?: string | null
  tokenType?: string | null
}

export async function onRequestPost({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const body = await readJsonBody<ConnectBody>(request)
    if (!body.providerToken) {
      return jsonResponse({ error: 'Missing Google provider token' }, 400)
    }

    await saveCalendarConnection({
      accessToken: body.providerToken,
      env,
      expiresIn: body.expiresIn,
      refreshToken: body.providerRefreshToken,
      scope: body.scope,
      tokenType: body.tokenType,
      userId: user.id,
    })

    return jsonResponse({ connected: true })
  } catch (error) {
    return errorResponse(error)
  }
}
