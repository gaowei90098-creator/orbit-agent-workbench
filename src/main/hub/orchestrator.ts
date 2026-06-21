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

export interface CollabTurn {
  agentId: string
  round: number
  text: string
}

function compactLine(value: string, limit = 1800): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function formatCollabTurn(turn: CollabTurn, index: number): string {
  return `### Turn ${index + 1} · Round ${turn.round} · ${turn.agentId}\n${turn.text || '(empty)'}`
}

function compactCollabTranscript(topic: string, transcript: CollabTurn[]): string {
  if (transcript.length === 0) return 'No prior turns yet.'
  const recent = transcript.slice(-6)
  const older = transcript.slice(0, -6)
  const olderSummary = older.length
    ? [
        'Earlier turns compressed for token control:',
        compactLine(older.map(formatCollabTurn).join('\n\n'), 2200),
        ''
      ].join('\n')
    : ''
  return [
    olderSummary,
    'Recent full turns:',
    recent.map((turn, index) => formatCollabTurn(turn, transcript.length - recent.length + index)).join('\n\n'),
    '',
    'Original topic:',
    topic
  ].filter(Boolean).join('\n')
}

export function collabTurnPrompt(
  topic: string,
  agentId: string,
  transcript: CollabTurn[],
  round: number,
  totalRounds: number,
  participants: string[] = []
): string {
  const lastPeer = [...transcript].reverse().find(turn => turn.agentId !== agentId)
  const roleHint = participants.length > 1 && participants[0] === agentId
    ? 'You open or defend a concrete proposal, implementation path, or thesis.'
    : 'You stress-test, refine, challenge assumptions, and converge toward a better shared answer.'
  return [
    'You are participating in an Orbit multi-agent collaboration round.',
    `Your agent id: ${agentId}. Round ${round} of ${totalRounds}.`,
    roleHint,
    '',
    'TOPIC / USER REQUEST:',
    topic,
    '',
    lastPeer ? 'MOST RECENT PEER TURN TO ANSWER DIRECTLY:\n' + lastPeer.text : 'There is no peer turn yet. Start with a concrete position and useful framing.',
    '',
    'SHARED TRANSCRIPT:',
    compactCollabTranscript(topic, transcript),
    '',
    'RESPONSE RULES:',
    '- Respond to specific points from the peer transcript instead of writing an isolated essay.',
    '- Add new evidence, constraints, implementation detail, or a sharper objection.',
    '- Move toward convergence: state what you agree with, what you dispute, and what should happen next.',
    '- Be concise but substantive. Avoid generic praise and repeated summaries.'
  ].join('\n')
}

export function collabSynthesisPrompt(topic: string, transcript: CollabTurn[]): string {
  return [
    'You are Orbit, the lead Agent synthesizing a multi-agent collaboration transcript.',
    'Read the full shared record below and produce one final answer in the user\'s language.',
    'Do not claim that files were edited or commands were run unless the transcript proves it.',
    '',
    'USER REQUEST:',
    topic,
    '',
    'COLLABORATION TRANSCRIPT:',
    compactCollabTranscript(topic, transcript),
    '',
    'FINAL ANSWER REQUIREMENTS:',
    '- Name the strongest useful points from each agent.',
    '- Resolve disagreements into a clear recommendation or conclusion.',
    '- If this was a debate, state which side was more convincing and why.',
    '- Include concrete next steps, risks, or acceptance checks when relevant.'
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
