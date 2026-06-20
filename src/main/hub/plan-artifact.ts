export type TaskContractStatus =
  | 'planned'
  | 'awaiting-approval'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface TaskContract {
  id: string
  title: string
  detail: string
  agentId?: string
  fileScope: string[]
  dependsOn: string[]
  doneWhen: string
  verifyCommand: string
  interfaceRef: string
  status: TaskContractStatus
  createdAt: string
  updatedAt: string
}

export interface TaskDAGEdge {
  from: string
  to: string
  type: 'blocks'
}

export interface TaskDAG {
  nodes: TaskContract[]
  edges: TaskDAGEdge[]
}

export interface PlanArtifact {
  version: 1
  missionId: string
  goal: string
  leadAgentId?: string
  status: 'draft' | 'awaiting-approval' | 'approved' | 'running' | 'completed' | 'failed' | 'cancelled'
  source: 'llm' | 'fallback' | 'user'
  taskDag: TaskDAG
  createdAt: string
  updatedAt: string
  summary?: string
  planText?: string
}

export interface CreatePlanArtifactInput {
  missionId: string
  goal: string
  leadAgentId?: string
  subtasks: any[]
  source?: PlanArtifact['source']
  now?: string
  planText?: string
  knownAgents?: string[]
}

export function createPlanArtifact(input: CreatePlanArtifactInput): PlanArtifact {
  const now = input.now || new Date().toISOString()
  const nodes = input.subtasks
    .map((item, index) => normalizeTaskContract(item, index, now, input.knownAgents))
    .filter((item): item is TaskContract => !!item)
  const safeNodes = nodes.length ? nodes : [
    normalizeTaskContract({ id: '1', title: input.goal.slice(0, 80), detail: input.goal }, 0, now, input.knownAgents)!
  ]
  return {
    version: 1,
    missionId: input.missionId,
    goal: input.goal,
    leadAgentId: input.leadAgentId,
    status: 'draft',
    source: input.source || 'llm',
    taskDag: {
      nodes: safeNodes,
      edges: buildDagEdges(safeNodes)
    },
    createdAt: now,
    updatedAt: now,
    summary: summarizeContracts(safeNodes),
    planText: input.planText
  }
}

export function parsePlanArtifact(raw: string, input: {
  missionId: string
  goal: string
  leadAgentId?: string
  knownAgents?: string[]
}): PlanArtifact | null {
  const obj = extractJsonObject(raw)
  if (!obj) return null
  const candidates = Array.isArray(obj?.subtasks) ? obj.subtasks
    : Array.isArray(obj?.contracts) ? obj.contracts
    : Array.isArray(obj?.taskDag?.nodes) ? obj.taskDag.nodes
    : null
  if (!candidates || candidates.length === 0) return null
  return createPlanArtifact({
    missionId: input.missionId,
    goal: String(obj.goal || input.goal),
    leadAgentId: String(obj.leadAgentId || input.leadAgentId || '') || undefined,
    subtasks: candidates,
    source: 'llm',
    planText: raw,
    knownAgents: input.knownAgents
  })
}

export function normalizeTaskContract(item: any, index: number, now = new Date().toISOString(), knownAgents?: string[]): TaskContract | null {
  if (!item || typeof item !== 'object') return null
  const detail = stringValue(item.detail) || stringValue(item.description) || stringValue(item.task) || stringValue(item.title)
  const title = (stringValue(item.title) || detail || `Task ${index + 1}`).slice(0, 100)
  if (!title && !detail) return null
  const rawAgent = stringValue(item.agentId) || stringValue(item.agent)
  const agentId = rawAgent && (!knownAgents || knownAgents.includes(rawAgent)) ? rawAgent : undefined
  return {
    id: stringValue(item.id) || String(index + 1),
    title,
    detail: detail || title,
    agentId,
    fileScope: stringArray(item.fileScope ?? item.files ?? item.scope).slice(0, 20),
    dependsOn: stringArray(item.dependsOn ?? item.dependencies ?? item.after).slice(0, 20),
    doneWhen: stringValue(item.doneWhen) || stringValue(item.acceptanceCriteria) || 'the assigned work is observably complete',
    verifyCommand: stringValue(item.verifyCommand) || stringValue(item.verify) || '',
    interfaceRef: stringValue(item.interfaceRef) || stringValue(item.contractRef) || stringValue(item.sharedContract) || '',
    status: normalizeStatus(item.status),
    createdAt: stringValue(item.createdAt) || now,
    updatedAt: stringValue(item.updatedAt) || now
  }
}

export function setPlanStatus(artifact: PlanArtifact, status: PlanArtifact['status'], now = new Date().toISOString()): PlanArtifact {
  return { ...artifact, status, updatedAt: now }
}

export function setContractStatus(artifact: PlanArtifact, contractId: string, status: TaskContractStatus, now = new Date().toISOString()): PlanArtifact {
  const nodes = artifact.taskDag.nodes.map(node =>
    node.id === contractId ? { ...node, status, updatedAt: now } : node)
  return {
    ...artifact,
    status: rollupPlanStatus(artifact.status, nodes),
    taskDag: { nodes, edges: artifact.taskDag.edges },
    updatedAt: now
  }
}

export function contractsReadyToRun(artifact: PlanArtifact, finished: Set<string>): TaskContract[] {
  return artifact.taskDag.nodes.filter(node =>
    node.status === 'planned' || node.status === 'ready' || node.status === 'awaiting-approval'
  ).filter(node => node.dependsOn.every(dep => finished.has(dep)))
}

export function contractPromptBlock(contract: Pick<TaskContract, 'title' | 'detail' | 'fileScope' | 'dependsOn' | 'doneWhen' | 'verifyCommand' | 'interfaceRef'>): string {
  return [
    '- Title: ' + contract.title,
    '- Detail: ' + contract.detail,
    '- File scope: ' + (contract.fileScope?.length ? contract.fileScope.join(', ') : 'not specified; keep changes tightly scoped'),
    '- Depends on: ' + (contract.dependsOn?.length ? contract.dependsOn.join(', ') : 'none'),
    '- Done when: ' + (contract.doneWhen || 'the requested task is observably complete'),
    '- Verify command: ' + (contract.verifyCommand || 'not specified; choose the smallest relevant check if available'),
    '- Interface/contract reference: ' + (contract.interfaceRef || 'none declared')
  ].join('\n')
}

function extractJsonObject(raw: string): any | null {
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
}

function buildDagEdges(nodes: TaskContract[]): TaskDAGEdge[] {
  const ids = new Set(nodes.map(node => node.id))
  const edges: TaskDAGEdge[] = []
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (ids.has(dep)) edges.push({ from: dep, to: node.id, type: 'blocks' })
    }
  }
  return edges
}

function summarizeContracts(nodes: TaskContract[]): string {
  return nodes.map(node => `${node.id}. ${node.title}${node.agentId ? ` [${node.agentId}]` : ''}`).join(' | ')
}

function normalizeStatus(status: any): TaskContractStatus {
  const s = typeof status === 'string' ? status : ''
  return ['planned', 'awaiting-approval', 'ready', 'running', 'waiting', 'blocked', 'done', 'failed', 'cancelled'].includes(s)
    ? s as TaskContractStatus
    : 'planned'
}

function rollupPlanStatus(current: PlanArtifact['status'], nodes: TaskContract[]): PlanArtifact['status'] {
  if (current === 'cancelled') return current
  if (nodes.some(node => node.status === 'running')) return 'running'
  if (nodes.every(node => node.status === 'done')) return 'completed'
  if (nodes.some(node => node.status === 'failed' || node.status === 'blocked')) return 'failed'
  return current === 'awaiting-approval' ? current : 'approved'
}

function stringArray(value: any): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value.split(/[,;\n]/).map(v => v.trim()).filter(Boolean)
  }
  return []
}

function stringValue(value: any): string {
  return typeof value === 'string' ? value.trim() : ''
}
