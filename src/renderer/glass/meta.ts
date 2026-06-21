/* ============================================================
   AgentHub 玻璃拟态 UI — Agent 元数据与共享常量
   （与 design_handoff_glass_ui/app/store.jsx 的 AGENT_META 一致）
   ============================================================ */

import type { OrchestrateState } from './orchestrate-view'
import type { CollaborateState } from './collaborate-view'

export interface AgentMeta {
  name: string
  nameZh: string
  icon: string
  /** hermes 黑线稿需要浅色磨砂底 */
  tileLight?: boolean
  /** CSS 变量形式 */
  color: string
  /** 图标主色（光晕/高亮） */
  colorRaw: string
  caps: string[]
  desc: string
}

export const AGENT_META: Record<string, AgentMeta> = {
  orbit: {
    name: 'Orbit', nameZh: '主 Agent', icon: 'icons/orbit.png',
    color: 'var(--mint)', colorRaw: '#8b91e8',
    caps: ['planning', 'routing', 'supervision', 'synthesis'], desc: '主 Agent · 拆分 · 派发 · 汇总'
  },
  codex: {
    name: 'Codex CLI', nameZh: '代码工程', icon: 'icons/codex.png',
    color: 'var(--ag-codex)', colorRaw: '#7b87fa',
    caps: ['coding', 'debug', 'refactor', 'api'], desc: '精确编码 · 调试 · 重构'
  },
  claude: {
    name: 'Claude Code', nameZh: '分析写作', icon: 'icons/claude.png',
    color: 'var(--ag-claude)', colorRaw: '#d97757',
    caps: ['analysis', 'writing', 'translation', 'research'], desc: '分析 · 写作 · 研究'
  },
  hermes: {
    name: 'Hermes', nameZh: '远程通报', icon: 'icons/hermes.png', tileLight: true,
    color: 'var(--ag-hermes)', colorRaw: '#aab4c4',
    caps: ['notify', 'remote', 'progress', 'approval'], desc: '手机通知 · 远程要求 · 进度通报'
  }
}

export const MAIN_AGENT_ID = 'orbit'
export const AGENT_IDS = ['codex', 'claude', 'hermes']
export const USER_BRIDGE_AGENT_IDS = ['hermes']
export const EXECUTION_AGENT_IDS = AGENT_IDS.filter(id => !USER_BRIDGE_AGENT_IDS.includes(id))
export const NOTIFICATION_BRIDGE_STORAGE_KEY = 'orbit.notificationBridge'
export const DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID = 'hermes'
export const ROUTING_AGENT_IDS = [MAIN_AGENT_ID, ...AGENT_IDS]

export type AgentUIStatus = 'idle' | 'busy' | 'error' | 'off'

export const STATUS_ZH: Record<AgentUIStatus, string> = {
  idle: '空闲', busy: '运行中', error: '异常', off: '未启用'
}

export type DispatchMode = 'auto' | 'broadcast' | 'chain' | 'orchestrate' | 'collaborate'

export const MODE_ZH: Record<string, string> = { auto: '智能路由', broadcast: '广播', chain: '接力', orchestrate: '编排', collaborate: '协作' }

export type TaskUIStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export const TASK_ST: Record<TaskUIStatus, { zh: string; color: string }> = {
  running: { zh: '运行中', color: 'var(--st-busy)' },
  completed: { zh: '已完成', color: 'var(--st-idle)' },
  failed: { zh: '失败', color: 'var(--st-error)' },
  cancelled: { zh: '已取消', color: 'var(--tx-3)' }
}

/* ---------- 渲染层数据形状（镜像 src/main/providers/types.ts） ---------- */

export interface ModelDef { id: string; label: string }

export interface ProviderDef {
  id: string
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  builtIn: boolean
  models: ModelDef[]
  health?: { reachable: boolean; latencyMs?: number; error?: string } | null
}

export interface BindingDef {
  agentId: string
  providerId: string
  modelId: string
  thinkingAllow?: string[]
  thinking: { mode: 'off' | 'auto' | 'enabled'; level: string; budgetTokens?: number; collapseInUI?: boolean }
  temperature?: number
  maxOutputTokens?: number
  protocol?: 'http' | 'stdio-plain' | 'acp'
  binary?: string
  args?: string
}

/** StdIO 模式各 Agent 的默认 oneshot 参数（与主进程 adapter 默认一致，仅用于 UI 提示）。
    codex/claude 为 agentic 默认（在工作区读写文件、跑命令），留空即用这套参数。 */
export const DEFAULT_STDIO_ARGS: Record<string, string> = {
  codex: 'exec --json --sandbox danger-full-access --skip-git-repo-check -C . -',
  claude: '--print --verbose --output-format stream-json --permission-mode acceptEdits',
  hermes: '（无参数，prompt 走 stdin）'
}

export interface TokenUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; modelId?: string }

export interface TaskItem {
  id: string
  text: string
  mode: DispatchMode
  status: TaskUIStatus
  agents: string[]
  durationMs: number | null
  createdAt: string
  results?: Record<string, string>
  errors?: Record<string, string>
  /** 每 agent 的 token 用量（来自 dispatch done 事件） */
  usage?: Record<string, TokenUsage>
  /** 每 agent 的 agentic 活动轨迹（来自 activity 流事件）；持久化后可在任务历史里复查"做了什么" */
  steps?: Record<string, ActivityStep[]>
}

/** 单条 usage 的总 token（缺 total 时用 prompt+completion 兜底） */
export const usageTotal = (u?: TokenUsage): number =>
  u ? (u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0)) : 0

/** 任务级 token 合计（各 agent 求和） */
export const sumTokens = (m?: Record<string, TokenUsage>): number =>
  m ? Object.values(m).reduce((s, u) => s + usageTotal(u), 0) : 0

/** 紧凑显示 token 数：1234→1.2k，1234567→1.2M */
export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M'
  : n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'k'
  : String(n)

/* ---------- 费用估算 ----------
   近似单价（USD / 1M tokens，{in:输入, out:输出}）。公开报价随时间变动，仅供估算。
   最后核对 2026-06；如过期在此更新。未列出的模型不显示费用（而非显示 $0）。 */
const MODEL_PRICES: Array<{ match: RegExp; in: number; out: number }> = [
  { match: /^claude-fable/i, in: 10, out: 50 },
  { match: /opus/i, in: 5, out: 25 },
  { match: /haiku/i, in: 1, out: 5 },
  { match: /^claude/i, in: 3, out: 15 },        // sonnet 及其它 claude 取 3/15
  { match: /^gpt-5\.5-pro/i, in: 30, out: 180 },
  { match: /^gpt-5\.5/i, in: 5, out: 30 },
  { match: /^gpt-5\.4-mini/i, in: 0.75, out: 4.5 },
  { match: /^gpt-5\.4-nano/i, in: 0.2, out: 1.25 },
  { match: /^gpt-5\.4/i, in: 2.5, out: 15 },
  { match: /^gpt-5\.3-codex/i, in: 1.25, out: 10 },
  { match: /^gpt-5/i, in: 1.25, out: 10 },
  { match: /^gpt-4o-mini/i, in: 0.15, out: 0.6 },
  { match: /^gpt-4o/i, in: 2.5, out: 10 },
  { match: /^gpt-4\.1-mini/i, in: 0.4, out: 1.6 },
  { match: /^gpt-4\.1/i, in: 2, out: 8 },
  { match: /^deepseek/i, in: 0.27, out: 1.1 },
  { match: /gemini.*flash/i, in: 0.3, out: 2.5 },
  { match: /gemini.*pro/i, in: 1.25, out: 10 }
]

function priceFor(modelId?: string): { in: number; out: number } | null {
  if (!modelId) return null
  for (const p of MODEL_PRICES) if (p.match.test(modelId)) return p
  return null
}

/** 单条 usage 的估算费用（USD）；模型未在单价表中则返回 null（不参与合计）。 */
export const costOf = (u?: TokenUsage): number | null => {
  if (!u) return null
  const p = priceFor(u.modelId)
  if (!p) return null
  return (u.prompt_tokens || 0) / 1e6 * p.in + (u.completion_tokens || 0) / 1e6 * p.out
}

/** 任务/会话级估算费用合计；无任一可估则返回 null。 */
export const sumCost = (m?: Record<string, TokenUsage>): number | null => {
  if (!m) return null
  let total = 0, any = false
  for (const u of Object.values(m)) { const c = costOf(u); if (c != null) { total += c; any = true } }
  return any ? total : null
}

/** 紧凑显示费用：0→$0，<0.01→<$0.01，否则 $0.0123 / $1.23。 */
export const fmtCost = (n: number): string =>
  n === 0 ? '$0' : n < 0.01 ? '<$0.01' : '$' + n.toFixed(n < 1 ? 3 : 2)

/* ---------- agentic 活动轨迹（Track A/B 共享）----------
   stdio CLI（claude/codex stream-json）或 HTTP act-observe 回环把每一步工具调用/思考
   解析成结构化 ActivityStep，经 `kind:'activity'` 流事件喂进对应 reply 的 steps[]。
   解析失败软回退：不发 activity，UI 照常显示纯文本，无步骤卡，零回归。 */
export type ActivityKind = 'tool' | 'thinking' | 'text' | 'note'
export type ActivityStatus = 'running' | 'done' | 'error'

export interface ActivityStep {
  /** 稳定 id（如 tool_use id 或序号），UI 按它做增量 upsert */
  id: string
  kind: ActivityKind
  /** 原始工具名（用于图标/分类，如 Write/Bash/Read/Edit/Grep） */
  tool?: string
  /** 一行标题，如 "Write · hello.txt"、"Bash · ls -la" */
  label: string
  /** 可展开细节：命令全文 / 文件路径 / 输入参数摘要 */
  detail?: string
  /** 可展开输出：工具结果预览（截断） */
  output?: string
  status: ActivityStatus
}

export interface ReplyState {
  agentId: string
  thinking: string
  text: string
  done: boolean
  cancelled?: boolean
  error?: string
  /** Track A：stdio agentic 过程的结构化步骤（claude/codex stream-json 解析而来） */
  steps?: ActivityStep[]
}

export interface ChatMessage {
  id: string
  role: 'user'
  text: string
  mode: DispatchMode
  taskId: string
  replies: ReplyState[]
  /** 编排模式：由 orchestrate:* 事件经 reducer 聚合 */
  orchestration?: OrchestrateState
  /** 协作模式：由 collaborate:* 事件经 reducer 聚合 */
  collaboration?: CollaborateState
}

export interface WorkspaceItem {
  id: string
  name: string
  rootPath: string
  createdAt: number
  updatedAt: number
}

export interface ConversationItem {
  id: string
  workspaceId: string | null
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  tasks: TaskItem[]
}

export const fmtDur = (ms: number | null): string =>
  ms == null ? '–' : ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'

export const nowHHMM = (): string => new Date().toTimeString().slice(0, 5)
