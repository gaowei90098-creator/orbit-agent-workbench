/**
 * AgentHub 原生 agentic 工具回环的「写 / 执行」审批门禁（Item K）。
 *
 * 在 0.3.0「默认全员可写/执行」的基础上补一道细粒度闸门：对受管工具
 * （fs_write / exec）按 per-agent × per-tool 策略放行：
 *   - 'allow'：直接执行（默认，零回归——与 0.3.0 行为一致）
 *   - 'deny' ：拒绝执行，把拒绝信息回灌模型（让它换一种方式或收尾）
 *   - 'ask'  ：运行时逐次请求用户审批（dispatcher 经 IPC 弹窗），批准才执行
 *
 * 只读工具（fs_read / fs_list）永不门禁。未绑定工作区时工具回环本就只读
 * （见 tools.ts / executor.ts），审批是叠加其上的二级闸门。
 *
 * 规则（allow/deny）与弹窗（ask）共用同一份策略：'ask' 即「需逐次弹窗」。
 *
 * 落盘 key：agentic.approval.v1
 */
import { store } from '../store'

const STORAGE_KEY = 'agentic.approval.v1'

export type ApprovalPolicy = 'allow' | 'ask' | 'deny'
export type GuardedTool = 'write' | 'exec'

export const GUARDED_TOOLS: GuardedTool[] = ['write', 'exec']

/** 把工具内部名映射到受管类别；只读工具（fs_read/fs_list）→ null（永不门禁）。 */
export function guardedToolFor(name: string): GuardedTool | null {
  if (name === 'fs_write') return 'write'
  if (name === 'exec') return 'exec'
  return null
}

/** 运行时一次审批请求（executor → dispatcher → 渲染层弹窗）。 */
export interface ApprovalRequest {
  /** 关联的活动步骤 id（与 activity step.id 一致，便于 UI 对应） */
  stepId: string
  agentId: string
  tool: GuardedTool
  /** 工具内部名（fs_write / exec） */
  toolName: string
  label: string
  detail: string
}

export interface PersistedApproval {
  version: 1
  default: Record<GuardedTool, ApprovalPolicy>
  overrides: Record<string, Partial<Record<GuardedTool, ApprovalPolicy>>>
}

const DEFAULT: PersistedApproval = {
  version: 1,
  default: { write: 'allow', exec: 'allow' },
  overrides: {}
}

function normPolicy(v: unknown, fallback: ApprovalPolicy): ApprovalPolicy {
  return v === 'allow' || v === 'ask' || v === 'deny' ? v : fallback
}

class ApprovalConfig {
  private read(): PersistedApproval {
    const raw: any = store.get(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return cloneDefault()
    const def: Record<GuardedTool, ApprovalPolicy> = {
      write: normPolicy(raw.default?.write, 'allow'),
      exec: normPolicy(raw.default?.exec, 'allow')
    }
    const overrides: PersistedApproval['overrides'] = {}
    if (raw.overrides && typeof raw.overrides === 'object') {
      for (const [agentId, o] of Object.entries<any>(raw.overrides)) {
        if (!o || typeof o !== 'object') continue
        const entry: Partial<Record<GuardedTool, ApprovalPolicy>> = {}
        if (o.write !== undefined) entry.write = normPolicy(o.write, def.write)
        if (o.exec !== undefined) entry.exec = normPolicy(o.exec, def.exec)
        if (Object.keys(entry).length) overrides[agentId] = entry
      }
    }
    return { version: 1, default: def, overrides }
  }

  private write(s: PersistedApproval): void {
    store.set(STORAGE_KEY, s)
  }

  getConfig(): PersistedApproval {
    return this.read()
  }

  /** per-agent 覆盖优先，否则回落全局默认。 */
  policyFor(agentId: string, tool: GuardedTool): ApprovalPolicy {
    const s = this.read()
    return s.overrides[agentId]?.[tool] ?? s.default[tool]
  }

  setDefault(tool: GuardedTool, policy: ApprovalPolicy): PersistedApproval {
    const s = this.read()
    s.default[tool] = normPolicy(policy, s.default[tool])
    this.write(s)
    return s
  }

  /** policy=null → 清除该 agent 在该工具上的覆盖（回落默认）。 */
  setOverride(agentId: string, tool: GuardedTool, policy: ApprovalPolicy | null): PersistedApproval {
    const s = this.read()
    const entry = s.overrides[agentId] || {}
    if (policy === null) delete entry[tool]
    else entry[tool] = normPolicy(policy, s.default[tool])
    if (Object.keys(entry).length) s.overrides[agentId] = entry
    else delete s.overrides[agentId]
    this.write(s)
    return s
  }
}

function cloneDefault(): PersistedApproval {
  return { version: 1, default: { ...DEFAULT.default }, overrides: {} }
}

let instance: ApprovalConfig | null = null

export function getApprovalConfig(): ApprovalConfig {
  if (!instance) instance = new ApprovalConfig()
  return instance
}

export { DEFAULT as APPROVAL_CONFIG_DEFAULT }
