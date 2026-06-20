/**
 * 本地路由代理（对标 CC Switch「本地路由与高可用」）
 *
 * 入站双协议：
 *   - OpenAI 兼容   POST /v1/chat/completions   （Codex / OpenCode 等接管入口）
 *   - Anthropic 原生 POST /v1/messages           （Claude Code 接管入口）
 * 出站经 ProviderClient 做格式转换（chat_completions / messages / generate_content），
 * 因此 DeepSeek、Gemini 等任意已配置厂商都能伺服两种协议的客户端。
 *
 * 高可用：
 *   - 模型未匹配时走默认路由（messages→claude 绑定，chat/completions→codex 绑定，再退到首个可用厂商）
 *   - 故障转移：按 routing.fallbackChain 依次重试（仅在尚未向客户端输出任何字节时切换）
 *   - 熔断：同一厂商连续失败 3 次后跳过 60s，成功即复位
 *
 * 接管方式（见 设置→代理）：
 *   Claude Code:  ANTHROPIC_BASE_URL=http://127.0.0.1:9528  ANTHROPIC_AUTH_TOKEN=agenthub
 *   Codex:        config.toml 自定义 model_provider，base_url=http://127.0.0.1:9528/v1
 *   模型名可用 "provider/model"（如 deepseek/deepseek-chat）精确指路，未知名称走默认路由。
 */
import * as http from "http"
import { EventEmitter } from "events"
import { URL } from "url"
import { getProviderManager } from "../providers/manager"
import { buildProviderClient, ProviderClient } from "../providers/client"
import { ChatCompletionMessage, ChatCompletionRequest, ProviderDefinition, ModelDefinition, ThinkingConfig } from "../providers/types"

interface Candidate {
  provider: ProviderDefinition
  model: ModelDefinition
  agentId: string
  thinking: ThinkingConfig
  temperature?: number
  maxOutputTokens?: number
}

interface InboundOverrides {
  temperature?: number
  maxTokens?: number
  /** 入站工具定义（OpenAI 格式）；透传给 OpenAI 兼容上游 */
  tools?: any[]
  toolChoice?: any
}

const BREAK_AFTER_FAILS = 3
const BREAK_FOR_MS = 60_000

export class LocalProxy extends EventEmitter {
  private server: http.Server | null = null
  private port: number
  /** 熔断状态：providerId → 连续失败次数/恢复时间 */
  private breaker: Map<string, { fails: number; untilTs: number }> = new Map()

  constructor(port = 9528) {
    super()
    this.port = port
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res))
      this.server.on("error", reject)
      this.server.listen(this.port, "127.0.0.1", () => {
        console.log("[Proxy] OpenAI 兼容: http://127.0.0.1:" + this.port + "/v1 · Anthropic 兼容: http://127.0.0.1:" + this.port)
        resolve()
      })
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  getUrl(): string {
    return "http://127.0.0.1:" + this.port + "/v1"
  }

  /** Anthropic SDK 会自行拼 /v1/messages，所以 base 是源站地址 */
  getOrigin(): string {
    return "http://127.0.0.1:" + this.port
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", "http://127.0.0.1:" + this.port)
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : ""
    // 仅放行本机来源（含无 Origin 的 CLI 客户端）；跨站浏览器请求被 CORS + 显式 403 双重拦截
    const isLocalOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    const cors: Record<string, string> = {
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-api-key,anthropic-version,anthropic-beta",
      "access-control-max-age": "86400",
      "vary": "Origin"
    }
    if (origin && isLocalOrigin) cors["access-control-allow-origin"] = origin
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors)
      res.end()
      return
    }
    // 防御 CSRF：拒绝带非本机 Origin 的请求（恶意网页 fetch 127.0.0.1）；CLI 无 Origin 不受影响
    if (!isLocalOrigin) {
      res.writeHead(403, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "forbidden: cross-site origin not allowed" } }))
      return
    }
    for (const k of Object.keys(cors)) res.setHeader(k, cors[k])

    try {
      if (url.pathname === "/v1/models" && req.method === "GET") return this.listModels(res)
      if (url.pathname === "/v1/providers" && req.method === "GET") return this.listProviders(res)
      if (url.pathname === "/v1/chat/completions" && req.method === "POST") return this.chatCompletions(req, res, false)
      if (url.pathname === "/v1/chat/completions/no-stream" && req.method === "POST") return this.chatCompletions(req, res, true)
      if (url.pathname === "/v1/messages" && req.method === "POST") return this.anthropicMessages(req, res)
      if (url.pathname === "/v1/messages/count_tokens" && req.method === "POST") return this.countTokens(req, res)
      if (url.pathname === "/v1/route" && req.method === "POST") return this.route(req, res)
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true, ts: Date.now() }))
        return
      }
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "not found", path: url.pathname } }))
    } catch (e: any) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: { message: e?.message || String(e) } }))
      } else {
        try { res.end() } catch { /* noop */ }
      }
    }
  }

  /* ---------------- 熔断 ---------------- */

  private breakerOpen(providerId: string): boolean {
    const s = this.breaker.get(providerId)
    return !!s && s.fails >= BREAK_AFTER_FAILS && Date.now() < s.untilTs
  }

  private breakerFail(providerId: string): void {
    const s = this.breaker.get(providerId) || { fails: 0, untilTs: 0 }
    s.fails++
    if (s.fails >= BREAK_AFTER_FAILS) s.untilTs = Date.now() + BREAK_FOR_MS
    this.breaker.set(providerId, s)
  }

  private breakerSuccess(providerId: string): void {
    this.breaker.delete(providerId)
  }

  /* ---------------- 路由解析 ---------------- */

  private usable(p?: ProviderDefinition | null): p is ProviderDefinition {
    return !!p && p.enabled && !!p.apiKey && p.models.length > 0
  }

  /**
   * 组装候选链：首选 → fallbackChain → （仍为空时）任意可用厂商。
   * fallback 厂商若有同名模型用同名，否则用其第一个模型。
   */
  private buildCandidates(primary: Candidate | null, modelIdHint?: string): Candidate[] {
    const mgr = getProviderManager()
    const out: Candidate[] = []
    const seen = new Set<string>()
    const push = (c: Candidate | null) => {
      if (!c || seen.has(c.provider.id)) return
      seen.add(c.provider.id)
      out.push(c)
    }
    push(primary)
    const chain = mgr.getConfig().routing.fallbackChain || []
    for (const id of chain) {
      const p = mgr.getProvider(id)
      if (!this.usable(p)) continue
      const model = (modelIdHint && p.models.find(m => m.id === modelIdHint)) || p.models[0]
      push({ provider: p, model, agentId: "proxy-fallback", thinking: p.defaultThinking })
    }
    if (out.length === 0) {
      for (const p of mgr.getProviders()) {
        if (this.usable(p)) {
          push({ provider: p, model: p.models[0], agentId: "proxy-any", thinking: p.defaultThinking })
          break
        }
      }
    }
    return out
  }

  /** "provider/model" 精确引用 / 全局模型名匹配 / agent 绑定默认路由
   *  也接受 "provider:model" 别名（OpenClaw 等模型 id 不允许斜杠的场景） */
  private resolvePrimary(modelRef: string | undefined, preferAgent: string): Candidate | null {
    const mgr = getProviderManager()
    if (modelRef && !modelRef.includes("/") && modelRef.includes(":")) {
      modelRef = modelRef.replace(":", "/")
    }
    if (modelRef) {
      if (modelRef.startsWith("agent/")) {
        const r = mgr.resolveBinding(modelRef.slice(6))
        if (r) return { provider: r.provider, model: r.model, agentId: r.binding.agentId, thinking: r.thinking, temperature: r.binding.temperature, maxOutputTokens: r.binding.maxOutputTokens }
      }
      if (modelRef.includes("/")) {
        const i = modelRef.indexOf("/")
        const p = mgr.getProvider(modelRef.slice(0, i))
        if (this.usable(p)) {
          const m = p.models.find(mm => mm.id === modelRef.slice(i + 1))
          if (m) return { provider: p, model: m, agentId: "proxy-" + p.id, thinking: p.defaultThinking }
        }
      }
      for (const p of mgr.getProviders()) {
        if (!this.usable(p)) continue
        const m = p.models.find(mm => mm.id === modelRef)
        if (m) return { provider: p, model: m, agentId: "proxy-" + p.id, thinking: p.defaultThinking }
      }
    }
    // 未匹配 → 协议对应 agent 的绑定（resolveBinding 自带不可用回退）
    const r = mgr.resolveBinding(preferAgent)
    if (r) return { provider: r.provider, model: r.model, agentId: r.binding.agentId, thinking: r.thinking, temperature: r.binding.temperature, maxOutputTokens: r.binding.maxOutputTokens }
    return null
  }

  /* ---------------- OpenAI 兼容入站 ---------------- */

  private async chatCompletions(req: http.IncomingMessage, res: http.ServerResponse, forceNoStream: boolean): Promise<void> {
    const body = await readBody(req)
    let parsed: ChatCompletionRequest
    try { parsed = JSON.parse(body) } catch {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "invalid json" } }))
      return
    }
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "messages required" } }))
      return
    }
    const noStream = forceNoStream || parsed.stream === false
    // 抽取 system（出站 anthropic/gemini 需要独立 system 字段）
    const sysParts: string[] = []
    const rest: ChatCompletionMessage[] = []
    for (const m of parsed.messages) {
      if (m.role === "system") sysParts.push(typeof m.content === "string" ? m.content : JSON.stringify(m.content))
      else rest.push({ ...m, content: flattenContent(m.content) })
    }
    const primary = this.resolvePrimary(parsed.model, "codex")
    const candidates = this.buildCandidates(primary, primary?.model.id)
    if (candidates.length === 0) {
      res.writeHead(503, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "no usable provider. Configure API keys in AgentHub → 设置 → 提供商" } }))
      return
    }
    const tools = Array.isArray((parsed as any).tools) && (parsed as any).tools.length ? (parsed as any).tools : undefined
    await this.streamWithFailover(res, "openai", noStream, parsed.model || candidates[0].model.id, candidates, rest,
      sysParts.length ? sysParts.join("\n\n") : undefined,
      { temperature: parsed.temperature, maxTokens: parsed.max_tokens, tools, toolChoice: (parsed as any).tool_choice })
  }

  /* ---------------- Anthropic 原生入站（Claude Code 接管） ---------------- */

  private async anthropicMessages(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readBody(req)
    let parsed: any
    try { parsed = JSON.parse(body) } catch {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "invalid json" } }))
      return
    }
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages required" } }))
      return
    }
    const systemPrompt = flattenAnthropicSystem(parsed.system)
    // 入站工具透传：保留 tool_use / tool_result 结构（转 OpenAI 形状），client 出站再转上游协议。
    const messages = anthropicMessagesToOpenai(parsed.messages)
    const noStream = parsed.stream !== true
    const primary = this.resolvePrimary(parsed.model, "claude")
    const candidates = this.buildCandidates(primary, primary?.model.id)
    if (candidates.length === 0) {
      res.writeHead(503, { "content-type": "application/json" })
      res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "no usable provider. Configure API keys in AgentHub → 设置 → 提供商" } }))
      return
    }
    const tools = anthropicToolsToOpenai(parsed.tools)
    const toolChoice = anthropicToolChoiceToOpenai(parsed.tool_choice)
    await this.streamWithFailover(res, "anthropic", noStream, parsed.model || candidates[0].model.id, candidates, messages, systemPrompt,
      { temperature: parsed.temperature, maxTokens: parsed.max_tokens, tools, toolChoice })
  }

  private async countTokens(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readBody(req)
    let chars = body.length
    try {
      const parsed = JSON.parse(body)
      chars = JSON.stringify(parsed.messages || "").length + JSON.stringify(parsed.system || "").length
    } catch { /* 按原始长度估算 */ }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ input_tokens: Math.max(1, Math.ceil(chars / 4)) }))
  }

  /* ---------------- Agent 路由入站（AgentHub 自用） ---------------- */

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readBody(req)
    let parsed: any
    try { parsed = JSON.parse(body) } catch { parsed = {} }
    if (!parsed.agentId) {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "agentId required" } }))
      return
    }
    const primary = this.resolvePrimary("agent/" + parsed.agentId, parsed.agentId)
    const candidates = this.buildCandidates(primary, primary?.model.id)
    if (candidates.length === 0 || !Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      res.writeHead(503, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: candidates.length === 0 ? "no available provider for agent " + parsed.agentId : "messages required" } }))
      return
    }
    await this.streamWithFailover(res, "openai", !!parsed.noStream, candidates[0].model.id, candidates,
      parsed.messages, parsed.systemPrompt, {})
  }

  /* ---------------- 流式引擎：lazy 首字节 + 故障转移 ---------------- */

  private async streamWithFailover(
    res: http.ServerResponse,
    wire: "openai" | "anthropic",
    noStream: boolean,
    inboundModel: string,
    candidates: Candidate[],
    messages: ChatCompletionMessage[],
    systemPrompt: string | undefined,
    overrides: InboundOverrides
  ): Promise<void> {
    let lastErr: Error | null = null
    for (const cand of candidates) {
      if (this.breakerOpen(cand.provider.id)) continue
      const start = Date.now()
      this.emit("request", { model: cand.model.id, provider: cand.provider.id })
      try {
        await this.tryOne(res, wire, noStream, inboundModel, cand, messages, systemPrompt, overrides)
        this.breakerSuccess(cand.provider.id)
        this.emit("response", { model: cand.model.id, provider: cand.provider.id, durationMs: Date.now() - start })
        return
      } catch (e: any) {
        lastErr = e
        this.breakerFail(cand.provider.id)
        this.emit("error", { model: cand.model.id, provider: cand.provider.id, error: e?.message })
        if (e?.afterOutput) {
          // 已向客户端输出，无法切换厂商：终止响应
          try { res.end() } catch { /* noop */ }
          return
        }
        // 尚未输出 → 尝试下一个候选
      }
    }
    if (!res.headersSent) {
      const msg = lastErr?.message || "all providers failed"
      res.writeHead(502, { "content-type": "application/json" })
      res.end(wire === "anthropic"
        ? JSON.stringify({ type: "error", error: { type: "api_error", message: msg } })
        : JSON.stringify({ error: { message: msg } }))
    } else {
      try { res.end() } catch { /* noop */ }
    }
  }

  private tryOne(
    res: http.ServerResponse,
    wire: "openai" | "anthropic",
    noStream: boolean,
    inboundModel: string,
    cand: Candidate,
    messages: ChatCompletionMessage[],
    systemPrompt: string | undefined,
    overrides: InboundOverrides
  ): Promise<void> {
    const binding: any = {
      agentId: cand.agentId,
      providerId: cand.provider.id,
      modelId: cand.model.id,
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: cand.thinking,
      temperature: overrides.temperature ?? cand.temperature,
      maxOutputTokens: overrides.maxTokens ?? cand.maxOutputTokens
    }
    const client: ProviderClient = buildProviderClient({
      provider: cand.provider,
      model: cand.model,
      binding,
      thinking: cand.thinking
    })
    const emitter = wire === "anthropic"
      ? new AnthropicWire(res, inboundModel)
      : new OpenAIWire(res, inboundModel)

    let content = ""
    let thinkingTxt = ""
    let started = false

    return new Promise<void>((resolve, reject) => {
      const controller = new AbortController()
      let settled = false
      const FIRST_BYTE_MS = 45000   // 首字节超时：连上却久不出字 → 中止并故障转移
      const IDLE_MS = 90000         // 流中空闲超时：长时间无新增 → 中止
      let timer: ReturnType<typeof setTimeout> | null = null
      const arm = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { if (!settled) controller.abort() }, ms) }
      const onClose = () => { if (!settled) controller.abort() }   // 客户端断开 → 中止上游，不再写死 socket
      res.on("close", onClose)
      const cleanup = () => { if (timer) { clearTimeout(timer); timer = null } res.off("close", onClose) }
      arm(FIRST_BYTE_MS)

      client.stream(
        { messages, systemPrompt, thinkingOverride: cand.thinking, signal: controller.signal, tools: overrides.tools, toolChoice: overrides.toolChoice },
        {
          onContent: (delta) => {
            content += delta
            arm(IDLE_MS)
            if (noStream) return
            if (!started) { started = true; emitter.begin() }
            emitter.content(delta)
          },
          onThinking: (delta) => {
            thinkingTxt += delta
            arm(IDLE_MS)
            if (noStream) return
            if (!started) { started = true; emitter.begin() }
            emitter.thinking(delta)
          },
          onToolCallDelta: (tc) => {
            arm(IDLE_MS)
            if (noStream) return
            if (!started) { started = true; emitter.begin() }
            // OpenAI 入站 1:1 透传；Anthropic 入站重编码为 tool_use content block
            ;(emitter as any).toolCallDelta(tc)
          },
          onDone: (final) => {
            if (settled) return
            settled = true; cleanup()
            if (noStream) {
              emitter.json(content, thinkingTxt, final.usage, final.finishReason, final.toolCalls)
            } else {
              if (!started) { started = true; emitter.begin() }
              // toolCalls 兜底：上游 anthropic/gemini 无流式工具增量时，done 阶段补发完整 tool_use 块
              emitter.done(final.usage, final.finishReason, final.toolCalls)
            }
            resolve()
          },
          onError: (err) => {
            if (settled) return
            settled = true; cleanup()
            reject(Object.assign(err instanceof Error ? err : new Error(String(err)), { afterOutput: started }))
          }
        }
      ).catch((e) => {
        if (settled) return
        settled = true; cleanup()
        reject(Object.assign(e instanceof Error ? e : new Error(String(e)), { afterOutput: started }))
      })
    })
  }

  /* ---------------- 元数据端点 ---------------- */

  private listModels(res: http.ServerResponse): void {
    const mgr = getProviderManager()
    const data: any[] = []
    for (const p of mgr.getProviders()) {
      for (const m of p.models) {
        data.push({
          id: p.id + "/" + m.id,
          object: "model",
          created: Date.now(),
          owned_by: p.id,
          display_name: p.name + " · " + m.label,
          root: m.id,
          capabilities: {
            provider: p.id,
            providerKind: p.kind,
            thinking: m.supportsThinking,
            tools: m.supportsTools,
            vision: m.supportsVision,
            contextWindow: m.contextWindow,
            agentBinding: (mgr.getBindings().find(b => b.providerId === p.id && b.modelId === m.id) || {}).agentId || null
          }
        })
      }
    }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ object: "list", data, has_more: false }))
  }

  private listProviders(res: http.ServerResponse): void {
    const mgr = getProviderManager()
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({
      object: "list",
      data: mgr.getProviders().map(p => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        baseUrl: p.baseUrl,
        enabled: p.enabled,
        hasKey: !!p.apiKey,
        health: p.health || null,
        breakerOpen: this.breakerOpen(p.id),
        modelCount: p.models.length,
        capabilities: p.capabilities,
        defaultThinking: p.defaultThinking
      }))
    }))
  }
}

/* ============ 出站→入站协议回写 ============ */

/** OpenAI chat.completion.chunk SSE / chat.completion JSON */
class OpenAIWire {
  private id = "cmpl-" + Date.now()
  constructor(private res: http.ServerResponse, private model: string) {}

  begin(): void {
    this.res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive"
    })
  }

  private chunk(delta: any, finish: string | null = null): void {
    this.res.write("data: " + JSON.stringify({
      id: this.id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finish }]
    }) + "\n\n")
  }

  content(d: string): void { this.chunk({ content: d }) }
  thinking(d: string): void { this.chunk({ reasoning_content: d }) }
  toolCallDelta(tc: any[]): void { this.chunk({ tool_calls: tc }) }   // 1:1 透传 OpenAI 工具流增量

  // 第三参数 _toolCalls 仅为与 AnthropicWire.done 同签名；OpenAI 流式工具已经过 toolCallDelta 发出
  done(usage: any, finishReason?: string, _toolCalls?: any[]): void {
    this.chunk({}, finishReason || "stop")   // 归一值 stop|length|tool_calls|content_filter 即 OpenAI 格式
    if (usage) {
      this.res.write("data: " + JSON.stringify({
        id: this.id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
        model: this.model, choices: [], usage
      }) + "\n\n")
    }
    this.res.write("data: [DONE]\n\n")
    this.res.end()
  }

  json(content: string, thinking: string, usage: any, finishReason?: string, toolCalls?: any[]): void {
    this.res.writeHead(200, { "content-type": "application/json" })
    this.res.end(JSON.stringify({
      id: this.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{ index: 0, message: { role: "assistant", content, ...(thinking ? { reasoning_content: thinking } : {}), ...(toolCalls && toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: finishReason || "stop" }],
      usage
    }))
  }
}

/** Anthropic messages SSE（message_start → content_block_* → message_delta → message_stop）/ message JSON */
export class AnthropicWire {
  private id = "msg_agenthub_" + Date.now()
  private blockIndex = -1
  private blockType: "thinking" | "text" | "tool" | null = null
  /** OpenAI 工具 index → 已分配的 anthropic content block index（流式去重 + arguments 续写定位） */
  private toolIdxMap = new Map<number, number>()
  constructor(private res: http.ServerResponse, private model: string) {}

  private ev(event: string, data: any): void {
    this.res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n")
  }

  begin(): void {
    this.res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive"
    })
    this.ev("message_start", {
      type: "message_start",
      message: {
        id: this.id, type: "message", role: "assistant", model: this.model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    })
  }

  private openBlock(type: "thinking" | "text"): void {
    if (this.blockType === type) return
    this.closeBlock()
    this.blockIndex++
    this.blockType = type
    this.ev("content_block_start", {
      type: "content_block_start",
      index: this.blockIndex,
      content_block: type === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" }
    })
  }

  private closeBlock(): void {
    if (this.blockType === null) return
    this.ev("content_block_stop", { type: "content_block_stop", index: this.blockIndex })
    this.blockType = null
  }

  thinking(d: string): void {
    this.openBlock("thinking")
    this.ev("content_block_delta", { type: "content_block_delta", index: this.blockIndex, delta: { type: "thinking_delta", thinking: d } })
  }

  content(d: string): void {
    this.openBlock("text")
    this.ev("content_block_delta", { type: "content_block_delta", index: this.blockIndex, delta: { type: "text_delta", text: d } })
  }

  /** 上游 OpenAI 工具流增量 → anthropic tool_use content block（首帧 start + 后续 input_json_delta）。 */
  toolCallDelta(deltas: any[]): void {
    for (const d of (deltas || [])) {
      const oi = typeof d.index === "number" ? d.index : 0
      if (!this.toolIdxMap.has(oi)) {
        this.closeBlock()
        this.blockIndex++
        this.blockType = "tool"
        this.toolIdxMap.set(oi, this.blockIndex)
        this.ev("content_block_start", {
          type: "content_block_start", index: this.blockIndex,
          content_block: { type: "tool_use", id: d.id || ("call_" + this.blockIndex), name: d.function?.name || "", input: {} }
        })
      }
      const bi = this.toolIdxMap.get(oi)!
      const args = d.function?.arguments
      if (typeof args === "string" && args) {
        this.ev("content_block_delta", { type: "content_block_delta", index: bi, delta: { type: "input_json_delta", partial_json: args } })
      }
    }
  }

  done(usage: any, finishReason?: string, toolCalls?: any[]): void {
    // 上游 anthropic/gemini 无流式工具增量：收尾阶段一次性补发完整 tool_use 块（流式已发过则跳过）
    if (toolCalls && toolCalls.length && this.toolIdxMap.size === 0) {
      for (const tc of toolCalls) {
        this.closeBlock()
        this.blockIndex++
        this.blockType = "tool"
        this.ev("content_block_start", {
          type: "content_block_start", index: this.blockIndex,
          content_block: { type: "tool_use", id: tc.id || ("call_" + this.blockIndex), name: tc.function?.name || "", input: {} }
        })
        const args = typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {})
        if (args) this.ev("content_block_delta", { type: "content_block_delta", index: this.blockIndex, delta: { type: "input_json_delta", partial_json: args } })
      }
    }
    this.closeBlock()
    this.ev("message_delta", {
      type: "message_delta",
      delta: { stop_reason: anthropicStop(finishReason), stop_sequence: null },
      usage: { output_tokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0 }
    })
    this.ev("message_stop", { type: "message_stop" })
    this.res.end()
  }

  json(content: string, thinking: string, usage: any, finishReason?: string, toolCalls?: any[]): void {
    this.res.writeHead(200, { "content-type": "application/json" })
    const blocks: any[] = []
    if (thinking) blocks.push({ type: "thinking", thinking })
    if (content) blocks.push({ type: "text", text: content })
    for (const tc of (toolCalls || [])) {
      let input: any = {}
      try { input = JSON.parse(tc.function?.arguments || "{}") } catch { input = {} }
      blocks.push({ type: "tool_use", id: tc.id || ("call_" + blocks.length), name: tc.function?.name || "", input })
    }
    if (blocks.length === 0) blocks.push({ type: "text", text: "" })
    this.res.end(JSON.stringify({
      id: this.id, type: "message", role: "assistant", model: this.model,
      content: blocks, stop_reason: anthropicStop(finishReason), stop_sequence: null,
      usage: {
        input_tokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0
      }
    }))
  }
}

/* ============ 工具函数 ============ */

/** 中性结束原因 → Anthropic stop_reason */
function anthropicStop(fr?: string): string {
  if (fr === "length") return "max_tokens"
  if (fr === "tool_calls") return "tool_use"
  return "end_turn"
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

/** Anthropic system 可为 string 或 [{type:'text',text}] */
function flattenAnthropicSystem(system: any): string | undefined {
  if (!system) return undefined
  if (typeof system === "string") return system
  if (Array.isArray(system)) {
    return system.map(b => typeof b === "string" ? b : (b?.text ?? "")).filter(Boolean).join("\n\n") || undefined
  }
  return undefined
}

/** 消息 content 可为 string 或内容块数组（text / tool_result / image…），统一压平为纯文本 */
function flattenContent(content: any): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content.map(b => {
      if (typeof b === "string") return b
      if (b?.type === "text") return b.text ?? ""
      if (b?.type === "tool_result") return "[tool_result] " + flattenContent(b.content)
      if (b?.type === "tool_use") return "[tool_use:" + (b.name ?? "") + "] " + JSON.stringify(b.input ?? {})
      if (b?.type === "image" || b?.type === "image_url") return "[image]"
      return ""
    }).filter(Boolean).join("\n")
  }
  if (content == null) return ""
  return JSON.stringify(content)
}

/* ============ Anthropic 入站工具/消息 → OpenAI 中性形状（纯函数，便于单测） ============ */

/** anthropic tools [{name,description,input_schema}] → OpenAI function tools；空/无效 → undefined。 */
export function anthropicToolsToOpenai(tools: any): any[] | undefined {
  if (!Array.isArray(tools)) return undefined
  const out = tools
    .filter(t => t && typeof t.name === "string" && t.name)
    .map(t => ({
      type: "function",
      function: { name: t.name, description: t.description || "", parameters: t.input_schema || { type: "object", properties: {} } }
    }))
  return out.length ? out : undefined
}

/** anthropic tool_choice {type:auto|any|tool,name?} → OpenAI tool_choice。 */
export function anthropicToolChoiceToOpenai(tc: any): any | undefined {
  if (!tc || typeof tc !== "object") return undefined
  if (tc.type === "auto") return "auto"
  if (tc.type === "any") return "required"
  if (tc.type === "tool" && tc.name) return { type: "function", function: { name: tc.name } }
  return undefined
}

/** tool_result.content 可为 string 或内容块数组 → 纯文本。 */
export function anthropicToolResultContent(c: any): string {
  if (typeof c === "string") return c
  if (Array.isArray(c)) return c.map(b => (typeof b === "string" ? b : (b?.text ?? ""))).filter(Boolean).join("\n")
  if (c == null) return ""
  try { return JSON.stringify(c) } catch { return String(c) }
}

/** anthropic messages → OpenAI ChatCompletionMessage[]，保留 tool_use(assistant.tool_calls)/tool_result(role:'tool') 结构。 */
export function anthropicMessagesToOpenai(messages: any[]): ChatCompletionMessage[] {
  const out: ChatCompletionMessage[] = []
  for (const m of (messages || [])) {
    const role = m?.role === "assistant" ? "assistant" : "user"
    const c = m?.content
    if (typeof c === "string") { out.push({ role, content: c }); continue }
    if (!Array.isArray(c)) { out.push({ role, content: flattenContent(c) }); continue }

    if (role === "assistant") {
      let text = ""
      const toolCalls: any[] = []
      for (const b of c) {
        if (b?.type === "text") text += b.text || ""
        else if (b?.type === "tool_use") toolCalls.push({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } })
        // thinking / redacted_thinking 块不回灌给上游
      }
      const msg: ChatCompletionMessage = { role: "assistant", content: text }
      if (toolCalls.length) msg.tool_calls = toolCalls
      out.push(msg)
    } else {
      // user turn：tool_result → 独立 role:'tool' 消息（OpenAI 要求紧跟带 tool_calls 的 assistant）；text → user 消息
      const texts: string[] = []
      const toolResults: Array<{ id: string; content: string }> = []
      for (const b of c) {
        if (b?.type === "tool_result") toolResults.push({ id: b.tool_use_id, content: anthropicToolResultContent(b.content) })
        else if (b?.type === "text") texts.push(b.text || "")
        else if (typeof b === "string") texts.push(b)
      }
      for (const tr of toolResults) out.push({ role: "tool", tool_call_id: tr.id, content: tr.content })
      if (texts.length) out.push({ role: "user", content: texts.join("\n") })
      if (!toolResults.length && !texts.length) out.push({ role: "user", content: flattenContent(c) })
    }
  }
  return out
}

let _instance: LocalProxy | null = null
export function getLocalProxy(): LocalProxy {
  if (!_instance) _instance = new LocalProxy()
  return _instance
}
