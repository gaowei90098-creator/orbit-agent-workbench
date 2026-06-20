import {
  contractPromptBlock,
  createPlanArtifact,
  parsePlanArtifact,
  PlanArtifact,
  TaskContract
} from './plan-artifact'
import { EXECUTION_WORKER_AGENT_IDS } from './agents'

/* ============================================================
   编排模式（Orchestrator）— 纯函数 helper
   lead agent 把请求分解为子任务 → 各 agent 执行 → lead 汇总。
   这里只放可单测的纯逻辑（提示词构造 + 计划解析）；编排控制流在 dispatcher.runOrchestrate。
   ============================================================ */

export type PlanSubtask = TaskContract

export interface OrchestratePlan {
  subtasks: PlanSubtask[]
  artifact?: PlanArtifact
}

const KNOWN_AGENTS = EXECUTION_WORKER_AGENT_IDS

/** lead 分解/汇总时的系统提示 */
export const ORCHESTRATOR_LEAD_SYSTEM =
  'You are Orbit, the lead orchestrator agent. You break a user request into a small set of concrete, ' +
  'independent subtasks that specialist agents can each handle, then synthesize their outputs into one answer. ' +
  'Be concise and practical.'

/** 让 lead 输出 JSON 计划的用户消息 */
export function decompositionPrompt(userText: string, agents: string[] = KNOWN_AGENTS, episodicContext = ''): string {
  return [
    'You are Orbit, the main orchestrator. Break the following task/project goal into 2-5 concrete subtasks that specialist agents can work on independently.',
    'Available agents: ' + agents.join(', ') + '.',
    episodicContext ? 'Use this project memory before planning:\n' + episodicContext : '',
    'Keep task granularity aligned: every worker must receive a bounded contract, not a vague chat request.',
    'Reply with ONLY a JSON object (no prose, no markdown fences) of the form:',
    '{"goal":"original goal","taskDag":{"nodes":[{"id":"1","title":"short title","detail":"what to do","agent":"<one of the agents, or omit>","fileScope":["relative/path/**"],"dependsOn":[],"doneWhen":"observable acceptance criteria","verifyCommand":"npm test or empty","interfaceRef":"API/design contract touched, or empty"}]}}',
    'Legacy {"subtasks":[...]} is accepted, but taskDag.nodes is preferred.',
    'Rules:',
    '- Prefer parallel subtasks only when their fileScope and outputs do not collide.',
    '- Use dependsOn when a task cannot safely start before another task finishes.',
    '- Put shared API, data shape, UI contract, or naming decisions in interfaceRef.',
    '- Put the smallest useful verification command in verifyCommand; leave empty only when no command is known.',
    '- The plan should help workers coordinate without sharing full private histories.',
    '',
    'TASK:',
    userText
  ].join('\n')
}

/** 从 lead 输出中稳健解析计划：剥离 ``` 代码围栏、截取首个 {…}、校验 subtasks。失败返回 null。 */
export function parsePlan(raw: string, knownAgents: string[] = KNOWN_AGENTS): OrchestratePlan | null {
  const artifact = parsePlanArtifact(raw, {
    missionId: 'parsed-plan',
    goal: 'parsed goal',
    knownAgents
  })
  if (!artifact || artifact.taskDag.nodes.length === 0) return null
  return { subtasks: artifact.taskDag.nodes, artifact }
}

export function subtaskContractPrompt(st: PlanSubtask): string {
  return [
    'You are a sub-agent working under the Orbit main orchestrator.',
    'Execute ONLY this assigned task. Stay inside the task contract and coordinate through explicit notes when assumptions change.',
    '',
    'TASK:',
    st.detail || st.title,
    '',
    'TASK CONTRACT:',
    contractPromptBlock(st),
    '',
    'Before finishing, report what changed, what was verified, and any contract/coordination risk.'
  ].join('\n')
}

export function fallbackPlanArtifact(missionId: string, goal: string, leadAgentId?: string): PlanArtifact {
  return createPlanArtifact({
    missionId,
    goal,
    leadAgentId,
    source: 'fallback',
    subtasks: [{ id: '1', title: goal.slice(0, 80), detail: goal }]
  })
}

/** lead 汇总各子任务输出的用户消息 */
export function synthesisPrompt(
  userText: string,
  parts: Array<{ title: string; agentId?: string; content: string; error?: string }>
): string {
  const blocks = parts.map((p, i) =>
    `### 子任务 ${i + 1}: ${p.title}${p.agentId ? ' [' + p.agentId + ']' : ''}\n` +
    (p.error ? '(执行失败: ' + p.error + ')' : (p.content || '(无输出)'))
  ).join('\n\n')
  const someFailed = parts.some(p => p.error)
  const allFailed = parts.length > 0 && parts.every(p => p.error)
  const guard = allFailed
    ? 'EVERY subtask failed. Do NOT claim any deliverable is complete, and do NOT present pre-existing or unverified files already in the workspace as the result of this run. State clearly that the task did not succeed, summarize each failure and its likely cause, and give the single most useful next step.'
    : someFailed
      ? 'Some subtasks failed. Clearly separate what actually succeeded from what failed; do NOT present unverified or pre-existing files as completed deliverables, and do NOT overstate success.'
      : 'Synthesize the successful outputs into the deliverable.'
  return [
    'You orchestrated the subtasks below for the user request. Synthesize their outputs into one coherent final answer. ' +
    'Resolve overlaps and note any failures briefly. Answer in the user\'s language.',
    'IMPORTANT: ' + guard,
    '',
    'USER REQUEST:',
    userText,
    '',
    'SUBTASK RESULTS:',
    blocks
  ].join('\n')
}

/** 让 verify agent 判定子任务结果是否达成目标的提示（要求单行 PASS / FAIL:原因） */
export function verifyPrompt(title: string, detail: string | undefined, result: string): string {
  return [
    'You are a strict reviewer. Decide whether the RESULT adequately accomplishes the SUBTASK.',
    'Reply with ONLY one line: "PASS" if it does, or "FAIL: <short reason>" if it does not.',
    '',
    'SUBTASK: ' + title + (detail ? ' — ' + detail : ''),
    '',
    'RESULT:',
    result || '(empty)'
  ].join('\n')
}

/** 解析 verify 输出：显式 PASS→通过；含 FAIL→不通过(带原因);否则宽松判通过(避免歧义致死循环)。 */
export function parseVerdict(raw: string): { pass: boolean; note?: string } {
  const s = (raw || '').trim()
  if (/^\s*PASS\b/i.test(s)) return { pass: true }
  const fm = s.match(/FAIL\s*[:：]?\s*(.{0,200})/i)
  if (fm) return { pass: false, note: (fm[1] || '').trim() || undefined }
  return { pass: true }
}

/** 重试时把上一次失败原因拼到子任务提示前，引导修复 */
export function retryPrompt(detail: string, note: string | undefined): string {
  return [
    'A previous attempt at this subtask was judged inadequate' + (note ? (': ' + note) : '') + '.',
    'Redo it, fixing that problem.',
    '',
    detail
  ].join('\n')
}
