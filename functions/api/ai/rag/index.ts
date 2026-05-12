import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireUser,
  type PagesContext,
} from '../../../_shared/http'
import {
  ASSISTANT_RAG_SOURCE_TYPES,
  indexAssistantRag,
  type AssistantRagSourceType,
} from '../../../_shared/rag'

interface RagIndexBody {
  limit?: unknown
  sourceTypes?: unknown
}

function normalizeSourceTypes(value: unknown): AssistantRagSourceType[] {
  if (!Array.isArray(value)) return [...ASSISTANT_RAG_SOURCE_TYPES]
  const allowed = new Set(ASSISTANT_RAG_SOURCE_TYPES)
  const selected = value.filter((item): item is AssistantRagSourceType =>
    typeof item === 'string' && allowed.has(item as AssistantRagSourceType)
  )
  return selected.length > 0 ? selected : [...ASSISTANT_RAG_SOURCE_TYPES]
}

function normalizeLimit(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(40, Math.round(value)))
    : 40
}

export async function onRequestPost({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const body = await readJsonBody<RagIndexBody>(request)
    const result = await indexAssistantRag({
      accessToken: user.accessToken,
      env,
      limit: normalizeLimit(body.limit),
      sourceTypes: normalizeSourceTypes(body.sourceTypes),
      userId: user.id,
    })
    return jsonResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
