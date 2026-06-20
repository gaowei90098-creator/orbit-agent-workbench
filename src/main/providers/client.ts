/**
 * 协议转换 & HTTP 客户端
 *
 * 支持：
 *   - chat_completions（OpenAI / DeepSeek / OpenRouter / 自定义）
 *   - messages（Anthropic 原生）
 *   - generate_content（Gemini）
 *
 * 思考字段处理：
 *   - OpenAI 兼容 → reasoning_effort
 *   - Anthropic → thinking: { type: 'enabled', budget_tokens }
 *   - Gemini → generationConfig.thinkingConfig（v1beta）
 */

import { AgentRouteBinding, ChatCompletionChunk, ChatCompletionMessage, ChatCompletionRequest, ModelDefinition, ProviderDefinition, ThinkingConfig, ThinkingSummary } from './types'
import { THINKING_BUDGET_TOKENS } from './presets'
import { anthropicMessagesUrl, openAIChatCompletionsUrl, openAIResponsesUrl } from './endpoints'
import { proxyFetch } from '../net/http'

export interface StreamCallbacks {
  onContent?: (delta: string) => void
  onThinking?: (delta: string) => void
  /** 上游 OpenAI 兼容流的 tool_calls 增量（原样 OpenAI 格式，供 wire 1:1 重编码） */
  onToolCallDelta?: (toolCalls: any[]) => void
  onDone?: (final: { content: string; thinking?: ThinkingSummary; usage?: any; finishReason?: string; toolCalls?: any[] }) => void
  onError?: (err: Error) => void
}

export interface CallOptions {
  messages: ChatCompletionMessage[]
  systemPrompt?: string
  /** 临时覆盖 thinking（来自 UI 切换） */
  thinkingOverride?: ThinkingConfig
  /** 临时覆盖 model（来自 UI 切换） */
  modelOverride?: string
  /** 临时覆盖 provider（来自 UI 切换） */
  providerOverride?: ProviderDefinition
  signal?: AbortSignal
  /** 工具定义（OpenAI 格式）；仅 OpenAI 兼容上游会转发，anthropic/gemini 忽略 */
  tools?: any[]
  toolChoice?: any
}

export interface ResolvedCall {
  provider: ProviderDefinition
  model: ModelDefinition
  binding: AgentRouteBinding
  thinking: ThinkingConfig
  }

export class ProviderClient {
  constructor(private provider: ProviderDefinition, private model: ModelDefinition, private binding: AgentRouteBinding, private thinking: ThinkingConfig) {}

  /** 组装 Chat Completions 风格请求（统一抽象） */
  buildRequest(messages: ChatCompletionMessage[], systemPrompt?: string, thinking: ThinkingConfig = this.thinking): ChatCompletionRequest {
    const sys = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []
    const req: ChatCompletionRequest = {
      model: this.model.id,
      messages: [...sys, ...messages],
      temperature: this.binding.temperature,
      max_tokens: this.binding.maxOutputTokens,
      stream: true,
      metadata: { agentId: this.binding.agentId, providerId: this.provider.id }
    }
    if (thinking.mode !== 'off' && this.model.supportsThinking) {
      req.reasoning_effort = thinking.level
    }
    return req
  }

  async stream(opts: CallOptions, cb: StreamCallbacks): Promise<void> {
    try {
      const provider = opts.providerOverride || this.provider
      const thinking = opts.thinkingOverride || this.thinking
      const model = this.model
      const messages = opts.messages

      if (provider.kind === 'anthropic') {
        await this.streamAnthropic(provider, model, messages, opts, thinking, cb, opts.signal)
      } else if (provider.kind === 'gemini') {
        await this.streamGemini(provider, model, messages, opts, thinking, cb, opts.signal)
      } else if (provider.kind === 'openai' && usesOpenAIResponses(model.id)) {
        await this.streamOpenAIResponses(provider, model, messages, opts, thinking, cb, opts.signal)
      } else {
        await this.streamOpenAICompat(provider, model, messages, opts, thinking, cb, opts.signal)
      }
    } catch (e: any) {
      cb.onError?.(e)
    }
  }

  // ---- OpenAI Responses API（GPT-5 系列） ----
  private async streamOpenAIResponses(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = openAIResponsesUrl(provider.baseUrl)
    const body: any = {
      model: model.id,
      input: openaiMessagesToResponsesInput(messages),
      stream: true,
      metadata: { agentId: this.binding.agentId, providerId: provider.id }
    }
    if (opts.systemPrompt) body.instructions = opts.systemPrompt
    if (this.binding.maxOutputTokens) body.max_output_tokens = this.binding.maxOutputTokens
    if (thinking.mode !== 'off' && model.supportsThinking) {
      body.reasoning = { effort: normalizeOpenAIReasoningEffort(thinking.level) }
    } else if (this.binding.temperature !== undefined) {
      body.temperature = this.binding.temperature
    }
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools.map(openaiChatToolToResponsesTool).filter(Boolean)
      if (opts.toolChoice !== undefined) body.tool_choice = opts.toolChoice
    }

    const res = await proxyFetch(url, { method: 'POST', headers: this.headersFor(provider), body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`OpenAI Responses HTTP ${res.status}: ${txt.slice(0, 300)}`)
    }

    let content = ''
    let usage: any = undefined
    let finishReason: string | undefined
    const toolAcc = new Map<string, { index: number; id: string; type: 'function'; function: { name: string; arguments: string } }>()
    let toolSeq = 0

    await this.readSse(res.body, (evt) => {
      if (!evt || evt === '[DONE]') return
      try {
        const obj = JSON.parse(evt)
        const type = obj.type || obj.event
        if ((type === 'response.output_text.delta' || type === 'response.text.delta') && typeof obj.delta === 'string') {
          content += obj.delta
          cb.onContent?.(obj.delta)
        }
        if ((type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') && typeof obj.delta === 'string') {
          cb.onThinking?.(obj.delta)
        }
        if (type === 'response.output_item.added' && obj.item?.type === 'function_call') {
          const key = String(obj.item.call_id || obj.item.id || obj.output_index || toolSeq)
          toolAcc.set(key, {
            index: toolSeq++,
            id: String(obj.item.call_id || obj.item.id || key),
            type: 'function',
            function: { name: String(obj.item.name || 'unknown'), arguments: String(obj.item.arguments || '') }
          })
        }
        if (type === 'response.function_call_arguments.delta') {
          const key = String(obj.call_id || obj.item_id || obj.output_index || '')
          const existing = toolAcc.get(key) || {
            index: toolSeq++,
            id: key || `call-${toolSeq}`,
            type: 'function' as const,
            function: { name: String(obj.name || 'unknown'), arguments: '' }
          }
          existing.function.arguments += obj.delta || ''
          toolAcc.set(key || existing.id, existing)
        }
        if (type === 'response.output_item.done' && obj.item?.type === 'function_call') {
          const key = String(obj.item.call_id || obj.item.id || obj.output_index || '')
          const existing = toolAcc.get(key) || {
            index: toolSeq++,
            id: String(obj.item.call_id || obj.item.id || key || `call-${toolSeq}`),
            type: 'function' as const,
            function: { name: String(obj.item.name || 'unknown'), arguments: '' }
          }
          existing.function.name = String(obj.item.name || existing.function.name)
          existing.function.arguments = String(obj.item.arguments || existing.function.arguments || '')
          toolAcc.set(key || existing.id, existing)
        }
        if (type === 'response.completed' && obj.response) {
          usage = normalizeUsage(obj.response.usage)
          finishReason = responseFinishReason(obj.response)
          const fromOutput = responsesToolCalls(obj.response.output || [])
          for (const tc of fromOutput) if (!toolAcc.has(tc.id)) toolAcc.set(tc.id, tc)
        }
      } catch {}
    })

    const toolCalls = Array.from(toolAcc.values()).sort((a, b) => a.index - b.index)
    cb.onDone?.({
      content,
      usage,
      finishReason: toolCalls.length ? 'tool_calls' : finishReason,
      toolCalls: toolCalls.length ? toolCalls : undefined
    })
  }

  // ---- OpenAI 兼容（含 OpenAI / DeepSeek / OpenRouter / 自定义） ----
  private async streamOpenAICompat(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = openAIChatCompletionsUrl(provider.baseUrl)
    const body: any = this.buildRequest(messages, opts.systemPrompt, thinking)
    body.stream_options = { include_usage: true }   // 让上游在末尾 chunk 返回 usage
    if (opts.tools && opts.tools.length) {           // 工具透传（仅 OpenAI 兼容上游，1:1 转发）
      body.tools = opts.tools
      if (opts.toolChoice !== undefined) body.tool_choice = opts.toolChoice
    }
    const headers = this.headersFor(provider)
    const res = await proxyFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} from ${provider.name}: ${txt.slice(0, 200)}`)
    }
    let content = ''
    let usage: any = undefined
    let finishReason: string | undefined
    const toolAcc: any[] = []   // 按 index 累积流式 tool_calls（id/name 仅首帧，arguments 拼接）
    await this.readSse(res.body, (evt) => {
      if (!evt || evt === '[DONE]') return
      try {
        const chunk: ChatCompletionChunk = JSON.parse(evt)
        const u = (chunk as any).usage
        if (u) usage = normalizeUsage(u)
        const fr = chunk.choices?.[0]?.finish_reason
        if (fr) finishReason = normFinish(fr)
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) { content += delta.content; cb.onContent?.(delta.content) }
        if (delta?.reasoning_content) cb.onThinking?.(delta.reasoning_content)
        if (delta?.tool_calls && delta.tool_calls.length) {
          accumulateToolCalls(toolAcc, delta.tool_calls)
          cb.onToolCallDelta?.(delta.tool_calls)
        }
      } catch {}
    })
    cb.onDone?.({ content, usage, finishReason, toolCalls: toolAcc.length ? toolAcc : undefined })
  }

  // ---- Anthropic Messages ----
  private async streamAnthropic(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = anthropicMessagesUrl(provider.baseUrl)
    const headers = this.headersFor(provider)
    const sysText = opts.systemPrompt || ''
    const supportsThinking = model.supportsThinking && provider.capabilities.nativeThinking
    const wantThink = thinking.mode !== 'off' && supportsThinking
    const budget = thinking.budgetTokens ?? THINKING_BUDGET_TOKENS[thinking.level] ?? THINKING_BUDGET_TOKENS.medium

    const body: any = {
      model: model.id,
      max_tokens: this.binding.maxOutputTokens ?? 8192,
      stream: true,
      messages: openaiMessagesToAnthropic(messages)
    }
    if (sysText) body.system = sysText
    if (wantThink) body.thinking = { type: 'enabled', budget_tokens: budget }
    if (this.binding.temperature !== undefined && !wantThink) body.temperature = this.binding.temperature
    if (opts.tools && opts.tools.length) body.tools = openaiToolsToAnthropic(opts.tools)  // 工具支持（Claude-B 新增）

    const res = await proxyFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Anthropic HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }

    let content = ''
    let thinkingTxt = ''
    let thinkingStartedAt: number | null = null
    let inputTokens = 0
    let outputTokens = 0
    let stopReason: string | undefined
    const toolAcc: any[] = []   // 按 content block index 累积 tool_use（id/name 在 start，input 拼 partial_json）
    await this.readSse(res.body, (evt) => {
      if (!evt) return
      // readSse 已剥离 "data: " 前缀；兼容两种形态再解析（Claude-B 加固）
      const payload = evt.startsWith('data: ') ? evt.slice(6).trim() : evt.trim()
      if (!payload) return
      try {
        const obj = JSON.parse(payload)
        if (obj.type === 'content_block_start') {
          if (obj.content_block?.type === 'thinking') thinkingStartedAt = Date.now()
          if (obj.content_block?.type === 'tool_use') {
            toolAcc[obj.index] = { index: obj.index, id: obj.content_block.id, type: 'function', function: { name: obj.content_block.name, arguments: '' } }
          }
        }
        if (obj.type === 'content_block_delta') {
          if (obj.delta?.type === 'thinking_delta' && obj.delta?.thinking) {
            thinkingTxt += obj.delta.thinking
            cb.onThinking?.(obj.delta.thinking)
          }
          if (obj.delta?.type === 'text_delta' && obj.delta?.text) {
            content += obj.delta.text
            cb.onContent?.(obj.delta.text)
          }
          if (obj.delta?.type === 'input_json_delta' && toolAcc[obj.index]) {
            toolAcc[obj.index].function.arguments += obj.delta.partial_json || ''
          }
        }
        // usage：message_start 带 input_tokens，message_delta 带累计 output_tokens
        if (obj.type === 'message_start' && obj.message?.usage) {
          inputTokens = obj.message.usage.input_tokens ?? inputTokens
          outputTokens = obj.message.usage.output_tokens ?? outputTokens
        }
        if (obj.type === 'message_delta') {
          if (obj.usage) outputTokens = obj.usage.output_tokens ?? outputTokens
          if (obj.delta?.stop_reason) stopReason = obj.delta.stop_reason
        }
      } catch {}
    })

    const toolCalls = toolAcc.filter(Boolean)
    cb.onDone?.({
      content,
      usage: normalizeUsage({ input_tokens: inputTokens, output_tokens: outputTokens }),
      finishReason: normFinish(stopReason),
      toolCalls: toolCalls.length ? toolCalls : undefined,
      thinking: thinkingTxt ? {
        enabled: true,
        level: thinking.level,
        budget,
        preview: thinkingTxt.slice(0, 280),
        durationMs: thinkingStartedAt ? Date.now() - thinkingStartedAt : undefined
      } : undefined
    })
  }

  // ---- Gemini generateContent (stream via SSE) ----
  private async streamGemini(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = `${provider.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey)}`
    const headers = this.headersFor(provider)
    const sysText = opts.systemPrompt
    const contents = openaiMessagesToGemini(messages)
    const body: any = { contents }
    if (sysText) body.systemInstruction = { role: 'system', parts: [{ text: sysText }] }
    if (opts.tools && opts.tools.length) body.tools = [{ functionDeclarations: openaiToolsToGemini(opts.tools) }]  // 工具支持（Claude-B 新增）
    if (model.supportsThinking && thinking.mode !== 'off') {
      const budget = thinking.budgetTokens ?? THINKING_BUDGET_TOKENS[thinking.level] ?? THINKING_BUDGET_TOKENS.medium
      body.generationConfig = { thinkingConfig: { thinkingBudget: budget }, maxOutputTokens: this.binding.maxOutputTokens ?? 8192 }
    } else if (this.binding.maxOutputTokens) {
      body.generationConfig = { maxOutputTokens: this.binding.maxOutputTokens }
    }

    const res = await proxyFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }

    let content = ''
    let thinkingTxt = ''
    let usageMeta: any = undefined
    let geminiFinish: string | undefined
    const toolAcc: any[] = []   // functionCall part 累积（Gemini 无 id，按序号生成稳定 id）
    await this.readSse(res.body, (evt) => {
      if (!evt) return
      const payload = evt.startsWith('data: ') ? evt.slice(6).trim() : evt.trim()  // readSse 已剥前缀，加固兼容
      if (!payload) return
      try {
        const obj = JSON.parse(payload)
        if (obj.usageMetadata) usageMeta = obj.usageMetadata
        const fr = obj.candidates?.[0]?.finishReason
        if (fr) geminiFinish = normFinish(fr)
        const parts = obj.candidates?.[0]?.content?.parts || []
        for (const part of parts) {
          if (part.functionCall) {
            toolAcc.push({ index: toolAcc.length, id: 'gcall-' + toolAcc.length, type: 'function', function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) } })
          } else if (part.text && part.thought) {
            thinkingTxt += part.text
            cb.onThinking?.(part.text)
          } else if (part.text) {
            content += part.text
            cb.onContent?.(part.text)
          }
        }
      } catch {}
    })
    cb.onDone?.({
      content,
      usage: normalizeUsage(usageMeta),
      finishReason: toolAcc.length ? 'tool_calls' : geminiFinish,
      toolCalls: toolAcc.length ? toolAcc : undefined,
      thinking: thinkingTxt ? {
        enabled: true,
        level: thinking.level,
        preview: thinkingTxt.slice(0, 280)
      } : undefined
    })
  }

  private headersFor(p: ProviderDefinition): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', ...(p.customHeaders || {}) }
    if (p.kind === 'openai' || p.kind === 'openai-compatible' || p.kind === 'custom') { if (p.apiKey) { h['authorization'] = 'Bearer ' + p.apiKey } else { delete h['authorization'] } } else if (p.kind === 'anthropic') { if (p.apiKey) { h['x-api-key'] = p.apiKey } else { delete h['x-api-key'] } h['anthropic-version'] = '2023-06-01' }
    return h
  }

  private async readSse(body: ReadableStream<Uint8Array>, onEvent: (data: string) => void): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const evt = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLine = evt.split('\n').filter(l => l.startsWith('data: ')).join('\n')
        const cleaned = dataLine.replace(/^data: /gm, '').trim()
        onEvent(cleaned)
      }
    }
  }
}

/**
 * 把各家 usage 归一为 OpenAI 形状 { prompt_tokens, completion_tokens, total_tokens }。
 * 兼容 OpenAI(prompt/completion/total)、Anthropic(input/output)、Gemini(promptTokenCount…)。
 * 全为空时返回 undefined（表示上游未提供用量）。
 */
/** 按 index 合并 OpenAI 流式 tool_calls 增量：id/type/name 取首个非空，arguments 逐帧拼接。 */
function accumulateToolCalls(acc: any[], deltas: any[]): void {
  for (const d of deltas) {
    const i = typeof d.index === 'number' ? d.index : acc.length
    if (!acc[i]) acc[i] = { index: i, id: d.id, type: d.type || 'function', function: { name: '', arguments: '' } }
    if (d.id) acc[i].id = d.id
    if (d.type) acc[i].type = d.type
    if (d.function?.name) acc[i].function.name = d.function.name
    if (typeof d.function?.arguments === 'string') acc[i].function.arguments += d.function.arguments
  }
}

/* ---------- 工具/消息跨协议转换（Claude-B 新增，纯函数，便于单测） ---------- */

/** OpenAI 工具定义 → Anthropic tools 形状。 */
export function openaiToolsToAnthropic(tools: any[]): any[] {
  return (tools || []).filter(t => t?.function).map(t => ({
    name: t.function.name,
    description: t.function.description || '',
    input_schema: t.function.parameters || { type: 'object', properties: {} }
  }))
}

/** OpenAI 工具定义 → Gemini functionDeclarations 形状。 */
export function openaiToolsToGemini(tools: any[]): any[] {
  return (tools || []).filter(t => t?.function).map(t => ({
    name: t.function.name,
    description: t.function.description || '',
    parameters: t.function.parameters || { type: 'object', properties: {} }
  }))
}

function usesOpenAIResponses(modelId: string): boolean {
  return /^gpt-5/i.test(modelId)
}

function normalizeOpenAIReasoningEffort(level: ThinkingConfig['level']): string {
  if (level === 'minimal') return 'minimal'
  if (level === 'xhigh') return 'high'
  return level
}

function openaiChatToolToResponsesTool(tool: any): any | null {
  if (!tool?.function?.name) return null
  return {
    type: 'function',
    name: tool.function.name,
    description: tool.function.description || '',
    parameters: tool.function.parameters || { type: 'object', properties: {} }
  }
}

function openaiMessagesToResponsesInput(messages: ChatCompletionMessage[]): any[] {
  const input: any[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      input.push({ role: 'system', content: [{ type: 'input_text', text: m.content || '' }] })
      continue
    }
    if (m.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content || '' })
      continue
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      if (m.content) input.push({ role: 'assistant', content: [{ type: 'output_text', text: m.content }] })
      for (const tc of m.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.function?.name || 'unknown',
          arguments: tc.function?.arguments || '{}'
        })
      }
      continue
    }
    input.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{
        type: m.role === 'assistant' ? 'output_text' : 'input_text',
        text: m.content || ''
      }]
    })
  }
  return input
}

function responsesToolCalls(output: any[]): Array<{ index: number; id: string; type: 'function'; function: { name: string; arguments: string } }> {
  return (output || [])
    .map((item: any, index: number) => item?.type === 'function_call' ? {
      index,
      id: String(item.call_id || item.id || `call-${index}`),
      type: 'function' as const,
      function: { name: String(item.name || 'unknown'), arguments: String(item.arguments || '{}') }
    } : null)
    .filter(Boolean) as Array<{ index: number; id: string; type: 'function'; function: { name: string; arguments: string } }>
}

function responseFinishReason(response: any): string | undefined {
  if (!response) return undefined
  if ((response.output || []).some((item: any) => item?.type === 'function_call')) return 'tool_calls'
  return normFinish(response.status === 'completed' ? 'stop' : response.status)
}

/** 从 assistant.tool_calls 收集 id→工具名（供 tool 结果按名回灌，Gemini 用）。 */
function toolNameById(messages: ChatCompletionMessage[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) if (tc.id && tc.function?.name) map[tc.id] = tc.function.name
    }
  }
  return map
}

/** OpenAI 形状 messages → Anthropic messages（连续 tool_result 合并到同一 user 消息）。 */
export function openaiMessagesToAnthropic(messages: ChatCompletionMessage[]): any[] {
  const out: any[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content || '' }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && last._toolGroup) last.content.push(block)
      else out.push({ role: 'user', content: [block], _toolGroup: true })
      continue
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const blocks: any[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls) {
        let input: any = {}
        try { input = JSON.parse(tc.function?.arguments || '{}') } catch { input = {} }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input })
      }
      out.push({ role: 'assistant', content: blocks })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out.map(({ _toolGroup, ...rest }) => rest)
}

/** OpenAI 形状 messages → Gemini contents（tool 结果转 functionResponse，按 id→name 匹配）。 */
export function openaiMessagesToGemini(messages: ChatCompletionMessage[]): any[] {
  const nameById = toolNameById(messages)
  const out: any[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      const name = (m.tool_call_id && nameById[m.tool_call_id]) || 'tool'
      const part = { functionResponse: { name, response: { result: m.content || '' } } }
      const last = out[out.length - 1]
      if (last && last._fnGroup) last.parts.push(part)
      else out.push({ role: 'user', parts: [part], _fnGroup: true })
      continue
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const parts: any[] = []
      if (m.content) parts.push({ text: m.content })
      for (const tc of m.tool_calls) {
        let args: any = {}
        try { args = JSON.parse(tc.function?.arguments || '{}') } catch { args = {} }
        parts.push({ functionCall: { name: tc.function?.name, args } })
      }
      out.push({ role: 'model', parts })
      continue
    }
    out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })
  }
  return out.map(({ _fnGroup, ...rest }) => rest)
}

/** 把各家结束原因归一为 OpenAI 取向的中性值：stop | length | tool_calls | content_filter。 */
function normFinish(raw: any): string | undefined {
  if (!raw) return undefined
  const s = String(raw).toLowerCase()
  if (s === 'max_tokens' || s === 'length') return 'length'
  if (s === 'tool_use' || s === 'tool_calls' || s === 'function_call') return 'tool_calls'
  if (s === 'content_filter' || s === 'safety' || s === 'recitation') return 'content_filter'
  // end_turn / stop / stop_sequence / STOP / 其它 → stop
  return 'stop'
}

function normalizeUsage(u: any): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined {
  if (!u) return undefined
  const prompt = u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount
  const completion = u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount
  const total = u.total_tokens ?? u.totalTokenCount ?? (prompt !== undefined || completion !== undefined ? (prompt ?? 0) + (completion ?? 0) : undefined)
  if (prompt === undefined && completion === undefined && total === undefined) return undefined
  return { prompt_tokens: prompt ?? 0, completion_tokens: completion ?? 0, total_tokens: total ?? 0 }
}

export function buildProviderClient(resolved: ResolvedCall): ProviderClient {
  return new ProviderClient(resolved.provider, resolved.model, resolved.binding, resolved.thinking)
}
