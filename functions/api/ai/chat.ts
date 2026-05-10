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
import { retrieveAssistantRag } from '../../_shared/rag'

interface ChatBody {
  contents: GeminiContent[]
  clientDate?: string
}

function extractLatestUserText(contents: GeminiContent[]) {
  for (let index = contents.length - 1; index >= 0; index -= 1) {
    const content = contents[index]
    if (content.role !== 'user') continue
    const text = content.parts
      .map((part) => part.text)
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

export async function onRequestPost({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const body = await readJsonBody<ChatBody>(request)

    const today = typeof body.clientDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.clientDate)
      ? body.clientDate
      : new Date().toISOString().slice(0, 10)
    const rag = await retrieveAssistantRag({
      env,
      query: extractLatestUserText(body.contents),
      userId: user.id,
    })

    const systemInstruction = [
      DASHBOARD_AGENT_SYSTEM_PROMPT,
      `用户本地今天是 ${today}。处理"今天/明天/本周"等时间表达时以此为准。`,
      rag.ragContext ? `可参考的 RAG 上下文：\n${rag.ragContext}` : '',
    ].filter(Boolean).join('\n\n')

    const result = await generateGeminiContent({
      contents: body.contents,
      env,
      systemInstruction,
      tools: [{ functionDeclarations: DASHBOARD_TOOL_DECLARATIONS }],
    })

    return jsonResponse({ ...result, rag_sources: rag.ragSources })
  } catch (error) {
    return errorResponse(error)
  }
}
