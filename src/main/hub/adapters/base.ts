export { BaseAgentAdapter } from "./agent-adapter"
export type { AgentAdapter } from "./agent-adapter"
import { StdioAgentAdapter } from "./stdio-adapter"
import { CodexAdapter } from "./codex"
import { ClaudeAdapter } from "./claude"
import { HermesAdapter } from "./hermes"
import { OpenClawAdapter } from "./openclaw"
import { MarvisAdapter } from "./marvis"
import { MinimaxCodeAdapter } from "./minimax-code"
import { AcpAgentAdapter, acpDefaults } from "./acp-adapter"



export interface AgentAdapter {
  id: string
  name: string
  binary: string
  protocol: "stdio-ndjson" | "stdio-plain" | "http" | "acp"
  mode: "interactive" | "oneshot"
  start(): Promise<void>
  stop(): Promise<void>
  send(prompt: string): void
  onOutput: ((chunk: string) => void) | null
  onError: ((err: Error) => void) | null
  status: "idle" | "busy" | "error"
}


/**
 * Provider-driven Adapter.
 * Real HTTP dispatch lives in Dispatcher/ProviderClient; this adapter exists for
 * backwards compatibility with the stdio AgentRegistry contract.
 */
export class HttpAgentAdapter implements AgentAdapter {
  id: string
  name: string
  binary = "provider"
  protocol = "http" as const
  mode = "oneshot" as const
  status: "idle" | "busy" | "error" = "idle"
  onOutput: ((chunk: string) => void) | null = null
  onError: ((err: Error) => void) | null = null

  constructor(id: string, name: string) {
    this.id = id
    this.name = name
  }

  async start(): Promise<void> { this.status = "idle" }
  async stop(): Promise<void> { this.status = "idle" }
  send(_prompt: string, _opts?: { cwd?: string | null }): void { /* real dispatch happens through Dispatcher.dispatch() */ }
}

/**
 * Factory: 根据 binding.protocol 决定实例化哪种 adapter。
 * - protocol 缺省或 http        → HttpAgentAdapter (走 Dispatcher → ProviderClient → LLM HTTP)
 * - protocol === stdio-plain    → 对应 agent 的 stdio adapter (spawn 本地 CLI 二进制, oneshot)
 * 四个内置 Agent（codex/claude/hermes/openclaw）均支持 stdio-plain;
 * 未知 agentId 走 stdio 会回退到 http 并在控制台告警。
 * binary / args 来自路由绑定, 缺省时各 adapter 自动探测/用默认参数。
 */
const STDIO_FACTORIES: Record<string, () => StdioAgentAdapter> = {
  codex: () => new CodexAdapter(),
  claude: () => new ClaudeAdapter(),
  hermes: () => new HermesAdapter(),
  openclaw: () => new OpenClawAdapter(),
  marvis: () => new MarvisAdapter(),
  'minimax-code': () => new MinimaxCodeAdapter()
}

export function createAdapter(
  agentId: string,
  agentName: string,
  protocol?: "http" | "stdio-plain" | "acp",
  binary?: string,
  args?: string[]
): AgentAdapter {
  if (protocol === "acp") {
    const d = acpDefaults(agentId)
    const bin = (binary && binary.trim()) || d?.binary || agentId
    const acpArgs = (args && args.length > 0) ? args : (d?.args || ["acp"])
    return new AcpAgentAdapter(agentId, agentName, bin, acpArgs)
  }
  if (protocol === "stdio-plain") {
    const make = STDIO_FACTORIES[agentId]
    if (make) {
      const a = make()
      if (binary && binary.trim()) a.binary = binary.trim()
      if (args && args.length > 0) a.execArgs = args
      return a
    }
    console.warn("[createAdapter] stdio-plain not implemented for agent " + agentId + ", falling back to http")
  }
  return new HttpAgentAdapter(agentId, agentName)
}
