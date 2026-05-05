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
  clientDate?: string
}

export async function onRequestPost({ env, request }: PagesContext) {
  try {
    await requireUser(request, env)
    const body = await readJsonBody<ChatBody>(request)

    const today = typeof body.clientDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.clientDate)
      ? body.clientDate
      : new Date().toISOString().slice(0, 10)

    const systemInstruction = `${DASHBOARD_AGENT_SYSTEM_PROMPT}\n\n用户本地今天是 ${today}。处理"今天/明天/本周"等时间表达时以此为准。`

    const result = await generateGeminiContent({
      contents: body.contents,
      env,
      systemInstruction,
      tools: [{ functionDeclarations: DASHBOARD_TOOL_DECLARATIONS }],
    })

    return jsonResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
