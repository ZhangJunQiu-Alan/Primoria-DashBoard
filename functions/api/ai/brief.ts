import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireUser,
  type PagesContext,
} from '../../_shared/http'
import {
  DAILY_BRIEF_SYSTEM_PROMPT,
  generateGeminiContent,
} from '../../_shared/gemini'

interface BriefBody {
  context: unknown
  date: string
}

function parseBriefText(text: string) {
  try {
    const parsed = JSON.parse(text) as { summary?: unknown; recommendation?: unknown }
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '今天的信息还不多，先从最明确的一项开始。',
      recommendation: typeof parsed.recommendation === 'string' ? parsed.recommendation : '先完成一个最小任务，给今天建立节奏。',
    }
  } catch {
    return {
      summary: text || '今天的信息还不多，先从最明确的一项开始。',
      recommendation: '先完成一个最小任务，给今天建立节奏。',
    }
  }
}

export async function onRequestPost({ env, request }: PagesContext) {
  try {
    await requireUser(request, env)
    const body = await readJsonBody<BriefBody>(request)

    const result = await generateGeminiContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                date: body.date,
                context: body.context,
              }),
            },
          ],
        },
      ],
      env,
      systemInstruction: DAILY_BRIEF_SYSTEM_PROMPT,
    })

    return jsonResponse(parseBriefText(result.text))
  } catch (error) {
    return errorResponse(error)
  }
}
