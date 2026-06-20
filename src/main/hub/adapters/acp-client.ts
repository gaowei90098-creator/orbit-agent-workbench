/**
 * ACP（Agent Client Protocol）客户端 —— JSON-RPC 2.0 over stdio（NDJSON）。
 *
 * 统一接入支持 ACP 的本地 agent CLI（hermes acp / openclaw acp / opencode acp）：
 * 一套客户端即可拿到结构化活动（工具调用 / 文件改动 / 思考 / 正文），不靠脆弱的文本逆向。
 *
 * 生命周期：start()=spawn server + `initialize` 握手 → newSession(cwd)=`session/new` →
 * prompt(sessionId, text, handlers)=`session/prompt`，期间消费 `session/update` 通知，
 * 直到收到 prompt 响应里的 `stopReason`。cancel() 发 `session/cancel`。
 *
 * clientCapabilities.fs=true 时，`fs/read_text_file` / `fs/write_text_file` 由 AgentHub 在工作区内执行；
 * 收到 `session/request_permission` 时把写/执行权限请求桥接到 AgentHub 审批门禁。
 */
import { spawn, ChildProcess } from 'node:child_process'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'

export interface AcpActivityStep {
  id: string
  kind?: string
  tool?: string
  label?: string
  detail?: string
  output?: string
  status: 'running' | 'done' | 'error'
}

export interface MappedUpdate {
  content?: string
  thinking?: string
  steps?: AcpActivityStep[]
}

export interface AcpPromptHandlers {
  onChunk?: (text: string) => void
  onThought?: (text: string) => void
  onActivity?: (step: AcpActivityStep) => void
  onRequestPermission?: (req: AcpPermissionRequest) => Promise<boolean>
}

export interface AcpPermissionRequest {
  tool: 'write' | 'exec' | null
  toolName: string
  label: string
  detail: string
  raw: any
}

export interface AcpFileResult {
  ok: boolean
  path?: string
  content?: string
  error?: string
}

const STATUS_MAP: Record<string, 'running' | 'done' | 'error'> = {
  pending: 'running',
  in_progress: 'running',
  completed: 'done',
  failed: 'error'
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** ContentBlock / 内容块数组 → 纯文本（ACP 文本块为 {type:'text', text}）。 */
export function acpBlockText(c: any): string {
  if (!c) return ''
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(acpBlockText).join('')
  if (c.type === 'text') return c.text || ''
  return ''
}

/** tool_call(_update) 的 content[] → 摘要文本（content 块取文本；diff 块取路径 + 新内容预览）。 */
export function acpToolContent(content: any): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (!item) continue
    if (item.type === 'content') parts.push(acpBlockText(item.content))
    else if (item.type === 'diff') parts.push(`--- ${item.path}\n${clip(item.newText ?? '', 300)}`)
  }
  return clip(parts.filter(Boolean).join('\n'), 800)
}

/**
 * ACP `session/update` 的 `update` 对象 → AgentHub 活动模型（纯函数，便于单测）。
 * 复用既有活动步骤卡形状（与 claude-stream-json 的 ActivityStepLike 对齐）。
 * 未呈现的类型（plan / user_message_chunk / 其它）返回 null。
 */
export function mapAcpUpdate(update: any): MappedUpdate | null {
  if (!update || typeof update !== 'object') return null
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const t = acpBlockText(update.content)
      return t ? { content: t } : null
    }
    case 'agent_thought_chunk': {
      const t = acpBlockText(update.content)
      return t ? { thinking: t } : null
    }
    case 'tool_call': {
      if (!update.toolCallId) return null
      const loc = Array.isArray(update.locations) && update.locations[0]?.path
      const detail = update.rawInput ? clip(safeJson(update.rawInput), 400) : (loc || '')
      return {
        steps: [{
          id: String(update.toolCallId),
          kind: 'tool',
          tool: update.kind || 'tool',
          label: update.title || update.kind || 'tool',
          detail: detail || undefined,
          status: STATUS_MAP[update.status] || 'running'
        }]
      }
    }
    case 'tool_call_update': {
      if (!update.toolCallId) return null
      const out = acpToolContent(update.content)
      return {
        steps: [{
          id: String(update.toolCallId),
          status: STATUS_MAP[update.status] || 'running',
          output: out || undefined
        }]
      }
    }
    default:
      return null
  }
}

function safeJson(v: any): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

function firstString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function hasAnyKey(obj: any, keys: string[]): boolean {
  if (!obj || typeof obj !== 'object') return false
  return keys.some(k => Object.prototype.hasOwnProperty.call(obj, k))
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !rel.startsWith('../') && !isAbsolute(rel))
}

function firstExistingAncestor(path: string): string | null {
  let cur = path
  for (let i = 0; i < 64; i++) {
    try {
      statSync(cur)
      return cur
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return null
      cur = parent
    }
  }
  return null
}

export function acpResolveWorkspacePath(root: string, requested: unknown): AcpFileResult {
  if (typeof requested !== 'string' || !requested.trim()) return { ok: false, error: 'path must be a non-empty string' }
  const rootAbs = resolve(root)
  let rootReal: string
  try { rootReal = realpathSync(rootAbs) } catch { return { ok: false, error: 'workspace root is not accessible' } }
  const raw = requested.trim()
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(rootReal, raw)
  // On macOS tmp paths often enter through /var while realpath resolves to
  // /private/var. Accept lexical containment in the user-facing root first, then
  // verify the existing ancestor against the real root below to catch symlinks.
  if (!isWithin(rootAbs, abs) && !isWithin(rootReal, abs)) return { ok: false, error: 'path escapes the workspace' }
  const ancestor = firstExistingAncestor(abs)
  if (!ancestor) return { ok: false, error: 'path has no existing ancestor' }
  let ancestorReal: string
  try { ancestorReal = realpathSync(ancestor) } catch { return { ok: false, error: 'path ancestor is not accessible' } }
  if (!isWithin(rootReal, ancestorReal)) return { ok: false, error: 'path escapes the workspace through a symlink' }
  return { ok: true, path: abs }
}

export function acpReadTextFile(root: string, params: any): AcpFileResult {
  const resolved = acpResolveWorkspacePath(root, params?.path)
  if (!resolved.ok || !resolved.path) return resolved
  let content: string
  try {
    const st = statSync(resolved.path)
    if (!st.isFile()) return { ok: false, error: 'not a file' }
    content = readFileSync(resolved.path, 'utf-8')
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  const line = Number(params?.line)
  const limit = Number(params?.limit)
  if (Number.isFinite(line) || Number.isFinite(limit)) {
    const lines = content.split(/\r?\n/)
    const start = Number.isFinite(line) ? Math.max(0, Math.floor(line) - 1) : 0
    const end = Number.isFinite(limit) ? start + Math.max(0, Math.floor(limit)) : undefined
    content = lines.slice(start, end).join('\n')
  }
  return { ok: true, path: resolved.path, content }
}

export function acpWriteTextFile(root: string, params: any): AcpFileResult {
  const resolved = acpResolveWorkspacePath(root, params?.path)
  if (!resolved.ok || !resolved.path) return resolved
  if (typeof params?.content !== 'string') return { ok: false, error: 'content must be a string' }
  try {
    mkdirSync(dirname(resolved.path), { recursive: true })
    writeFileSync(resolved.path, params.content, 'utf-8')
    return { ok: true, path: resolved.path }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function acpPermissionRequest(params: any): AcpPermissionRequest {
  const toolCall = params?.toolCall || params?.tool_call || params?.tool || params?.call || {}
  const input = toolCall.rawInput || toolCall.input || params?.rawInput || params?.input || {}
  const toolName = firstString(
    toolCall.kind,
    toolCall.name,
    toolCall.tool,
    params?.kind,
    params?.toolName,
    params?.permission,
    params?.action
  ) || 'tool'
  const label = firstString(toolCall.title, params?.title, params?.description, toolName)
  const haystack = [
    toolName,
    label,
    params?.description,
    params?.action,
    params?.permission,
    input?.command,
    input?.cmd,
    input?.shell
  ].filter(Boolean).join(' ').toLowerCase()

  let tool: AcpPermissionRequest['tool'] = null
  if (/\b(exec|bash|shell|terminal|command|run_command|run)\b/.test(haystack) || typeof input?.command === 'string') {
    tool = 'exec'
  } else if (
    /\b(write|edit|modify|delete|create|save|patch|apply_patch|move|rename)\b/.test(haystack) ||
    hasAnyKey(input, ['content', 'newText', 'oldText', 'edits', 'patch', 'diff'])
  ) {
    tool = 'write'
  } else if (/\b(read|list|grep|glob|search|view)\b/.test(haystack)) {
    tool = null
  }

  const detail = clip(
    firstString(input?.command, input?.path, input?.file_path, input?.filepath) ||
    (Object.keys(input || {}).length ? safeJson(input) : safeJson(params)),
    800
  )

  return { tool, toolName, label, detail, raw: params }
}

type Pending = { resolve: (v: any) => void; reject: (e: any) => void }

/**
 * 一个 ACP server 子进程的 JSON-RPC 客户端。一个 AcpClient 实例对应一个常驻 server，
 * 跨多次 prompt 复用（session 每次 prompt 新建，第一阶段不复用会话记忆）。
 */
export class AcpClient {
  private proc: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buf = ''
  private decoder = new TextDecoder('utf-8')
  private initResult: any = null
  /** 当前活跃 prompt 的 update 处理器（按 sessionId） */
  private promptHandlers = new Map<string, AcpPromptHandlers>()
  /** ACP sessionId → workspace root，用于 client fs handler 的沙箱边界。 */
  private sessionRoots = new Map<string, string>()
  /** server 崩溃 / 退出回调（adapter 用于把错误外显） */
  onCrash: ((e: Error) => void) | null = null

  constructor(
    private binary: string,
    private args: string[],
    private env?: Record<string, string>
  ) {}

  get running(): boolean { return !!this.proc }
  get agentCapabilities(): any { return this.initResult?.agentCapabilities ?? null }

  /** spawn server 并完成 initialize 握手。幂等：已启动则直接返回。 */
  async start(cwd?: string): Promise<void> {
    if (this.proc) return
    const proc = spawn(this.binary, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: cwd || undefined,
      env: { ...process.env, ...(this.env || {}) },
      windowsHide: true
    })
    this.proc = proc
    proc.stdout?.on('data', (d: Buffer) => this.onStdout(d))
    proc.stderr?.on('data', () => { /* server 端日志：忽略；崩溃由 exit 处理 */ })
    proc.on('error', (e: Error) => this.handleExit(e))
    proc.on('exit', (code) => this.handleExit(new Error(`ACP server '${this.binary}' 退出（code ${code}）`)))

    this.initResult = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: 'AgentHub', version: '0.5.2' }
    })
  }

  /** 新建会话，返回 sessionId。 */
  async newSession(cwd: string): Promise<string> {
    const res = await this.request('session/new', { cwd, mcpServers: [] })
    const sid = res?.sessionId
    if (!sid) throw new Error('ACP session/new 未返回 sessionId')
    const sessionId = String(sid)
    this.sessionRoots.set(sessionId, cwd)
    return sessionId
  }

  /** 发一轮 prompt，消费 session/update 直到 prompt 响应返回 stopReason。 */
  async prompt(sessionId: string, text: string, handlers: AcpPromptHandlers): Promise<string> {
    this.promptHandlers.set(sessionId, handlers)
    try {
      const res = await this.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }]
      })
      return res?.stopReason || 'end_turn'
    } finally {
      this.promptHandlers.delete(sessionId)
    }
  }

  /** 中断当前轮（通知，无响应）。 */
  cancel(sessionId: string): void {
    this.notify('session/cancel', { sessionId })
  }

  stop(): void {
    const p = this.proc
    this.proc = null
    if (p?.pid) {
      try { p.kill() } catch { /* noop */ }
    }
  }

  /* ---------------- JSON-RPC 收发 ---------------- */

  private request(method: string, params: any): Promise<any> {
    if (!this.proc) return Promise.reject(new Error('ACP server 未启动'))
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.proc!.stdin?.write(payload)
      } catch (e) {
        this.pending.delete(id)
        reject(e)
      }
    })
  }

  private notify(method: string, params: any): void {
    if (!this.proc) return
    try {
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
    } catch { /* noop */ }
  }

  private respond(id: number | string, result: any): void {
    if (!this.proc) return
    try {
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
    } catch { /* noop */ }
  }

  private respondError(id: number | string, code: number, message: string): void {
    if (!this.proc) return
    try {
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
    } catch { /* noop */ }
  }

  private onStdout(d: Buffer): void {
    this.buf += this.decoder.decode(d, { stream: true })
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (line) this.handleMessage(line)
    }
  }

  /** 处理一条 JSON-RPC 消息（response / agent→client request / notification）。 */
  private handleMessage(line: string): void {
    let msg: any
    try { msg = JSON.parse(line) } catch { return } // 非 JSON 行（server 偶发日志）跳过
    if (!msg || typeof msg !== 'object') return

    // 1) response（带 id + result/error，无 method）
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error?.message || 'ACP error ' + safeJson(msg.error)))
      else p.resolve(msg.result)
      return
    }

    // 2) agent→client request（带 id + method）：request_permission / fs/* 等
    if (msg.id !== undefined && typeof msg.method === 'string') {
      this.handleServerRequest(msg)
      return
    }

    // 3) notification（无 id）：session/update 等
    if (typeof msg.method === 'string') {
      this.handleNotification(msg)
    }
  }

  private handleServerRequest(msg: any): void {
    if (msg.method === 'session/request_permission') {
      void this.handlePermissionRequest(msg)
      return
    }
    if (msg.method === 'fs/read_text_file') {
      const root = this.sessionRoots.get(String(msg.params?.sessionId || ''))
      if (!root) return this.respondError(msg.id, -32000, 'unknown ACP session')
      const res = acpReadTextFile(root, msg.params)
      if (res.ok) this.respond(msg.id, { content: res.content ?? '' })
      else this.respondError(msg.id, -32000, res.error || 'read_text_file failed')
      return
    }
    if (msg.method === 'fs/write_text_file') {
      void this.handleWriteTextFileRequest(msg)
      return
    }
    this.respondError(msg.id, -32601, 'method not supported by client')
  }

  private async handleWriteTextFileRequest(msg: any): Promise<void> {
    const sid = String(msg.params?.sessionId || '')
    const root = this.sessionRoots.get(sid)
    if (!root) return this.respondError(msg.id, -32000, 'unknown ACP session')

    const handler = this.promptHandlers.get(sid)?.onRequestPermission
    if (!handler) return this.respondError(msg.id, -32000, 'write_text_file requires an active prompt approval context')

    let approved = false
    try {
      approved = await handler({
        tool: 'write',
        toolName: 'fs/write_text_file',
        label: 'Write file',
        detail: firstString(msg.params?.path) || safeJson(msg.params),
        raw: msg.params
      })
    } catch {
      approved = false
    }
    if (!approved) return this.respondError(msg.id, -32000, 'write_text_file denied by approval policy')

    const res = acpWriteTextFile(root, msg.params)
    if (res.ok) this.respond(msg.id, null)
    else this.respondError(msg.id, -32000, res.error || 'write_text_file failed')
  }

  private async handlePermissionRequest(msg: any): Promise<void> {
    const opts: any[] = Array.isArray(msg.params?.options) ? msg.params.options : []
    const pick = opts.find(o => o.kind === 'allow_once') || opts.find(o => o.kind === 'allow_always') || opts[0]
    const deny = opts.find(o => /deny|reject/i.test(String(o.kind || o.optionId || o.name || '')))
    const req = acpPermissionRequest(msg.params)
    let approved = true
    const sid = msg.params?.sessionId
    const handler = sid ? this.promptHandlers.get(sid)?.onRequestPermission : undefined
    if (handler && req.tool) {
      try { approved = await handler(req) } catch { approved = false }
    }
    if (approved && pick) {
      this.respond(msg.id, { outcome: { outcome: 'selected', optionId: pick.optionId } })
    } else if (!approved && deny) {
      this.respond(msg.id, { outcome: { outcome: 'selected', optionId: deny.optionId } })
    } else {
      this.respond(msg.id, { outcome: { outcome: 'cancelled' } })
    }
  }

  private handleNotification(msg: any): void {
    if (msg.method !== 'session/update') return
    const sid = msg.params?.sessionId
    const handlers = sid ? this.promptHandlers.get(sid) : undefined
    if (!handlers) return
    const mapped = mapAcpUpdate(msg.params?.update)
    if (!mapped) return
    if (mapped.content && handlers.onChunk) handlers.onChunk(mapped.content)
    if (mapped.thinking && handlers.onThought) handlers.onThought(mapped.thinking)
    if (mapped.steps && handlers.onActivity) for (const s of mapped.steps) handlers.onActivity(s)
  }

  private handleExit(err: Error): void {
    this.proc = null
    this.initResult = null
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
    this.promptHandlers.clear()
    this.sessionRoots.clear()
    if (this.onCrash) this.onCrash(err)
  }
}
