import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireUser,
  type PagesContext,
} from '../../_shared/http'
import {
  DAILY_BRIEF_SYSTEM_PROMPT,
} from '../../_shared/gemini'
import {
  buildAgentSystemInstruction,
  policyGuardTrace,
  runGeminiAgent,
  runRagRetriever,
} from '../../_shared/agents'

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
    const user = await requireUser(request, env)
    const body = await readJsonBody<BriefBody>(request)
    const rag = await runRagRetriever({
      accessToken: user.accessToken,
      env,
      query: JSON.stringify({
        context: body.context,
        date: body.date,
        intent: 'daily_brief',
      }),
      userId: user.id,
    })

    const briefing = await runGeminiAgent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                date: body.date,
                context: body.context,
                rag_context: rag.ragContext ? JSON.parse(rag.ragContext) : null,
              }),
            },
          ],
        },
      ],
      env,
      role: 'briefing_agent',
      systemInstruction: buildAgentSystemInstruction({
        base: `${DAILY_BRIEF_SYSTEM_PROMPT}\n\n如果提供了 rag_context，只把它作为辅助背景，不要把来源列表写进 JSON 字段。`,
        ragContext: '',
        role: 'briefing_agent',
      }),
    })

    return jsonResponse({
      ...parseBriefText(briefing.result.text),
      agent_trace: [
        ...rag.agent_trace,
        policyGuardTrace({ allowedTools: false, role: 'briefing_agent' }),
        ...briefing.agent_trace,
      ],
      rag_sources: rag.ragSources,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
