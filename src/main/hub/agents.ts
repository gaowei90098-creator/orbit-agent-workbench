/**
 * Agent 元数据单一事实源（主进程）
 *
 * 此前 agent 的名称/能力/路由关键词/系统提示/接管支持分散在 index.ts、aggregator.ts、
 * dispatcher.ts、agent-detector.ts、router.ts 多处，彼此漂移。这里统一为一张表，
 * 各处派生使用。
 *
 * 注意：渲染层（src/renderer/glass/meta.ts）是独立打包单元，仍维护自己的展示用表，
 * 不从此处 import（避免跨 bundle 的 dev fs 限制）。
 */
export interface AgentManifestEntry {
  id: string
  /** 显示名（英文） */
  name: string
  /** 中文名（渲染层 zh 模式可用） */
  nameZh: string
  /** 能力标签 */
  caps: string[]
  /** KeywordRouter 自动路由关键词 */
  routeKeywords: string[]
  /** 派发时注入的系统提示词 */
  systemPrompt: string
  /** 默认传输协议 */
  defaultProtocol: 'http' | 'stdio-plain'
  /** 是否支持桌面配置接管（takeover.ts 覆盖：codex/claude/hermes） */
  takeoverSupported: boolean
  /** agent-detector 用于 PATH 探测的二进制名；无可用 CLI（如 marvis）则留空 */
  probeBinary?: string
}

export const MAIN_AGENT_ID = 'orbit'

export const AGENTS: AgentManifestEntry[] = [
  {
    id: MAIN_AGENT_ID,
    name: 'Orbit',
    nameZh: 'Orbit 主 Agent',
    caps: ['planning', 'routing', 'supervision', 'synthesis'],
    routeKeywords: [],
    systemPrompt: [
      'You are Orbit, the main orchestrator agent.',
      'You do not act as a normal worker.',
      'You read the project goal and memory, create a bounded task DAG, assign contracts to sub-agents, supervise progress, verify results, and synthesize the final answer.',
      'Keep task granularity aligned and call out coordination risks early.'
    ].join(' '),
    defaultProtocol: 'http',
    takeoverSupported: false
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    nameZh: 'Codex',
    caps: ['coding', 'debug', 'refactor', 'api', 'deploy'],
    routeKeywords: ['写代码', 'debug', '修复', '重构', '实现', '函数', 'api', 'bug', 'coding', 'implement', 'fix', '部署', '脚本', 'pipeline', 'deploy', 'script'],
    systemPrompt: 'You are Codex, an expert software engineer focused on coding, debugging and refactoring. Be precise and produce working code.',
    defaultProtocol: 'http',
    takeoverSupported: true,
    probeBinary: 'codex'
  },
  {
    id: 'claude',
    name: 'Claude Code',
    nameZh: 'Claude Code',
    caps: ['analysis', 'writing', 'translation', 'research'],
    routeKeywords: ['分析', '总结', '解释', '文档', '写作', '翻译', '报告', 'analyze', 'summary', 'explain', 'document'],
    systemPrompt: 'You are Claude Code, an analytical assistant focused on writing, research and clear explanations.',
    defaultProtocol: 'http',
    takeoverSupported: true,
    probeBinary: 'claude'
  },
  {
    id: 'hermes',
    name: 'Hermes',
    nameZh: 'Hermes',
    caps: ['notify', 'remote-control', 'progress', 'approval'],
    routeKeywords: ['通知', '通报', '进度', '远程', '手机', '提醒', '确认', '审批', 'notify', 'progress', 'remote', 'approval'],
    systemPrompt: [
      'You are Hermes, a user communication bridge for Orbit.',
      'Your role is to notify the user about mission progress and relay remote user instructions back to Orbit.',
      'Do not act as a coding, deployment, database, or file-writing worker unless the user explicitly redefines your role.'
    ].join(' '),
    defaultProtocol: 'http',
    takeoverSupported: true,
    probeBinary: 'hermes'
  }
]

export const WORKER_AGENTS = AGENTS.filter(agent => agent.id !== MAIN_AGENT_ID)
export const WORKER_AGENT_IDS = WORKER_AGENTS.map(agent => agent.id)
export const USER_BRIDGE_AGENT_IDS = ['hermes'] as const
export const DISABLED_AGENT_IDS = ['openclaw', 'marvis', 'minimax-code'] as const
export const NOTIFICATION_BRIDGE_STORAGE_KEY = 'orbit.notificationBridge'
export const DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID = 'hermes'
const USER_BRIDGE_ID_SET = new Set<string>(USER_BRIDGE_AGENT_IDS)
const DISABLED_AGENT_ID_SET = new Set<string>(DISABLED_AGENT_IDS)
export const EXECUTION_WORKER_AGENTS = WORKER_AGENTS.filter(agent => !USER_BRIDGE_ID_SET.has(agent.id))
export const EXECUTION_WORKER_AGENT_IDS = EXECUTION_WORKER_AGENTS.map(agent => agent.id)

export function isUserBridgeAgent(id: string): boolean {
  return USER_BRIDGE_ID_SET.has(id)
}

export function isDisabledAgent(id: string): boolean {
  return DISABLED_AGENT_ID_SET.has(id)
}

export const AGENTS_BY_ID: Record<string, AgentManifestEntry> =
  Object.fromEntries(AGENTS.map(a => [a.id, a]))

export function agentName(id: string): string {
  return AGENTS_BY_ID[id]?.name ?? id
}

export function agentCaps(id: string): string[] {
  return AGENTS_BY_ID[id]?.caps ?? []
}

export function agentSystemPrompt(id: string): string {
  return AGENTS_BY_ID[id]?.systemPrompt ?? ('You are AgentHub agent ' + id + '. Be concise and helpful.')
}
