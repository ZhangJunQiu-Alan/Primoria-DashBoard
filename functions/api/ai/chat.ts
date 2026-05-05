import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireUser,
  type PagesContext,
} from '../../_shared/http'
import {
  DASHBOARD_AGENT_SYSTEM_PROMPT,
  DASHBOARD_TOOL_DECLARATIONS,
  generateGeminiContent,
  type GeminiContent,
} from '../../_shared/gemini'

interface ChatBody {
  contents: GeminiContent[]
}

export async function onRequestPost({ env, request }: PagesContext) {
  try {
    await requireUser(request, env)
    const body = await readJsonBody<ChatBody>(request)

    const result = await generateGeminiContent({
      contents: body.contents,
      env,
      systemInstruction: DASHBOARD_AGENT_SYSTEM_PROMPT,
      tools: [{ functionDeclarations: DASHBOARD_TOOL_DECLARATIONS }],
    })

    return jsonResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
