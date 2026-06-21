/**
 * ProviderManager
 *
 * 职责：
 *   1. 加载/持久化 ProvidersConfig（JSON 存储）
 *   2. 暴露增删改查 / 启用切换 / 健康检查
 *   3. 提供按 Agent 路由解析的统一入口：resolveBinding(agentId)
 */

import { EventEmitter } from 'events'
import { store, encryptSecret, decryptSecret } from '../store'
import {
  ProvidersConfig,
  ProviderDefinition,
  ModelDefinition,
  AgentRouteBinding,
  ThinkingConfig
} from './types'
import { BUILTIN_PROVIDERS, THINKING_BUDGET_TOKENS } from './presets'
import { anthropicModelsUrl, openAIChatCompletionsUrl, openAIModelsUrl } from './endpoints'
import { proxyFetch } from '../net/http'

const STORAGE_KEY = 'providers.config.v1'

const CONFIG_VERSION = 2

function defaultConfig(): ProvidersConfig {
  return {
    providers: BUILTIN_PROVIDERS.map(p => ({ ...p, models: p.models.map(m => ({ ...m })) })),
    routing: {
      bindings: defaultBindings(),
      fallbackChain: [],
      strategy: 'single'
    },
    activeBindingId: null,
    version: CONFIG_VERSION
  }
}

const LEGACY_CODEX_PROVIDER_ID = 'anthropic'
const LEGACY_CODEX_MODEL_ID = 'claude-sonnet-4-5'
const LEGACY_CLAUDE_PROVIDER_ID = 'openai'
const LEGACY_CLAUDE_MODEL_ID = 'gpt-4o'

const DEFAULT_CODEX_PROVIDER_ID = 'openai'
const DEFAULT_CODEX_MODEL_ID = 'gpt-5.5'
const DEFAULT_CLAUDE_PROVIDER_ID = 'anthropic'
const DEFAULT_CLAUDE_MODEL_ID = 'claude-sonnet-4-6'

/**
 * 默认 Agent 路由。Codex / Claude 默认走本地 CLI 登录态，不要求 API Key；
 * HTTP Provider 仍保留给用户主动切换、代理接管和其它云端 Agent。
 */
export function defaultBindings(): AgentRouteBinding[] {
  return [
    {
      agentId: 'orbit',
      providerId: DEFAULT_CODEX_PROVIDER_ID,
      modelId: DEFAULT_CODEX_MODEL_ID,
      protocol: 'http',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'medium', budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
      temperature: 0.2,
      maxOutputTokens: 8192
    },
    {
      agentId: 'codex',
      providerId: DEFAULT_CODEX_PROVIDER_ID,
      modelId: DEFAULT_CODEX_MODEL_ID,
      protocol: 'stdio-plain',
      binary: '',
      args: '',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'medium', budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
      temperature: 0.2,
      maxOutputTokens: 8192
    },
    {
      agentId: 'claude',
      providerId: DEFAULT_CLAUDE_PROVIDER_ID,
      modelId: DEFAULT_CLAUDE_MODEL_ID,
      protocol: 'stdio-plain',
      binary: '',
      args: '',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'medium', budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
      temperature: 0.4,
      maxOutputTokens: 8192
    },
    {
      agentId: 'openclaw',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'off', level: 'low', collapseInUI: true },
      temperature: 0.1,
      maxOutputTokens: 4096
    },
    {
      agentId: 'hermes',
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'low', budgetTokens: THINKING_BUDGET_TOKENS.low, collapseInUI: true },
      temperature: 0.3,
      maxOutputTokens: 8192
    },
    {
      agentId: 'marvis',
      providerId: 'hunyuan',
      modelId: 'hunyuan-turbos-latest',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'low', collapseInUI: true },
      temperature: 0.3,
      maxOutputTokens: 8192
    },
    {
      agentId: 'minimax-code',
      providerId: 'minimax',
      modelId: 'MiniMax-M2.7',
      // 默认 StdIO 直连桌面版内置 opencode（吃桌面版登录态，无需 API Key）
      protocol: 'stdio-plain',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'medium', collapseInUI: true },
      temperature: 0.2,
      maxOutputTokens: 8192
    }
  ]
}

export function migrateDefaultHttpBindingsToLocalCli(bindings: AgentRouteBinding[]): AgentRouteBinding[] {
  return bindings.map(binding => {
    const defaultCodexHttp =
      binding.agentId === 'codex' &&
      (!binding.protocol || binding.protocol === 'http') &&
      binding.providerId === DEFAULT_CODEX_PROVIDER_ID &&
      binding.modelId === DEFAULT_CODEX_MODEL_ID
    const defaultClaudeHttp =
      binding.agentId === 'claude' &&
      (!binding.protocol || binding.protocol === 'http') &&
      binding.providerId === DEFAULT_CLAUDE_PROVIDER_ID &&
      binding.modelId === DEFAULT_CLAUDE_MODEL_ID

    if (!defaultCodexHttp && !defaultClaudeHttp) return binding
    return {
      ...binding,
      protocol: 'stdio-plain',
      binary: binding.binary || '',
      args: binding.args || ''
    }
  })
}

export function migrateLegacySwappedOfficialBindings(bindings: AgentRouteBinding[]): AgentRouteBinding[] {
  const codex = bindings.find(b => b.agentId === 'codex')
  const claude = bindings.find(b => b.agentId === 'claude')
  const codexLooksLegacy =
    codex?.providerId === LEGACY_CODEX_PROVIDER_ID &&
    codex?.modelId === LEGACY_CODEX_MODEL_ID
  const claudeLooksLegacy =
    claude?.providerId === LEGACY_CLAUDE_PROVIDER_ID &&
    claude?.modelId === LEGACY_CLAUDE_MODEL_ID

  if (!codexLooksLegacy || !claudeLooksLegacy) return bindings

  return bindings.map(binding => {
    if (binding.agentId === 'codex') {
      return {
        ...binding,
        providerId: DEFAULT_CODEX_PROVIDER_ID,
        modelId: DEFAULT_CODEX_MODEL_ID
      }
    }
    if (binding.agentId === 'claude') {
      return {
        ...binding,
        providerId: DEFAULT_CLAUDE_PROVIDER_ID,
        modelId: DEFAULT_CLAUDE_MODEL_ID,
        thinking: {
          ...binding.thinking,
          budgetTokens: binding.thinking.budgetTokens ?? THINKING_BUDGET_TOKENS.medium
        }
      }
    }
    return binding
  })
}

export function migrateStaleOfficialModelDefaults(bindings: AgentRouteBinding[]): AgentRouteBinding[] {
  return bindings.map(binding => {
    if ((binding.agentId === 'orbit' || binding.agentId === 'codex') &&
        binding.providerId === DEFAULT_CODEX_PROVIDER_ID &&
        binding.modelId === 'gpt-4o') {
      return { ...binding, modelId: DEFAULT_CODEX_MODEL_ID }
    }
    if (binding.agentId === 'claude' &&
        binding.providerId === DEFAULT_CLAUDE_PROVIDER_ID &&
        binding.modelId === 'claude-sonnet-4-5') {
      return { ...binding, modelId: DEFAULT_CLAUDE_MODEL_ID }
    }
    return binding
  })
}

function mergeBuiltinModels(defaultModels: ModelDefinition[], savedModels?: ModelDefinition[]): ModelDefinition[] {
  if (!savedModels || savedModels.length === 0) return defaultModels
  const byId = new Map<string, ModelDefinition>()
  for (const model of defaultModels) byId.set(model.id, model)
  for (const model of savedModels) {
    const builtin = byId.get(model.id)
    byId.set(model.id, builtin ? { ...builtin, ...model, label: model.label || builtin.label } : model)
  }
  return defaultModels
    .map(model => byId.get(model.id)!)
    .concat(savedModels.filter(model => !defaultModels.find(def => def.id === model.id)))
}

export class ProviderManager extends EventEmitter {
  private cfg: ProvidersConfig
  private secretsUnlocked = false

  constructor() {
    super()
    this.cfg = this.load()
  }

  private load(): ProvidersConfig {
    try {
      const raw = store.get(STORAGE_KEY)
      if (raw) {
        // 防御性修复：局部损坏字段单独回退，避免整体重置误丢 apiKey
        // 注意：此处保持 apiKey 为落盘形态（可能是 safeStorage 密文）；
        //       解密延后到 app ready 后的 unlockSecrets()，以免 ready 前调用 safeStorage 失败而清空密钥。
        const sane = this.sanitize(raw)
        return this.mergeWithBuiltins(sane)
      }
    } catch (e) {
      console.warn('[Providers] load failed, fallback to defaults:', e)
    }
    return defaultConfig()
  }

  /** 防御性修复存储配置结构：非数组/缺失字段回退默认，保留可用部分（不因局部损坏整体重置） */
  private sanitize(raw: any): ProvidersConfig {
    const d = defaultConfig()
    if (!raw || typeof raw !== 'object') return d
    const r: any = (raw.routing && typeof raw.routing === 'object') ? raw.routing : {}
    return {
      providers: Array.isArray(raw.providers)
        ? raw.providers.filter((p: any) => p && typeof p.id === 'string')
        : d.providers,
      routing: {
        bindings: Array.isArray(r.bindings)
          ? r.bindings.filter((b: any) => b && typeof b.agentId === 'string')
          : d.routing.bindings,
        fallbackChain: Array.isArray(r.fallbackChain) ? r.fallbackChain : d.routing.fallbackChain,
        strategy: r.strategy || d.routing.strategy
      },
      activeBindingId: typeof raw.activeBindingId === 'string' ? raw.activeBindingId : null,
      version: typeof raw.version === 'number' ? raw.version : undefined
    }
  }

  /**
   * 解密内存中的 apiKey（须在 app ready 后调用一次）。
   * 旧明文配置（无加密前缀）原样保留并在下次 save() 时自动加密（隐式迁移）。
   */
  unlockSecrets(): void {
    if (this.secretsUnlocked) return
    for (const p of this.cfg.providers) p.apiKey = decryptSecret(p.apiKey || '')
    this.secretsUnlocked = true
  }

  /** 把存储的 config 与最新的内置 Provider 合并（新增内置不丢、删除的清理） */
  private mergeWithBuiltins(stored: ProvidersConfig): ProvidersConfig {
    const defaults = defaultConfig()
    const storedProviders = new Map(stored.providers.map(p => [p.id, p]))

    const providers = defaults.providers.map(def => {
      const saved = storedProviders.get(def.id)
      if (!saved) return def
      // apiKey 必须从已存配置恢复
      return {
        ...def,
        apiKey: saved.apiKey || '',
        enabled: saved.enabled ?? def.enabled,
        baseUrl: saved.baseUrl || def.baseUrl,
        customHeaders: saved.customHeaders || def.customHeaders,
        note: saved.note || def.note,
        defaultThinking: saved.defaultThinking || def.defaultThinking,
        models: mergeBuiltinModels(def.models, saved.models)
      }
    })

    // 用户自定义的非内置 Provider 也要保留
    for (const sp of stored.providers) {
      if (!sp.builtIn && !providers.find(p => p.id === sp.id)) {
        providers.push(sp)
      }
    }

    let storedBindings = migrateStaleOfficialModelDefaults(migrateLegacySwappedOfficialBindings(
      stored.routing?.bindings?.length ? [...stored.routing.bindings] : defaults.routing.bindings
    ))
    if ((stored.version ?? 1) < 2) {
      storedBindings = migrateDefaultHttpBindingsToLocalCli(storedBindings)
    }
    // 新增内置 Agent 时补齐缺失的默认绑定（老配置升级）
    for (const db of defaults.routing.bindings) {
      if (!storedBindings.find(b => b.agentId === db.agentId)) storedBindings.push(db)
    }

    return {
      providers,
      routing: {
        bindings: storedBindings,
        fallbackChain: stored.routing?.fallbackChain || defaults.routing.fallbackChain,
        strategy: stored.routing?.strategy || defaults.routing.strategy
      },
      activeBindingId: stored.activeBindingId ?? defaults.activeBindingId
    }
  }

  private save(): void {
    // 落盘前加密 apiKey（内存 cfg 保持明文供运行时使用）。
    // encryptSecret 幂等：若 unlockSecrets 尚未执行（cfg 仍为密文），重复加密会被跳过，磁盘不被破坏。
    const persisted = JSON.parse(JSON.stringify(this.cfg)) as ProvidersConfig
    persisted.providers = persisted.providers.map(p => ({ ...p, apiKey: encryptSecret(p.apiKey || '') }))
    persisted.version = CONFIG_VERSION
    store.set(STORAGE_KEY, persisted)
    this.emit('config:changed', this.cfg)
  }
  // ---- 查询 ----
  getConfig(): ProvidersConfig {
    return JSON.parse(JSON.stringify(this.cfg))
  }

  getProviders(): ProviderDefinition[] {
    return this.cfg.providers
  }

  getEnabledProviders(): ProviderDefinition[] {
    return this.cfg.providers.filter(p => p.enabled && p.apiKey)
  }

  getProvider(id: string): ProviderDefinition | undefined {
    return this.cfg.providers.find(p => p.id === id)
  }

  getBindings(): AgentRouteBinding[] {
    return this.cfg.routing.bindings
  }

  getBinding(agentId: string): AgentRouteBinding | undefined {
    return this.cfg.routing.bindings.find(b => b.agentId === agentId)
  }

 /**解析 Agent → (Provider, Model, Thinking)完整配置；目标 Provider不可用时按 fallbackChain 回退 */
 resolveBinding(agentId: string): { provider: ProviderDefinition; model: import('./types').ModelDefinition; binding: AgentRouteBinding; thinking: ThinkingConfig } | null {
 const binding = this.getBinding(agentId)
 if (!binding) return null

 const isUsable = (p: ProviderDefinition | undefined): p is ProviderDefinition =>
 !!p && p.enabled && !!p.apiKey

 let provider = this.getProvider(binding.providerId)
 if (!isUsable(provider)) {
 for (const id of this.cfg.routing.fallbackChain) {
 const p = this.getProvider(id)
 if (isUsable(p)) {
 provider = p
 break
 }
 }
 }
 if (!provider) return null

 const model = provider.models.find(m => m.id === binding.modelId) ?? provider.models[0]
 if (!model) return null
 return { provider, model, binding, thinking: binding.thinking }
 }

  // ---- 修改 ----
  upsertProvider(p: ProviderDefinition): void {
    const idx = this.cfg.providers.findIndex(x => x.id === p.id)
    if (idx >= 0) this.cfg.providers[idx] = p
    else this.cfg.providers.push(p)
    this.save()
  }

  deleteProvider(id: string): boolean {
    const target = this.getProvider(id)
    if (!target || target.builtIn) return false
    this.cfg.providers = this.cfg.providers.filter(p => p.id !== id)
    // 清理路由
    this.cfg.routing.bindings = this.cfg.routing.bindings.filter(b => b.providerId !== id)
    this.cfg.routing.fallbackChain = this.cfg.routing.fallbackChain.filter(x => x !== id)
    this.save()
    return true
  }

  setProviderEnabled(id: string, enabled: boolean): void {
    const p = this.getProvider(id)
    if (!p) return
    p.enabled = enabled
    this.save()
  }

  setProviderApiKey(id: string, key: string): void {
    const p = this.getProvider(id)
    if (!p) return
    p.apiKey = key
    if (key && !p.enabled) p.enabled = true
    this.save()
  }

  upsertBinding(b: AgentRouteBinding): void {
    const idx = this.cfg.routing.bindings.findIndex(x => x.agentId === b.agentId)
    if (idx >= 0) this.cfg.routing.bindings[idx] = b
    else this.cfg.routing.bindings.push(b)
    this.save()
  }

  removeBinding(agentId: string): void {
    this.cfg.routing.bindings = this.cfg.routing.bindings.filter(b => b.agentId !== agentId)
    this.save()
  }

  setFallbackChain(chain: string[]): void {
    this.cfg.routing.fallbackChain = chain
    this.save()
  }

  setStrategy(s: ProvidersConfig['routing']['strategy']): void {
    this.cfg.routing.strategy = s
    this.save()
  }

  setActiveBinding(agentId: string | null): void {
    this.cfg.activeBindingId = agentId
    this.save()
  }

  setProviderThinking(providerId: string, t: ThinkingConfig): void {
    const p = this.getProvider(providerId)
    if (!p) return
    p.defaultThinking = t
    this.save()
  }

  setBindingThinking(agentId: string, t: ThinkingConfig): void {
    const b = this.getBinding(agentId)
    if (!b) return
    b.thinking = t
    this.save()
  }

  // ---- 健康检查 ----
  async checkProviderHealth(id: string): Promise<import('./types').ProviderHealth> {
    const p = this.getProvider(id)
    if (!p) return { reachable: false, status: 'error', lastCheck: Date.now(), error: 'Provider not found' }
    if (!p.apiKey) {
      const h: import('./types').ProviderHealth = { reachable: false, status: 'unauthorized', lastCheck: Date.now(), error: '未配置 API Key' }
      p.health = h
      this.save()
      return h
    }
    const start = Date.now()
    try {
      if (p.kind === 'openai' || p.kind === 'openai-compatible' || p.kind === 'custom') {
        const h = await this.checkOpenAICompatibleHealth(p, start)
        p.health = h
        this.save()
        return h
      }

      const url = this.healthUrl(p)
      const headers = this.buildHeaders(p)
      const res = await proxyFetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(8000) })
      const latencyMs = Date.now() - start
      // 401/403 = 鉴权失败：服务器虽响应，但 key 无效，不应显示为“可达/绿灯”
      const unauthorized = res.status === 401 || res.status === 403
      const h: import('./types').ProviderHealth = {
        reachable: !unauthorized && res.status < 400,
        status: unauthorized ? 'unauthorized' : (res.status < 400 ? 'ok' : 'error'),
        lastCheck: Date.now(),
        latencyMs,
        error: unauthorized ? `鉴权失败 (HTTP ${res.status})` : (res.status >= 400 ? `HTTP ${res.status}` : undefined)
      }
      p.health = h
      this.save()
      return h
    } catch (e: any) {
      const h: import('./types').ProviderHealth = { reachable: false, status: 'unreachable', lastCheck: Date.now(), latencyMs: Date.now() - start, error: e?.message || String(e) }
      p.health = h
      this.save()
      return h
    }
  }

  private async checkOpenAICompatibleHealth(p: ProviderDefinition, start: number): Promise<import('./types').ProviderHealth> {
    const headers = this.buildHeaders(p)
    const chatUrl = openAIChatCompletionsUrl(p.baseUrl)
    const fullChatEndpoint = chatUrl === p.baseUrl.trim().replace(/\/+$/g, '')
    if (fullChatEndpoint && p.models[0]?.id) {
      return this.checkOpenAIChatHealth(p, start)
    }

    const modelsUrl = openAIModelsUrl(p.baseUrl)
    let res: Response
    try {
      res = await proxyFetch(modelsUrl, { method: 'GET', headers, signal: AbortSignal.timeout(3500) })
    } catch (e) {
      if (p.models[0]?.id) return this.checkOpenAIChatHealth(p, start)
      throw e
    }
    const latencyMs = Date.now() - start
    if (res.status < 400) {
      return { reachable: true, status: 'ok', lastCheck: Date.now(), latencyMs }
    }
    if (res.status === 401 || res.status === 403) {
      return { reachable: false, status: 'unauthorized', lastCheck: Date.now(), latencyMs, error: `鉴权失败 (HTTP ${res.status})` }
    }
    if ((res.status === 404 || res.status === 405) && p.models[0]?.id) {
      return this.checkOpenAIChatHealth(p, start)
    }
    return {
      reachable: false,
      status: 'error',
      lastCheck: Date.now(),
      latencyMs,
      error: `HTTP ${res.status}`
    }
  }

  private async checkOpenAIChatHealth(p: ProviderDefinition, start: number): Promise<import('./types').ProviderHealth> {
    const model = p.models[0]?.id
    if (!model) {
      return {
        reachable: false,
        status: 'error',
        lastCheck: Date.now(),
        latencyMs: Date.now() - start,
        error: '未设置模型名'
      }
    }
    const body = {
      model,
      messages: [{ role: 'user', content: 'ping' }],
      stream: false
    }
    const res = await proxyFetch(openAIChatCompletionsUrl(p.baseUrl), {
      method: 'POST',
      headers: this.buildHeaders(p),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000)
    })
    const latencyMs = Date.now() - start
    if (res.status < 400) {
      return { reachable: true, status: 'ok', lastCheck: Date.now(), latencyMs }
    }
    if (res.status === 401 || res.status === 403) {
      return { reachable: false, status: 'unauthorized', lastCheck: Date.now(), latencyMs, error: `鉴权失败 (HTTP ${res.status})` }
    }
    const txt = await res.text().catch(() => '')
    const detail = txt ? `: ${txt.slice(0, 160)}` : ''
    return {
      reachable: false,
      status: 'error',
      lastCheck: Date.now(),
      latencyMs,
      error: `Chat Completions HTTP ${res.status}${detail}`
    }
  }

  /**
   * 从厂商 API 拉取模型列表（自动/手动）。
   * openai 兼容: GET /models → data[].id
   * anthropic:  GET /models?limit=200 → data[].{id,display_name}
   * gemini:     GET /models?pageSize=200 → models[].{name,displayName,inputTokenLimit}
   * 与现有列表按 id 合并（保留人工配置的能力标记），其余字段用启发式默认。
   */
  async fetchModels(id: string): Promise<{ ok: boolean; count?: number; error?: string }> {
    const p = this.getProvider(id)
    if (!p) return { ok: false, error: 'Provider not found' }
    if (!p.apiKey) return { ok: false, error: '未配置 API Key' }
    try {
      const base = p.baseUrl.replace(/\/$/, '')
      const url = p.kind === 'gemini'
        ? `${base}/models?key=${encodeURIComponent(p.apiKey)}&pageSize=200`
        : p.kind === 'anthropic'
          ? `${anthropicModelsUrl(p.baseUrl)}?limit=200`
          : openAIModelsUrl(p.baseUrl)
      const res = await proxyFetch(url, { method: 'GET', headers: this.buildHeaders(p), signal: AbortSignal.timeout(10000) })
      if (res.status >= 400) {
        if ((p.kind === 'openai' || p.kind === 'openai-compatible' || p.kind === 'custom') &&
            (res.status === 404 || res.status === 405) &&
            p.models.length > 0) {
          return { ok: true, count: p.models.length }
        }
        return { ok: false, error: `HTTP ${res.status}` }
      }
      const j: any = await res.json()

      let raw: Array<{ id: string; label?: string; contextWindow?: number }> = []
      if (p.kind === 'gemini') {
        raw = (j.models || [])
          .filter((m: any) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
          .map((m: any) => ({
            id: String(m.name || '').replace(/^models\//, ''),
            label: m.displayName,
            contextWindow: m.inputTokenLimit
          }))
      } else {
        raw = (j.data || []).map((m: any) => ({ id: m.id, label: m.display_name }))
      }
      raw = raw.filter(m => m.id).slice(0, 300)
      if (raw.length === 0) return { ok: false, error: '接口未返回模型' }

      const old = new Map(p.models.map(m => [m.id, m]))
      const thinkRe = /think|reason|r1|o[134](-|$)|gpt-5|claude-(opus|sonnet)-4|gemini-2\.5/i
      p.models = raw.map(m => {
        const prev = old.get(m.id)
        if (prev) return { ...prev, label: prev.label || m.label || m.id, contextWindow: m.contextWindow || prev.contextWindow }
        return {
          id: m.id,
          label: m.label || m.id,
          contextWindow: m.contextWindow || 128000,
          supportsTools: true,
          supportsVision: /vision|4o|omni|gemini|claude/i.test(m.id),
          supportsThinking: thinkRe.test(m.id)
        }
      })
      this.save()
      return { ok: true, count: p.models.length }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  }

  private healthUrl(p: ProviderDefinition): string {
    switch (p.kind) {
      case 'openai':
      case 'openai-compatible':
      case 'custom':
        return openAIModelsUrl(p.baseUrl)
      case 'anthropic':
        return anthropicModelsUrl(p.baseUrl)
      case 'gemini':
        return `${p.baseUrl.replace(/\/$/, '')}/models?key=${encodeURIComponent(p.apiKey)}`
    }
  }

  buildHeaders(p: ProviderDefinition): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(p.customHeaders || {}) }
    switch (p.kind) {
      case 'openai':
      case 'openai-compatible':
      case 'custom':
        headers['authorization'] = `Bearer ${p.apiKey}`
        break
      case 'anthropic':
        headers['x-api-key'] = p.apiKey
        headers['anthropic-version'] = '2023-06-01'
        break
      case 'gemini':
        // gemini 通过 query string 鉴权，不放 header
        break
    }
    return headers
  }
}

let _instance: ProviderManager | null = null
export function getProviderManager(): ProviderManager {
  if (!_instance) _instance = new ProviderManager()
  return _instance
}
