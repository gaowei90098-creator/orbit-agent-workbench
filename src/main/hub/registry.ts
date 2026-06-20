import { EventEmitter } from "events"
import { AgentAdapter, HttpAgentAdapter } from "./adapters/base"

export type AgentStatus = "idle" | "busy" | "error" | "offline"

export interface AgentInfo {
  id: string
  name: string
  status: AgentStatus
  mode: "interactive" | "oneshot"
  protocol: "stdio-ndjson" | "stdio-plain" | "http" | "acp"
  adapter: AgentAdapter
  capabilities: string[]
  lastActive: Date
  errorCount: number
  providerId?: string
  modelId?: string
}

export class AgentRegistry extends EventEmitter {
  private agents: Map<string, AgentInfo> = new Map()

  register(adapter: AgentAdapter, capabilities: string[] = [], providerId?: string, modelId?: string): AgentInfo {
    const info: AgentInfo = {
      id: adapter.id,
      name: adapter.name,
      status: "idle",
      mode: adapter.mode,
      protocol: adapter.protocol,
      adapter,
      capabilities,
      lastActive: new Date(),
      errorCount: 0,
      providerId,
      modelId
    }
    this.agents.set(adapter.id, info)
    this.emit("agent:registered", info)
    return info
  }

  /** Register an HTTP-backed agent from a provider binding */
  registerHttpAgent(agentId: string, agentName: string, capabilities: string[], providerId: string, modelId: string): AgentInfo {
    const adapter = new HttpAgentAdapter(agentId, agentName)
    return this.register(adapter, capabilities, providerId, modelId)
  }

  unregister(id: string): void {
    const info = this.agents.get(id)
    if (info) {
      this.agents.delete(id)
      this.emit("agent:unregistered", id)
    }
  }

  get(id: string): AgentInfo | undefined {
    return this.agents.get(id)
  }

  getAll(): AgentInfo[] {
    return Array.from(this.agents.values())
  }

  setStatus(id: string, status: AgentStatus): void {
    const info = this.agents.get(id)
    if (info) {
      info.status = status
      if (status === "busy") info.lastActive = new Date()
      this.emit("agent:status", { id, status })
    }
  }

  incrementError(id: string): void {
    const info = this.agents.get(id)
    if (info) {
      info.errorCount++
      this.emit("agent:status", { id, status: "error" })
    }
  }

  getByCapability(capability: string): AgentInfo[] {
    return this.getAll().filter(a => a.capabilities.includes(capability))
  }

  async startAll(): Promise<void> {
    for (const [, info] of this.agents) {
      try {
        await info.adapter.start()
        info.status = "idle"
      } catch {
        info.status = "error"
        info.errorCount++
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [, info] of this.agents) {
      try { await info.adapter.stop() } catch {}
      info.status = "offline"
    }
  }
}
