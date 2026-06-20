import type { ProviderDefinition, ModelDefinition, ThinkingConfig } from './types'

/** 不同 thinking 等级对应的 token 预算（与 Anthropic 等价映射） */
export const THINKING_BUDGET_TOKENS: Record<string, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 32768
}

const OAI_DEFAULT_THINKING: ThinkingConfig = {
  mode: 'auto',
  level: 'medium',
  budgetTokens: THINKING_BUDGET_TOKENS.medium,
  collapseInUI: true
}

const OAI_OFF_THINKING: ThinkingConfig = {
  mode: 'off',
  level: 'medium',
  collapseInUI: true
}

const ANTHROPIC_DEFAULT_THINKING: ThinkingConfig = {
  mode: 'auto',
  level: 'medium',
  budgetTokens: THINKING_BUDGET_TOKENS.medium,
  collapseInUI: true
}

function oaiModel(id: string, label: string, opts: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id,
    label,
    contextWindow: 400000,
    supportsTools: true,
    supportsVision: true,
    supportsThinking: /^gpt-5|^o[134]/i.test(id),
    maxThinkingLevel: /^gpt-5|^o[134]/i.test(id) ? 'xhigh' : undefined,
    defaultThinkingLevel: /^gpt-5|^o[134]/i.test(id) ? 'medium' : undefined,
    description: opts.description,
    ...opts
  }
}

function anthropicModel(id: string, label: string, opts: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id,
    label,
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    supportsThinking: true,
    maxThinkingLevel: 'xhigh',
    defaultThinkingLevel: 'medium',
    description: opts.description,
    ...opts
  }
}

function geminiModel(id: string, label: string, opts: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id,
    label,
    contextWindow: 1000000,
    supportsTools: true,
    supportsVision: true,
    supportsThinking: true,
    maxThinkingLevel: 'high',
    defaultThinkingLevel: 'medium',
    description: opts.description,
    ...opts
  }
}

/**
 * 内置 Provider 预设：
 *   - openai（OpenAI 原生 API）
 *   - anthropic（Anthropic Messages API）
 *   - gemini（Google Generative AI）
 *   - deepseek（OpenAI 兼容，中转）
 *   - openrouter（OpenAI 兼容聚合）
 *   - custom（用户自定义 OpenAI 兼容中转）
 */
export const BUILTIN_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: OAI_DEFAULT_THINKING,
    models: [
      oaiModel('gpt-5.5', 'GPT-5.5', { contextWindow: 1_000_000, description: 'OpenAI 最新旗舰，适合复杂编码、Agent、长上下文工作流' }),
      oaiModel('gpt-5.5-pro', 'GPT-5.5 Pro', { contextWindow: 1_000_000, description: 'GPT-5.5 高精度版本，成本更高' }),
      oaiModel('gpt-5.4', 'GPT-5.4', { contextWindow: 400000, description: '更经济的专业工作与编码模型' }),
      oaiModel('gpt-5.4-pro', 'GPT-5.4 Pro', { contextWindow: 400000, description: 'GPT-5.4 高精度版本' }),
      oaiModel('gpt-5.4-mini', 'GPT-5.4 mini', { contextWindow: 400000, description: '强小模型，适合子 Agent、编码和计算机使用' }),
      oaiModel('gpt-5.4-nano', 'GPT-5.4 nano', { contextWindow: 400000, description: '低成本高吞吐任务' }),
      oaiModel('gpt-5.3-codex', 'GPT-5.3 Codex', { contextWindow: 400000, description: 'Agentic coding 专用模型，需 Responses API/API 权限' }),
      oaiModel('gpt-5.2', 'GPT-5.2', { contextWindow: 400000, description: '上一代专业工作模型' }),
      oaiModel('gpt-4o', 'GPT-4o', { contextWindow: 128000, supportsThinking: false, maxThinkingLevel: undefined, defaultThinkingLevel: undefined, description: '旧版多模态模型（已非最新）' }),
      oaiModel('gpt-4o-mini', 'GPT-4o mini', { contextWindow: 128000, supportsThinking: false, maxThinkingLevel: undefined, defaultThinkingLevel: undefined, description: '旧版轻量高速版本' }),
      oaiModel('gpt-4.1', 'GPT-4.1', { description: 'OpenAI 4.1 长上下文' }),
      oaiModel('gpt-4.1-mini', 'GPT-4.1 mini', { description: '4.1 轻量版本' }),
      oaiModel('o3-mini', 'o3-mini', { supportsThinking: true, maxThinkingLevel: 'high', description: 'OpenAI 推理模型' }),
      oaiModel('o4-mini', 'o4-mini', { supportsThinking: true, maxThinkingLevel: 'high', description: 'OpenAI 新一代推理' })
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'messages',
      stream: true,
      nativeThinking: true,
      budgetTokens: true,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: ANTHROPIC_DEFAULT_THINKING,
    models: [
      anthropicModel('claude-fable-5', 'Claude Fable 5', { contextWindow: 1_000_000, supportsThinking: false, maxThinkingLevel: undefined, defaultThinkingLevel: undefined, description: 'Anthropic 最强广泛发布模型，适合高难度推理和长程 Agent' }),
      anthropicModel('claude-opus-4-8', 'Claude Opus 4.8', { contextWindow: 1_000_000, supportsThinking: false, maxThinkingLevel: undefined, defaultThinkingLevel: undefined, description: '最新 Opus，复杂推理与高自治编码' }),
      anthropicModel('claude-sonnet-4-6', 'Claude Sonnet 4.6', { contextWindow: 1_000_000, description: '速度与智能平衡，适合 Claude Code / 子 Agent' }),
      anthropicModel('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', { maxThinkingLevel: 'medium', description: '高速低延迟版本' }),
      anthropicModel('claude-sonnet-4-5', 'Claude Sonnet 4.5', { description: '上一代 Sonnet' }),
      anthropicModel('claude-opus-4-5', 'Claude Opus 4.5', { maxThinkingLevel: 'xhigh', description: '上一代 Opus' }),
      anthropicModel('claude-3-7-sonnet-latest', 'Claude 3.7 Sonnet', { description: '稳定版 3.7' })
    ]
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'generate_content',
      stream: true,
      nativeThinking: true,
      budgetTokens: true,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium', budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
    models: [
      geminiModel('gemini-2.5-pro', 'Gemini 2.5 Pro', { description: 'Gemini 旗舰多模态' }),
      geminiModel('gemini-2.5-flash', 'Gemini 2.5 Flash', { description: '高速版本' }),
      geminiModel('gemini-2.0-flash', 'Gemini 2.0 Flash', { description: '上一代 Flash' })
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true },
    models: [
      oaiModel('deepseek-chat', 'DeepSeek-V3', { contextWindow: 64000, supportsThinking: false, description: 'DeepSeek 通用对话' }),
      oaiModel('deepseek-reasoner', 'DeepSeek-R1', { contextWindow: 64000, supportsThinking: true, maxThinkingLevel: 'xhigh', description: 'DeepSeek 推理模型' })
    ]
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    kind: 'openai-compatible',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true },
    models: [
      oaiModel('MiniMax-M2.7', 'MiniMax M2.7', { contextWindow: 200000, supportsThinking: true, maxThinkingLevel: 'high', description: 'MiniMax 旗舰 Agent/编码模型' }),
      oaiModel('MiniMax-M2', 'MiniMax M2', { contextWindow: 200000, supportsThinking: true, maxThinkingLevel: 'high', description: '上一代旗舰' }),
      oaiModel('MiniMax-Text-01', 'MiniMax Text-01', { contextWindow: 1000000, description: '超长上下文通用模型' })
    ],
    note: '国际版用 https://api.minimax.io/v1；配好 Key 后点「获取模型」拉取最新列表'
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true },
    models: [
      oaiModel('kimi-k2.6', 'Kimi K2.6', { contextWindow: 256000, supportsThinking: true, maxThinkingLevel: 'high', description: '月之暗面旗舰' }),
      oaiModel('kimi-k2-0905-preview', 'Kimi K2 Preview', { contextWindow: 256000, description: 'K2 预览版' }),
      oaiModel('moonshot-v1-128k', 'Moonshot v1 128K', { description: '经典长上下文' })
    ]
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    kind: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true },
    models: [
      oaiModel('glm-4.7', 'GLM-4.7', { contextWindow: 200000, supportsThinking: true, maxThinkingLevel: 'high', description: '智谱旗舰编码/推理' }),
      oaiModel('glm-4.6', 'GLM-4.6', { contextWindow: 200000, supportsThinking: true, maxThinkingLevel: 'high', description: '上一代旗舰' }),
      oaiModel('glm-4-flash', 'GLM-4 Flash', { description: '高速免费档' })
    ]
  },
  {
    id: 'qwen',
    name: '通义千问',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true },
    models: [
      oaiModel('qwen3-max', 'Qwen3 Max', { contextWindow: 256000, supportsThinking: true, maxThinkingLevel: 'high', description: '阿里旗舰' }),
      oaiModel('qwen-plus', 'Qwen Plus', { contextWindow: 131072, description: '均衡档' }),
      oaiModel('qwen-turbo', 'Qwen Turbo', { description: '高速低成本' })
    ]
  },
  {
    id: 'doubao',
    name: '豆包 (火山方舟)',
    kind: 'openai-compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true },
    models: [
      oaiModel('doubao-seed-2-0', 'Doubao Seed 2.0', { contextWindow: 256000, supportsThinking: true, maxThinkingLevel: 'high', description: '字节旗舰全模态' }),
      oaiModel('doubao-1-5-pro-256k', 'Doubao 1.5 Pro 256K', { contextWindow: 256000, description: '长上下文' })
    ],
    note: '方舟也支持推理接入点 ID（ep-xxx）作为模型名；点「获取模型」可拉取你账号下可用列表'
  },
  {
    id: 'hunyuan',
    name: '腾讯混元',
    kind: 'openai-compatible',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true },
    models: [
      oaiModel('hunyuan-turbos-latest', 'Hunyuan TurboS', { contextWindow: 256000, description: '混元旗舰快思考' }),
      oaiModel('hunyuan-t1-latest', 'Hunyuan T1', { contextWindow: 256000, supportsThinking: true, maxThinkingLevel: 'high', description: '混元深度推理' }),
      oaiModel('hunyuan-lite', 'Hunyuan Lite', { description: '轻量免费档' })
    ]
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    kind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true },
    models: [
      oaiModel('deepseek-ai/DeepSeek-V3.2', 'DeepSeek V3.2 (SiliconFlow)', { contextWindow: 131072, description: '聚合平台直供' }),
      oaiModel('Qwen/Qwen3-32B', 'Qwen3 32B (SiliconFlow)', { description: '开源模型托管' })
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: OAI_OFF_THINKING,
    models: [
      oaiModel('anthropic/claude-sonnet-4-5', 'Claude Sonnet 4.5 (via OpenRouter)', { supportsThinking: true, maxThinkingLevel: 'high' }),
      oaiModel('openai/gpt-4o', 'GPT-4o (via OpenRouter)'),
      oaiModel('google/gemini-2.5-pro', 'Gemini 2.5 Pro (via OpenRouter)', { supportsThinking: true, maxThinkingLevel: 'high' }),
      oaiModel('deepseek/deepseek-r1', 'DeepSeek R1 (via OpenRouter)', { supportsThinking: true, maxThinkingLevel: 'xhigh' })
    ]
  },
]

/** 思考等级档位（UI 暴露） */
export const THINKING_LEVELS: Array<{ value: ThinkingConfig['level']; label: string; hint: string }> = [
  { value: 'minimal', label: '极简', hint: '约 1K tokens，仅做基础校验' },
  { value: 'low', label: '低', hint: '约 4K tokens，快速思考' },
  { value: 'medium', label: '中', hint: '约 8K tokens，平衡质量' },
  { value: 'high', label: '高', hint: '约 16K tokens，深度推理' },
  { value: 'xhigh', label: '极高', hint: '约 32K tokens，复杂任务' }
]
