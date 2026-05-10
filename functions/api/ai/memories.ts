import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireUser,
  type PagesContext,
} from '../../_shared/http'
import {
  createAssistantMemory,
  deleteAssistantMemory,
  readAssistantMemories,
  updateAssistantMemory,
} from '../../_shared/memory'
import { indexAssistantRag } from '../../_shared/rag'

interface UpdateMemoryBody {
  body?: unknown
  id?: unknown
  memory_type?: unknown
  scope?: unknown
  title?: unknown
}

interface CreateMemoryBody {
  body?: unknown
  confidence?: unknown
  memory_type?: unknown
  scope?: unknown
  title?: unknown
}

async function safeIndexMemories({ env, userId }: { env: PagesContext['env']; userId: string }) {
  try {
    await indexAssistantRag({ env, sourceTypes: ['assistant_memory'], userId })
  } catch {
    return
  }
}

export async function onRequestGet({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const memories = await readAssistantMemories({ env, userId: user.id })
    return jsonResponse({ memories })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function onRequestPost({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const body = await readJsonBody<CreateMemoryBody>(request)
    const memory = await createAssistantMemory({ env, input: body, userId: user.id })
    await safeIndexMemories({ env, userId: user.id })
    return jsonResponse({ memory })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function onRequestPatch({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const body = await readJsonBody<UpdateMemoryBody>(request)
    const memory = await updateAssistantMemory({ env, input: body, userId: user.id })
    await safeIndexMemories({ env, userId: user.id })
    return jsonResponse({ memory })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function onRequestDelete({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const url = new URL(request.url)
    const result = await deleteAssistantMemory({
      env,
      id: url.searchParams.get('id'),
      userId: user.id,
    })
    await safeIndexMemories({ env, userId: user.id })
    return jsonResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
