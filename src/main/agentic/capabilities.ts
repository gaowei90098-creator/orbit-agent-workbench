/**
 * 运行时能力模型 —— 用于「确认每个接入 agent 的真实 agent 能力」。
 *
 * 注意区分：
 *   - `caps`（agents.ts 的 coding/analysis… 标签）是展示性分类，给路由/UI 看的。
 *   - 这里的 AgentCapability 描述派发时 agent **真正能做什么**：
 *     读/写文件、执行命令、多步自驱（agentic-loop）、接收技能注入（skills）。
 *
 * 能力来源：
 *   - stdio-plain：子进程在工作区 cwd 内运行，天然可读写/执行（codex/claude 为原生 CLI agentic）。
 *   - http：自 0.3.0 起默认开启 AgentHub 原生 executor（config.mode='all'），由工具回环补齐
 *     读/写/执行/多步能力，与 codex/claude 对齐；可在能力矩阵按 agent 关闭或整体切到「按需」。
 *     安全兜底：未绑定工作区时工具回环只读（禁止写/执行）。
 *   - skills：任何 agent 都能接收注入的技能（含 codex/claude）。
 */
import { getProviderManager } from '../providers/manager'
import { getAgenticConfig } from './config'
import { AGENTS, agentName } from '../hub/agents'

export type AgentCapability = 'fs-read' | 'fs-write' | 'exec' | 'agentic-loop' | 'skills'

export const ALL_CAPABILITIES: AgentCapability[] = ['fs-read', 'fs-write', 'exec', 'agentic-loop', 'skills']

/** codex/claude：stdio 直连时走各自 CLI 的原生 agentic */
const NATIVE_CLI_AGENTS = new Set(['codex', 'claude'])

export interface AgentCapabilityState {
  agentId: string
  name: string
  protocol: 'http' | 'stdio-plain' | 'acp'
  /** stdio 原生 CLI agentic（codex/claude）或 ACP（结构化原生 agentic） */
  nativeCli: boolean
  /** HTTP 上开启了 AgentHub 自带 executor */
  httpAgentic: boolean
  capabilities: AgentCapability[]
}

/** 由（协议 + 是否开启 HTTP executor）推导真实能力集合。 */
export function capabilitiesFor(protocol: 'http' | 'stdio-plain' | 'acp', httpAgentic: boolean): AgentCapability[] {
  const caps: AgentCapability[] = ['skills'] // 任何 agent 都能接收注入的技能
  // stdio-plain / acp 天然在工作区动手；http 需开启 executor（agentic）才有
  if (protocol === 'stdio-plain' || protocol === 'acp' || httpAgentic) {
    caps.push('fs-read', 'fs-write', 'exec', 'agentic-loop')
  }
  return caps
}

/** 是否对该 agent 启用 AgentHub 原生 agentic 工具回环（仅对 HTTP 协议有意义）。 */
export function isHttpAgenticEnabled(agentId: string): boolean {
  return getAgenticConfig().isEnabled(agentId)
}

/**
 * 能力矩阵：以 manifest 已知 agent 兜底（未绑定者按 http/仅聊天展示），
 * 再用真实绑定协议覆盖。供 UI 能力矩阵与派发判定共用。
 */
export function getCapabilityMatrix(): AgentCapabilityState[] {
  const mgr = getProviderManager()
  const bindings = mgr.getBindings()
  const cfg = getAgenticConfig()
  const byId = new Map<string, AgentCapabilityState>()

  const put = (agentId: string, protocol: 'http' | 'stdio-plain' | 'acp') => {
    const httpAgentic = protocol === 'http' && cfg.isEnabled(agentId)
    byId.set(agentId, {
      agentId,
      name: agentName(agentId),
      protocol,
      // acp = 结构化原生 agentic；stdio 的 codex/claude 为原生 CLI agentic
      nativeCli: protocol === 'acp' || (protocol === 'stdio-plain' && NATIVE_CLI_AGENTS.has(agentId)),
      httpAgentic,
      capabilities: capabilitiesFor(protocol, httpAgentic)
    })
  }

  for (const a of AGENTS) put(a.id, 'http')
  for (const b of bindings) put(b.agentId, b.protocol === 'stdio-plain' ? 'stdio-plain' : b.protocol === 'acp' ? 'acp' : 'http')

  return Array.from(byId.values())
}
