/**
 * AgentHub 原生 agentic 开关配置
 *
 * 记录哪些「HTTP 绑定」的 agent 开启了 AgentHub 自带的 agentic 工具回环
 * ——让纯 HTTP 聊天模型也能在工作区读写文件、跑命令，对齐 codex/claude。
 * stdio-plain 的 agent 走各自 CLI 原生 agentic，不在此登记。
 *
 * v2（0.3.0）：默认对「所有」HTTP agent 开启（mode='all'），以实现全员能力对齐；
 * 用户可整体切到「按需」（mode='selected'）或对个别 agent 显式停用。
 *   - mode='all'    ：除 `disabled` 名单外，所有 HTTP agent 都启用 agentic。
 *   - mode='selected'：仅 `selected` 名单内的 agent 启用。
 * 安全兜底不变：未绑定工作区时工具回环只读（禁止写文件/执行命令，见 executor/tools）。
 *
 * 落盘 key: `agentic.v1`（沿用旧 key，内部 version 升到 2 并自动迁移 v1 的 httpEnabled）。
 */
import { store } from '../store'
import { AGENTS } from '../hub/agents'

const STORAGE_KEY = 'agentic.v1'

export type AgenticMode = 'all' | 'selected'

interface PersistedShape {
  version: 2
  mode: AgenticMode
  /** mode='selected' 时的启用名单 */
  selected: string[]
  /** mode='all' 时的显式停用名单 */
  disabled: string[]
}

const DEFAULT: PersistedShape = { version: 2, mode: 'all', selected: [], disabled: [] }

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

class AgenticConfig {
  private read(): PersistedShape {
    const raw: any = store.get(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return { ...DEFAULT }
    // v1 迁移：{ version:1, httpEnabled:[] } → 尊重旧的「显式开启」语义，落到 selected 模式
    if (raw.version === 1 || Array.isArray(raw.httpEnabled)) {
      return { version: 2, mode: 'selected', selected: asStringArray(raw.httpEnabled), disabled: [] }
    }
    const mode: AgenticMode = raw.mode === 'selected' ? 'selected' : 'all'
    return { version: 2, mode, selected: asStringArray(raw.selected), disabled: asStringArray(raw.disabled) }
  }

  private write(s: PersistedShape): void {
    store.set(STORAGE_KEY, s)
  }

  getMode(): AgenticMode {
    return this.read().mode
  }

  setMode(mode: AgenticMode): AgenticMode {
    const s = this.read()
    s.mode = mode === 'selected' ? 'selected' : 'all'
    this.write(s)
    return s.mode
  }

  /** 当前实际启用 agentic 的 agentId 列表（按 manifest 已知 agent 推导）。 */
  getEnabled(): string[] {
    const s = this.read()
    if (s.mode === 'selected') return [...s.selected]
    return AGENTS.map(a => a.id).filter(id => !s.disabled.includes(id))
  }

  isEnabled(agentId: string): boolean {
    const s = this.read()
    return s.mode === 'selected' ? s.selected.includes(agentId) : !s.disabled.includes(agentId)
  }

  setEnabled(agentId: string, on: boolean): string[] {
    const s = this.read()
    if (s.mode === 'selected') {
      const has = s.selected.includes(agentId)
      if (on && !has) s.selected.push(agentId)
      else if (!on && has) s.selected = s.selected.filter(x => x !== agentId)
    } else {
      // mode='all'：开 = 移出停用名单；关 = 加入停用名单
      const blocked = s.disabled.includes(agentId)
      if (on && blocked) s.disabled = s.disabled.filter(x => x !== agentId)
      else if (!on && !blocked) s.disabled.push(agentId)
    }
    this.write(s)
    return this.getEnabled()
  }
}

let instance: AgenticConfig | null = null

export function getAgenticConfig(): AgenticConfig {
  if (!instance) instance = new AgenticConfig()
  return instance
}

export { DEFAULT as AGENTIC_CONFIG_DEFAULT }
