/**
 * AgentHub 模型提供商系统 - 类型定义
 *
 * 参考 CC-Switch v3.16.1 设计：
 *   - 多厂商统一抽象（OpenAI 兼容 / Anthropic 原生 / Gemini 原生 / 自定义 OpenAI 兼容）
 *   - 每个 Provider 持有独立 endpoint / apiKey / 模型白名单
 *   - 思考能力通过 providerCapabilities + 任务级 thinkingConfig 组合表达
 */

export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'custom'

export type ThinkingMode = 'off' | 'auto' | 'enabled'

/** 思考强度档位，与 Anthropic/OpenAI reasoning_effort 对齐 */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** 任务级思考配置，覆盖 Provider 默认值 */
export interface ThinkingConfig {
  mode: ThinkingMode
  level: ThinkingLevel
  /** Anthropic 风格预算（tokens），level=budget 时生效 */
  budgetTokens?: number
  /** 是否在 UI 折叠思考内容 */
  collapseInUI?: boolean
}

export interface ModelDefinition {
  id: string
  label: string
  contextWindow: number
  supportsTools: boolean
  supportsVision: boolean
  supportsThinking: boolean
  maxThinkingLevel?: ThinkingLevel
  defaultThinkingLevel?: ThinkingLevel
  /** 给人类看的描述 */
  description?: string
}

export interface ProviderCapabilities {
  protocol: 'chat_completions' | 'messages' | 'generate_content'
  stream: boolean
  /** 该 Provider 是否原生支持 reasoning/thinking 字段 */
  nativeThinking: boolean
  /** 是否允许自定义 thinking budget */
  budgetTokens: boolean
  /** 支持 tool/function calling */
  toolCalls: boolean
  /** 支持 system prompt */
  systemPrompt: boolean
}

export interface ProviderDefinition {
  id: string
  /** 显示名，例如 OpenAI / DeepSeek / 自定义中转 */
  name: string
  kind: ProviderKind
  /** 基础 endpoint，例如 https://api.openai.com/v1 */
  baseUrl: string
  /** API Key（加密前持久化到本地 config） */
  apiKey: string
  /** 启用状态（关闭后不可路由） */
  enabled: boolean
  /** 是否为内置预设（不可删除，可改名） */
  builtIn: boolean
  /** 模型白名单（默认全部启用） */
  models: ModelDefinition[]
  /** 能力描述 */
  capabilities: ProviderCapabilities
  /** 默认思考设置 */
  defaultThinking: ThinkingConfig
  /** 自定义 HTTP 头（部分中转站需要） */
  customHeaders?: Record<string, string>
  /** 备注 */
  note?: string
  /** 健康状态（运行时） */
  health?: ProviderHealth
}

export interface ProviderHealth {
  reachable: boolean
  /** 细分状态：ok=可达且鉴权通过；unauthorized=鉴权失败(401/403/无 key)；error=其它 HTTP 错误；unreachable=网络不可达 */
  status?: 'ok' | 'unauthorized' | 'error' | 'unreachable'
  lastCheck: number
  latencyMs?: number
  error?: string
}

/** 路由规则：把虚拟 Agent 绑定到具体 Provider+Model */
export interface AgentRouteBinding {
  agentId: string
  providerId: string
  modelId: string
  /** 该 Agent 允许的思考模式白名单 */
  thinkingAllow: ThinkingMode[]
  /** 默认思考配置（覆盖 Provider 默认） */
  thinking: ThinkingConfig
  /** 最大 token 输出 */
  maxOutputTokens?: number
  /** 温度（0-2） */
  temperature?: number
  /** 传输协议：http（LLM provider）/ stdio-plain（本地 CLI 子进程，oneshot）/ acp（Agent Client Protocol 常驻 server，默认 http） */
  protocol?: 'http' | 'stdio-plain' | 'acp'
  /** stdio 模式下 CLI 二进制路径（默认自动探测：环境变量 → 桌面版安装目录 → PATH） */
  binary?: string
  /** stdio 模式下命令行参数（空格分隔；含 {prompt} 占位符则 prompt 作为参数传入，否则走 stdin） */
  args?: string
}

/** 完整路由配置（持久化） */
export interface RoutingConfig {
  bindings: AgentRouteBinding[]
  /** 默认降级链：主 Provider 不可用时按顺序回退 */
  fallbackChain: string[]
  /** 路由策略 */
  strategy: 'single' | 'load-balance' | 'cost-aware'
}

export interface ProvidersConfig {
  providers: ProviderDefinition[]
  routing: RoutingConfig
  /** 当前激活的 Agent 路由（可由 UI 切换） */
  activeBindingId: string | null
  /** 配置 schema 版本（用于未来迁移；落盘的 apiKey 经 safeStorage 加密） */
  version?: number
}

/** 思考展示摘要（消息总线专用） */
export interface ThinkingSummary {
  enabled: boolean
  level?: ThinkingLevel
  budget?: number
  preview?: string
  durationMs?: number
}

/** Chat Completions 风格消息（OpenAI 协议） */
export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_calls?: any[]
  tool_call_id?: string
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatCompletionMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
  tools?: any[]
  /** OpenAI 兼容的 reasoning_effort */
  reasoning_effort?: ThinkingLevel
  /** 自定义元数据 */
  metadata?: Record<string, any>
}

export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string
      reasoning_content?: string
      tool_calls?: any[]
    }
    finish_reason?: string | null
  }>
  /** 思考内容（若 Provider 返回） */
  thinking?: ThinkingSummary
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: ChatCompletionMessage & { reasoning_content?: string }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  thinking?: ThinkingSummary
}
