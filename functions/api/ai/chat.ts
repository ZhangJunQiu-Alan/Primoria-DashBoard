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
  type GeminiContent,
} from '../../_shared/gemini'
import {
  buildAgentSystemInstruction,
  extractLatestUserText,
  getAgentPromptForRoute,
  policyGuardTrace,
  routeAssistantRequest,
  runGeminiAgent,
  runRagRetriever,
  type AssistantAgentRole,
} from '../../_shared/agents'

interface ChatBody {
  contents: GeminiContent[]
  clientDate?: string
}

function getSpecialistRole(
  intent: 'dashboard_operation' | 'memory_question' | 'memory_write' | 'general_answer'
): AssistantAgentRole {
  if (intent === 'memory_question') return 'memory_agent'
  if (intent === 'general_answer') return 'orchestrator'
  return 'dashboard_operator'
}

export async function onRequestPost({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const body = await readJsonBody<ChatBody>(request)

    const today = typeof body.clientDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.clientDate)
      ? body.clientDate
      : new Date().toISOString().slice(0, 10)
    const latestUserText = extractLatestUserText(body.contents)
    const [routed, rag] = await Promise.all([
      routeAssistantRequest({
        contents: body.contents,
        env,
        latestUserText,
      }),
      runRagRetriever({
        env,
        query: latestUserText,
        userId: user.id,
      }),
    ])
    const specialistRole = getSpecialistRole(routed.decision.intent)
    const toolsAllowed = specialistRole === 'dashboard_operator'
    const basePrompt = getAgentPromptForRoute(routed.decision.intent) ?? DASHBOARD_AGENT_SYSTEM_PROMPT
    const systemInstruction = buildAgentSystemInstruction({
      base: basePrompt,
      ragContext: rag.ragContext,
      role: specialistRole,
      today,
    })
    const specialist = await runGeminiAgent({
      contents: body.contents,
      env,
      role: specialistRole,
      systemInstruction,
      ...(toolsAllowed ? { tools: [{ functionDeclarations: DASHBOARD_TOOL_DECLARATIONS }] } : {}),
    })
    const agentTrace = [
      routed.trace,
      ...rag.agent_trace,
      policyGuardTrace({ allowedTools: toolsAllowed, role: specialistRole }),
      ...specialist.agent_trace,
    ]

    return jsonResponse({
      ...specialist.result,
      agent_trace: agentTrace,
      rag_sources: rag.ragSources,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
