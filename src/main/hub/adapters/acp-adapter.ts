/**
 * ACP agent 适配器 —— 用 AcpClient 把支持 ACP 的本地 CLI（hermes/openclaw/opencode）
 * 接入 AgentHub。与 oneshot stdio adapter 不同：ACP server 常驻，靠 session/prompt 的
 * stopReason 判完成。dispatcher 走专用 sendToAgentAcp 路径调用 runPrompt（不走 oneshot send）。
 *
 * 第一阶段：每次派发结束后 stop() 杀掉 server（无状态泄漏，简单正确）；server 复用 + 会话
 * 记忆作为后续优化。
 */
import { existsSync } from 'node:fs'
import { AcpClient, AcpPromptHandlers } from './acp-client'
import { locateHermesBinary, locateOpenclawBinary, locateMinimaxCodeBinary } from '../agent-locator'

/** 各 agent 的 ACP 启动默认：binary 自动探测 + `acp` 子命令参数。未知 agent → null。 */
export function acpDefaults(agentId: string): { binary: string; args: string[] } | null {
  switch (agentId) {
    case 'minimax-code': return { binary: locateMinimaxCodeBinary() || 'opencode', args: ['acp'] }
    case 'hermes': return { binary: locateHermesBinary() || 'hermes', args: ['acp', '--accept-hooks'] }
    case 'openclaw': return { binary: locateOpenclawBinary() || 'openclaw', args: ['acp'] }
    default: return null
  }
}

const ACP_ENV: Record<string, string> = { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' }

export class AcpAgentAdapter {
  id: string
  name: string
  binary: string
  protocol = 'acp' as const
  mode = 'interactive' as const
  status: 'idle' | 'busy' | 'error' = 'idle'
  onOutput: ((chunk: string) => void) | null = null
  onError: ((err: Error) => void) | null = null

  private acpArgs: string[]
  private client: AcpClient | null = null
  private currentSession: string | null = null

  constructor(id: string, name: string, binary: string, acpArgs: string[]) {
    this.id = id
    this.name = name
    this.binary = binary
    this.acpArgs = acpArgs
  }

  /** 预检：完整路径二进制需存在（裸命令交给 spawn 时再报错）。 */
  async start(): Promise<void> {
    if (this.binary && /[\\/]/.test(this.binary) && !existsSync(this.binary)) {
      this.status = 'error'
      throw new Error(this.name + ' ACP 二进制不存在: ' + this.binary + '（设置→路由→填写完整路径或留空自动探测）')
    }
    this.status = 'idle'
  }

  async stop(): Promise<void> {
    if (this.client) { this.client.stop(); this.client = null }
    this.currentSession = null
    this.status = 'idle'
  }

  /** AgentAdapter 接口要求；ACP 不走 oneshot send，dispatcher 用 runPrompt。 */
  send(_prompt: string): void { /* no-op：ACP 走 runPrompt */ }

  /** 中断当前轮（发 session/cancel）。 */
  cancel(): void {
    if (this.client && this.currentSession) this.client.cancel(this.currentSession)
  }

  /** 一轮 ACP 对话：确保 server 起 + initialize → session/new(cwd) → session/prompt → stopReason。 */
  async runPrompt(text: string, cwd: string, handlers: AcpPromptHandlers): Promise<string> {
    await this.ensureStarted(cwd)
    const client = this.client!
    const sid = await client.newSession(cwd)
    this.currentSession = sid
    this.status = 'busy'
    try {
      return await client.prompt(sid, text, handlers)
    } finally {
      this.currentSession = null
      this.status = 'idle'
    }
  }

  private async ensureStarted(cwd: string): Promise<void> {
    if (this.client?.running) return
    this.client = new AcpClient(this.binary, this.acpArgs, ACP_ENV)
    this.client.onCrash = (e) => { this.status = 'error'; if (this.onError) this.onError(e) }
    await this.client.start(cwd)
  }
}
