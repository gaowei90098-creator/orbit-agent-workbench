import { EventEmitter } from "events"
import { AgentRegistry } from "./registry"
import { EventPipeline } from "./pipeline"
import { KeywordRouter } from "./router"
import { getProviderManager } from "../providers/manager"
import { buildProviderClient } from "../providers/client"
import {
  DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID,
  EXECUTION_WORKER_AGENT_IDS,
  MAIN_AGENT_ID,
  NOTIFICATION_BRIDGE_STORAGE_KEY,
  agentSystemPrompt
} from "./agents"
import { buildAgentRuntimeSystemPrompt, buildAgentTaskPrompt, RuntimeMemoryEntry } from "./agent-runtime"
import { decompositionPrompt, fallbackPlanArtifact, parsePlan, synthesisPrompt, verifyPrompt, parseVerdict, retryPrompt, subtaskContractPrompt, ORCHESTRATOR_LEAD_SYSTEM } from "./orchestrator"
import { ChatCompletionMessage, ThinkingConfig } from "../providers/types"
import { getWorkspaceManager } from "./workspace"
import { homedir } from "node:os"
import { store } from "../store"
import { MissionStore } from "./mission-store"
import { PlanArtifact, TaskContract, setPlanStatus } from "./plan-artifact"
import { Supervisor, SupervisorDecision, SupervisorSignalKind } from "./supervisor"
import { CollaborationBus } from "./collaboration-bus"
import { CollaborationEventTypes, agentAddress, channelAddress, humanAddress } from "./collaboration-events"
// --- AgentHub skills + native agentic (Claude-B 新增) ---
import { getSkillManager } from "../skills/manager"
import { buildSkillBlock } from "../skills/inject"
import { runAgenticHttp } from "../agentic/executor"
import { isHttpAgenticEnabled } from "../agentic/capabilities"
import { getApprovalConfig, ApprovalRequest, GuardedTool } from "../agentic/approval"
// --- /AgentHub skills + native agentic ---

export type DispatchMode = "auto" | "broadcast" | "chain" | "orchestrate"

/** stdio 路径无法像 HTTP 那样下发 reasoning 参数，开启 thinking 时改用 prompt 指令对齐行为。 */
const STDIO_THINKING_DIRECTIVE =
  "[Reasoning mode] Think through the problem step by step and weigh edge cases before answering. " +
  "Do not print raw chain-of-thought; provide the well-reasoned final result."

/** 'ask' 审批等待上限：超时自动拒绝，避免回环永久挂起（用户也可取消任务）。 */
const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000

/** 宽松判断 thinking 是否开启（兼容 {enabled} / {level} 等形态）。 */
function thinkingRequested(th: any): boolean {
  if (!th || typeof th !== "object") return false
  if (th.enabled === false) return false
  return th.enabled === true || (typeof th.level === "string" && th.level !== "off" && th.level !== "none") || !!th.budgetTokens || !!th.budget
}

function isExecutionWorkerAgent(agentId: string): boolean {
  return EXECUTION_WORKER_AGENT_IDS.includes(agentId)
}

function isBridgeRequest(text: string): boolean {
  return /通知|通报|进度|远程|手机|提醒|确认|审批|notify|progress|remote|approval/i.test(text)
}

export interface DispatchTask {
  id: string
  missionId?: string
  text: string
  mode: DispatchMode
  targetAgent?: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  results: Map<string, string>
  thinking: Map<string, string>
  errors: Map<string, string>
  usage: Map<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }>
  thinkingSummary: Map<string, { enabled: boolean; level?: string; budget?: number; preview?: string }>
  planArtifact?: PlanArtifact
  error?: string
  createdAt: Date
}

export interface DispatchOptions {
  thinking?: ThinkingConfig
  systemPrompt?: string
  /** 工作区 ID：传 null = 不绑定（沿用 home）。stdIO 派发按此取 cwd。 */
  workspaceId?: string | null
  /** 编排模式下先生成 PlanArtifact，等待用户确认后再执行子 Agent。 */
  requirePlanApproval?: boolean
}

export type StreamEvent =
  | { kind: "start"; taskId: string; agentId: string; providerId: string; modelId: string; mode: "content" | "thinking" }
  | { kind: "delta"; taskId: string; agentId: string; providerId: string; modelId: string; channel: "content" | "thinking"; text: string }
  | { kind: "done"; taskId: string; agentId: string; providerId: string; modelId: string; content: string; thinking?: string; summary?: { level?: string; budget?: number; preview?: string }; durationMs: number; usage?: any }
  | { kind: "error"; taskId: string; agentId: string; providerId?: string; modelId?: string; error: string }
  // agentic 活动步骤（stdio stream-json / 未来 HTTP act-observe 解析所得）；UI 按 step.id upsert
  | { kind: "activity"; taskId: string; agentId: string; step: { id: string; kind?: string; tool?: string; label?: string; detail?: string; output?: string; status: string } }
  // 写/执行审批请求（'ask' 策略命中时发出）；渲染层弹窗 → agentic:resolveApproval 回传决策
  | { kind: "approval"; taskId: string; agentId: string; request: { id: string; tool: GuardedTool; toolName: string; label?: string; detail?: string } }
  // 编排模式（Orchestrator）
  | { kind: "orchestrate:plan"; taskId: string; missionId?: string; leadAgentId?: string; planArtifact?: PlanArtifact; subtasks: Array<{
      id: string
      title: string
      detail?: string
      agentId?: string
      fileScope?: string[]
      dependsOn?: string[]
      doneWhen?: string
      verifyCommand?: string
      interfaceRef?: string
    }> }
  | { kind: "orchestrate:approval"; taskId: string; missionId: string; status: "awaiting" | "approved" | "rejected"; planArtifact?: PlanArtifact }
  | { kind: "orchestrate:subtask"; taskId: string; subtaskId: string; agentId?: string; status: "pending" | "running" | "done" | "error"; content?: string }
  | { kind: "orchestrate:verdict"; taskId: string; subtaskId: string; pass: boolean; note?: string; attempt: number }
  | { kind: "orchestrate:supervisor"; taskId: string; missionId: string; subtaskId: string; decision: SupervisorDecision }
  | { kind: "orchestrate:synthesizing"; taskId: string }
  | { kind: "orchestrate:final"; taskId: string; content: string }
  | { kind: "orchestrate:error"; taskId: string; error: string }

export class Dispatcher extends EventEmitter {
  private tasks: Map<string, DispatchTask> = new Map()
  private taskCounter = 0
  /** 'ask' 审批待决池：requestId → {resolve,timer}。requestId 以 `appr-<taskId>-` 前缀便于按任务清理。 */
  private pendingApprovals: Map<string, { resolve: (v: boolean) => void; timer: ReturnType<typeof setTimeout> }> = new Map()
  private pendingPlanApprovals: Map<string, { resolve: (v: boolean) => void }> = new Map()
  private approvalSeq = 0

  constructor(
    private registry: AgentRegistry,
    private pipeline: EventPipeline,
    private memoryProvider: () => RuntimeMemoryEntry[] = () => [],
    private missionStore?: MissionStore,
    private supervisor: Supervisor = new Supervisor(),
    private collaborationBus?: CollaborationBus
  ) {
    super()
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args)
  }

  on(event: "stream", listener: (e: StreamEvent) => void): this
  on(event: string, listener: (...args: any[]) => void): this
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener)
  }

  private async recordCollaboration(input: {
    type: string
    missionId?: string
    source?: string
    target?: string
    payload?: unknown
    metadata?: Record<string, unknown>
  }): Promise<void> {
    if (!this.collaborationBus) return
    try {
      await this.collaborationBus.append({
        type: input.type,
        source: input.source || agentAddress('agenthub'),
        target: input.target || (input.missionId ? channelAddress(input.missionId) : 'core'),
        missionId: input.missionId,
        channel: input.missionId,
        visibility: input.missionId ? 'channel' : 'public',
        payload: input.payload,
        metadata: input.metadata || {}
      })
    } catch (e) {
      console.warn('[Collaboration] failed to record event:', e)
    }
  }

  private getUserBridgeAgentId(): string {
    const configured = store.get(NOTIFICATION_BRIDGE_STORAGE_KEY, DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID)
    return configured === "hermes"
      ? configured
      : DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID
  }

  private async recordUserNotification(
    missionId: string | undefined,
    phase: string,
    payload: Record<string, unknown> = {},
    source = agentAddress(MAIN_AGENT_ID)
  ): Promise<void> {
    if (!missionId) return
    const bridgeAgentId = this.getUserBridgeAgentId()
    await this.recordCollaboration({
      type: CollaborationEventTypes.UserNotificationRequested,
      missionId,
      source,
      target: agentAddress(bridgeAgentId),
      payload: {
        bridgeAgentId,
        phase,
        ...payload
      },
      metadata: { role: "user-bridge" }
    })
  }

  /**
   * Dispatch a prompt. Returns the task object; results stream via "stream" events.
   * No demo / mock fallback: if no provider is bound the call fails immediately.
   */
  async dispatch(text: string, mode: DispatchMode = "auto", targetAgent?: string, opts: DispatchOptions = {}): Promise<DispatchTask> {
    const taskId = "task-" + (++this.taskCounter)
    const task: DispatchTask = {
      id: taskId,
      text,
      mode,
      targetAgent,
      status: "pending",
      results: new Map(),
      thinking: new Map(),
      errors: new Map(),
      usage: new Map(),
      thinkingSummary: new Map(),
      createdAt: new Date()
    }
    this.tasks.set(task.id, task)

    task.status = "running"
    try {
      if (mode === "orchestrate") {
        await this.runOrchestrate(task, text, opts)
      } else {
        const targets = this.resolveTargets(task, mode, targetAgent)
        if (targets.length === 0) throw new Error("No available provider for the requested routing. Open Settings -> Providers to configure API keys.")

        if (mode === "chain") {
          let currentText = text
          for (const t of targets) {
            const res = await this.sendToAgent(task, t.agentId, currentText, opts)
            if ((task as any).status === "cancelled") break
            // 链式：上游失败则中断，不把空内容喂给下游（错误已记入 task.errors 并外显）
            if (res.error) break
            currentText = res.content
          }
        } else {
          await Promise.all(targets.map(t => this.sendToAgent(task, t.agentId, text, opts)))
        }

        if ((task as any).status !== "cancelled") task.status = task.errors.size === targets.length && targets.length > 0 ? "failed" : "completed"
      }
    } catch (e: any) {
      if (task.status !== "cancelled") task.status = "failed"
      task.error = e.message
    }
    return task
  }

  private resolveTargets(task: DispatchTask, mode: DispatchMode, targetAgent?: string): Array<{ agentId: string }> {
    const mgr = getProviderManager()
    const bindings = mgr.getBindings().filter(binding => binding.agentId !== MAIN_AGENT_ID)
    const executionBindings = bindings.filter(binding => isExecutionWorkerAgent(binding.agentId))
    if (targetAgent) {
      const b = bindings.find(x => x.agentId === targetAgent)
      return b ? [{ agentId: targetAgent }] : []
    }
    if (mode === "broadcast") {
      return executionBindings.map(b => ({ agentId: b.agentId }))
    }
    if (isBridgeRequest(task.text)) {
      const bridgeAgentId = this.getUserBridgeAgentId()
      if (bindings.find(b => b.agentId === bridgeAgentId)) return [{ agentId: bridgeAgentId }]
    }
    // auto: route by keyword
    const router = new KeywordRouter()
    const routed = router.route(task.text, this.registry.getAll().filter(a => isExecutionWorkerAgent(a.id)).map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      mode: a.mode,
      protocol: a.protocol,
      adapter: a.adapter,
      capabilities: a.capabilities,
      lastActive: a.lastActive,
      errorCount: a.errorCount
    })), this.missionStore?.getRouterContext())
    if (routed && executionBindings.find(b => b.agentId === routed)) return [{ agentId: routed }]
    return executionBindings.length > 0 ? [{ agentId: executionBindings[0].agentId }] : []
  }

  /**
   * 编排模式：lead agent 分解任务 → 各 agent 并行执行子任务 → lead 汇总。
   * 复用 sendToAgent 执行；额外发 orchestrate:* 事件供 UI 渲染（其内部 start/delta/done 事件
   * 渲染层在编排消息上忽略，只用 orchestrate:* 驱动 OrchestrateView）。
   */
  private async runOrchestrate(task: DispatchTask, text: string, opts: DispatchOptions): Promise<void> {
    try {
      const mgr = getProviderManager()
      const bindings = mgr.getBindings()
      const workerBindings = bindings.filter(binding => isExecutionWorkerAgent(binding.agentId))
      if (workerBindings.length === 0) throw new Error("没有可执行子 Agent。请到 设置 -> 路由 绑定 Codex 或 Claude。Hermes 只作为用户通知与远程指令通道。")

      const router = new KeywordRouter()
      const available = this.registry.getAll().filter(agent => isExecutionWorkerAgent(agent.id)).map(a => ({
        id: a.id, name: a.name, status: a.status, mode: a.mode, protocol: a.protocol,
        adapter: a.adapter, capabilities: a.capabilities, lastActive: a.lastActive, errorCount: a.errorCount
      }))
      const bound = new Set(workerBindings.map(b => b.agentId))
      const hasOrbitBinding = !!bindings.find(binding => binding.agentId === MAIN_AGENT_ID)
      if (!hasOrbitBinding) {
        throw new Error("Orbit 主 Agent 尚未绑定。编排模式必须先配置 Orbit，由它负责拆分、派发、校验和汇总。")
      }
      const leadId = MAIN_AGENT_ID
      const leadInfo = this.registry.get(leadId)
      const leadIsLocal = !!leadInfo && (leadInfo.adapter as any).protocol && (leadInfo.adapter as any).protocol !== 'http'
      if (!leadIsLocal && !mgr.resolveBinding(leadId)) {
        throw new Error("Orbit 主 Agent 尚未配置可用模型/API Key。请到 设置 -> 路由 配置 Orbit，或到 设置 -> 提供商 填写 Provider Key。")
      }
      const missionId = `mission-${task.id}`
      task.missionId = missionId
      await this.recordCollaboration({
        type: CollaborationEventTypes.MissionStarted,
        missionId,
        source: humanAddress('user'),
        payload: {
          missionId,
          taskId: task.id,
          goal: text,
          leadAgentId: leadId,
          availableAgents: available.map(agent => agent.id)
        }
      })

      this.emit("stream", { kind: "orchestrate:plan", taskId: task.id, missionId, leadAgentId: leadId, subtasks: [] })

      // 1. 分解（分解阶段 provider 报错 → 直接外显失败，不拿空内容硬跑）
      const plannerContext = this.missionStore?.buildPlannerContext(6) || ""
      const planRes = await this.sendToAgent(task, leadId, decompositionPrompt(text, available.map(a => a.id), plannerContext), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM })
      if (planRes.error) throw new Error("分解阶段失败: " + planRes.error)
      let plan = parsePlan(planRes.content)
      let artifact = plan?.artifact && plan.artifact.taskDag.nodes.length
        ? { ...plan.artifact, missionId, goal: text, leadAgentId: leadId }
        : null
      if (!plan || plan.subtasks.length === 0) {
        artifact = fallbackPlanArtifact(missionId, text, leadId)
        plan = { subtasks: artifact.taskDag.nodes, artifact }
      }
      // 指派：lead 未指定或不可用时按 routeScores 选可用 agent，兜底用 lead
      for (const st of plan.subtasks) {
        if (!st.agentId || !bound.has(st.agentId)) {
          const scored = router.routeScores(st.detail || st.title, available, this.missionStore?.getRouterContext()).filter(s => bound.has(s.id))
          st.agentId = scored[0]?.id || leadId
        }
      }
      artifact = artifact
        ? { ...artifact, taskDag: { nodes: plan.subtasks, edges: artifact.taskDag.edges }, updatedAt: new Date().toISOString() }
        : fallbackPlanArtifact(missionId, text, leadId)
      artifact = setPlanStatus(artifact, opts.requirePlanApproval ? "awaiting-approval" : "approved")
      task.planArtifact = artifact
      this.missionStore?.upsertPlan(artifact)
      await this.recordCollaboration({
        type: CollaborationEventTypes.MissionPlanProposed,
        missionId,
        payload: {
          missionId,
          taskId: task.id,
          goal: text,
          leadAgentId: leadId,
          status: artifact.status,
          contractCount: artifact.taskDag.nodes.length,
          contracts: artifact.taskDag.nodes.map(contractSnapshot)
        }
      })
      await this.recordUserNotification(missionId, "plan_proposed", {
        taskId: task.id,
        goal: text,
        contractCount: artifact.taskDag.nodes.length,
        status: artifact.status
      })
      for (const contract of artifact.taskDag.nodes) {
        await this.recordCollaboration({
          type: CollaborationEventTypes.ContractCreated,
          missionId,
          payload: contractSnapshot(contract)
        })
      }

      this.emit("stream", {
        kind: "orchestrate:plan", taskId: task.id, missionId, leadAgentId: leadId, planArtifact: artifact,
        subtasks: artifact.taskDag.nodes.map(s => ({
          id: s.id,
          title: s.title,
          detail: s.detail,
          agentId: s.agentId,
          fileScope: s.fileScope,
          dependsOn: s.dependsOn,
          doneWhen: s.doneWhen,
          verifyCommand: s.verifyCommand,
          interfaceRef: s.interfaceRef
        }))
      })

      if (opts.requirePlanApproval) {
        this.emit("stream", { kind: "orchestrate:approval", taskId: task.id, missionId, status: "awaiting", planArtifact: artifact })
        await this.recordCollaboration({
          type: CollaborationEventTypes.MissionPlanApprovalRequested,
          missionId,
          payload: { missionId, taskId: task.id, status: artifact.status, contractCount: artifact.taskDag.nodes.length }
        })
        const approved = await this.waitForPlanApproval(task.id)
        if (!approved) {
          this.missionStore?.setPlanStatus(missionId, "cancelled")
          this.emit("stream", { kind: "orchestrate:approval", taskId: task.id, missionId, status: "rejected" })
          await this.recordCollaboration({
            type: CollaborationEventTypes.MissionPlanRejected,
            missionId,
            source: humanAddress('user'),
            payload: { missionId, taskId: task.id, status: 'cancelled' }
          })
          await this.recordUserNotification(missionId, "plan_rejected", { taskId: task.id, status: "cancelled" })
          task.status = "cancelled"
          throw new Error("用户取消了协作计划")
        }
        artifact = setPlanStatus(artifact, "approved")
        task.planArtifact = artifact
        this.missionStore?.upsertPlan(artifact)
        this.emit("stream", { kind: "orchestrate:approval", taskId: task.id, missionId, status: "approved", planArtifact: artifact })
        await this.recordCollaboration({
          type: CollaborationEventTypes.MissionPlanApproved,
          missionId,
          source: humanAddress('user'),
          payload: { missionId, taskId: task.id, status: artifact.status }
        })
      }

      artifact = setPlanStatus(artifact, "running")
      task.planArtifact = artifact
      this.missionStore?.upsertPlan(artifact)
      await this.recordCollaboration({
        type: CollaborationEventTypes.MissionStatusChanged,
        missionId,
        payload: { missionId, taskId: task.id, status: artifact.status }
      })
      await this.recordUserNotification(missionId, "mission_running", {
        taskId: task.id,
        status: artifact.status,
        contractCount: artifact.taskDag.nodes.length
      })

      // 2. 按 DAG 分批执行子任务（无依赖的同批并行；有 dependsOn 的等上游完成）
      const MAX_ATTEMPTS = 2
      const partsById = new Map<string, { title: string; agentId?: string; content: string; error?: string }>()
      const finished = new Set<string>()
      const failed = new Set<string>()
      const remaining = new Map<string, TaskContract>(artifact.taskDag.nodes.map(st => [st.id, st]))

      const runContract = async (st: TaskContract) => {
        if ((task as any).status === "cancelled") return { title: st.title, agentId: st.agentId, content: "", error: "cancelled" }
        let content = ""
        let lastNote: string | undefined
        this.missionStore?.updateTaskStatus(missionId, st.id, "ready")
        await this.recordCollaboration({
          type: CollaborationEventTypes.ContractStatusChanged,
          missionId,
          payload: contractSnapshot(st, { status: 'ready' })
        })
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if ((task as any).status === "cancelled") break
          this.missionStore?.updateTaskStatus(missionId, st.id, "running")
          this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "running" })
          if (attempt === 1) {
            await this.recordCollaboration({
              type: CollaborationEventTypes.ContractClaimed,
              missionId,
              source: agentAddress(st.agentId || 'unassigned'),
              payload: contractSnapshot(st, { status: 'running', attempt })
            })
          }
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractStatusChanged,
            missionId,
            source: agentAddress(st.agentId || 'unassigned'),
            payload: contractSnapshot(st, { status: 'running', attempt })
          })
          try {
            const prompt = attempt === 1 ? subtaskContractPrompt(st) : retryPrompt(subtaskContractPrompt(st), lastNote)
            const r = await this.sendToAgent(task, st.agentId!, prompt, opts)
            // 失败外显：provider 报错绝不伪装成 done(空内容)，发 error 状态并退出该子任务
            if (r.error) {
              const decision = await this.assessSupervision(task, missionId, st, errorKind(r.error), {
                error: r.error,
                outputPreview: content.slice(0, 600)
              }, leadId, opts)
              this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision })
              await this.recordCollaboration({
                type: CollaborationEventTypes.SupervisorDecision,
                missionId,
                payload: { missionId, contractId: st.id, kind: errorKind(r.error), decision, error: r.error }
              })
              this.missionStore?.updateTaskStatus(missionId, st.id, decision.action === "wait" ? "waiting" : "failed")
              await this.recordCollaboration({
                type: CollaborationEventTypes.ContractStatusChanged,
                missionId,
                source: agentAddress(st.agentId || 'unassigned'),
                payload: contractSnapshot(st, { status: decision.action === 'wait' ? 'waiting' : 'failed', attempt, error: r.error })
              })
              await this.recordCollaboration({
                type: CollaborationEventTypes.ContractFailed,
                missionId,
                source: agentAddress(st.agentId || 'unassigned'),
                payload: contractSnapshot(st, { status: 'failed', attempt, error: r.error })
              })
              await this.recordUserNotification(missionId, "contract_failed", {
                taskId: task.id,
                contractId: st.id,
                title: st.title,
                agentId: st.agentId,
                attempt,
                error: r.error
              }, agentAddress(st.agentId || MAIN_AGENT_ID))
              this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "error", content: r.error })
              return { title: st.title, agentId: st.agentId, content: "", error: r.error }
            }
            content = r.content
            this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "done", content })
            // 校验：用 lead 作为 verify agent（verify 自身报错时 content 为空 → parseVerdict 宽松判过，避免死循环）
            const verifyRaw = (await this.sendToAgent(task, leadId, verifyPrompt(st.title, st.detail, content), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM })).content
            const v = parseVerdict(verifyRaw)
            this.emit("stream", { kind: "orchestrate:verdict", taskId: task.id, subtaskId: st.id, pass: v.pass, note: v.note, attempt })
            await this.recordCollaboration({
              type: CollaborationEventTypes.VerificationResult,
              missionId,
              payload: {
                missionId,
                contractId: st.id,
                agentId: st.agentId,
                pass: v.pass,
                note: v.note,
                attempt,
                outputPreview: content.slice(0, 600)
              }
            })
            if (v.pass) {
              this.missionStore?.updateTaskStatus(missionId, st.id, "done")
              await this.recordCollaboration({
                type: CollaborationEventTypes.ContractCompleted,
                missionId,
                source: agentAddress(st.agentId || 'unassigned'),
                payload: contractSnapshot(st, { status: 'done', attempt, outputPreview: content.slice(0, 800) })
              })
              await this.recordUserNotification(missionId, "contract_completed", {
                taskId: task.id,
                contractId: st.id,
                title: st.title,
                agentId: st.agentId,
                attempt
              }, agentAddress(st.agentId || MAIN_AGENT_ID))
              return { title: st.title, agentId: st.agentId, content }
            }
            const decision = await this.assessSupervision(task, missionId, st, "verification_failed", {
              verifierNote: v.note,
              outputPreview: content.slice(0, 800)
            }, leadId, opts)
            this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision })
            await this.recordCollaboration({
              type: CollaborationEventTypes.SupervisorDecision,
              missionId,
              payload: { missionId, contractId: st.id, kind: 'verification_failed', decision, verifierNote: v.note }
            })
            lastNote = v.note
            if (decision.action === "fail" || attempt >= MAX_ATTEMPTS) {
              this.missionStore?.updateTaskStatus(missionId, st.id, "failed")
              await this.recordCollaboration({
                type: CollaborationEventTypes.ContractFailed,
                missionId,
                source: agentAddress(st.agentId || 'unassigned'),
                payload: contractSnapshot(st, { status: 'failed', attempt, error: "verification failed", verifierNote: v.note })
              })
              await this.recordUserNotification(missionId, "contract_failed", {
                taskId: task.id,
                contractId: st.id,
                title: st.title,
                agentId: st.agentId,
                attempt,
                error: "verification failed",
                verifierNote: v.note
              }, agentAddress(st.agentId || MAIN_AGENT_ID))
              return { title: st.title, agentId: st.agentId, content, error: "校验未通过: " + (v.note || "结果不达标") }
            }
          } catch (e: any) {
            const err = e?.message || String(e)
            const decision = await this.assessSupervision(task, missionId, st, errorKind(err), { error: err, outputPreview: content.slice(0, 600) }, leadId, opts)
            this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision })
            await this.recordCollaboration({
              type: CollaborationEventTypes.SupervisorDecision,
              missionId,
              payload: { missionId, contractId: st.id, kind: errorKind(err), decision, error: err }
            })
            this.missionStore?.updateTaskStatus(missionId, st.id, "failed")
            await this.recordCollaboration({
              type: CollaborationEventTypes.ContractFailed,
              missionId,
              source: agentAddress(st.agentId || 'unassigned'),
              payload: contractSnapshot(st, { status: 'failed', attempt, error: err })
            })
            await this.recordUserNotification(missionId, "contract_failed", {
              taskId: task.id,
              contractId: st.id,
              title: st.title,
              agentId: st.agentId,
              attempt,
              error: err
            }, agentAddress(st.agentId || MAIN_AGENT_ID))
            this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "error", content: err })
            return { title: st.title, agentId: st.agentId, content: "", error: err }
          }
        }
        return { title: st.title, agentId: st.agentId, content }
      }

      while (remaining.size > 0) {
        if ((task as any).status === "cancelled") break
        const blockedByFailed = Array.from(remaining.values()).filter(st => st.dependsOn.some(dep => failed.has(dep)))
        for (const st of blockedByFailed) {
          this.missionStore?.updateTaskStatus(missionId, st.id, "blocked")
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractStatusChanged,
            missionId,
            payload: contractSnapshot(st, { status: 'blocked', error: 'blocked by failed dependency' })
          })
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractFailed,
            missionId,
            payload: contractSnapshot(st, { status: 'blocked', error: 'blocked by failed dependency' })
          })
          await this.recordUserNotification(missionId, "contract_blocked", {
            taskId: task.id,
            contractId: st.id,
            title: st.title,
            agentId: st.agentId,
            error: "blocked by failed dependency"
          })
          this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "error", content: "上游依赖失败，任务被阻塞" })
          partsById.set(st.id, { title: st.title, agentId: st.agentId, content: "", error: "blocked by failed dependency" })
          failed.add(st.id)
          remaining.delete(st.id)
        }
        const ready = Array.from(remaining.values()).filter(st => st.dependsOn.every(dep => finished.has(dep)))
        if (ready.length === 0) {
          for (const st of remaining.values()) {
            const decision = await this.assessSupervision(task, missionId, st, "dependency_wait", {
              dependencyStatuses: dependencyStatuses(st, finished, failed)
            }, leadId, opts)
            this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision })
            await this.recordCollaboration({
              type: CollaborationEventTypes.SupervisorDecision,
              missionId,
              payload: { missionId, contractId: st.id, kind: 'dependency_wait', decision, dependencyStatuses: dependencyStatuses(st, finished, failed) }
            })
            this.missionStore?.updateTaskStatus(missionId, st.id, "blocked")
            await this.recordCollaboration({
              type: CollaborationEventTypes.ContractStatusChanged,
              missionId,
              payload: contractSnapshot(st, { status: 'blocked', error: 'dependency cycle or unresolved dependency' })
            })
            partsById.set(st.id, { title: st.title, agentId: st.agentId, content: "", error: "dependency cycle or unresolved dependency" })
            failed.add(st.id)
            remaining.delete(st.id)
          }
          break
        }
        const wave = await Promise.all(ready.map(runContract))
        for (let i = 0; i < ready.length; i++) {
          const st = ready[i]
          const part = wave[i]
          partsById.set(st.id, part)
          if (part.error) failed.add(st.id)
          else finished.add(st.id)
          remaining.delete(st.id)
        }
      }

      if ((task as any).status === "cancelled") return
      const parts = artifact.taskDag.nodes.map(st =>
        partsById.get(st.id) || { title: st.title, agentId: st.agentId, content: "", error: "not executed" })

      // 3. lead 汇总（汇总阶段 provider 报错 → 外显失败，不得静默以空内容标记完成）
      this.emit("stream", { kind: "orchestrate:synthesizing", taskId: task.id })
      await this.recordCollaboration({
        type: CollaborationEventTypes.SynthesisStarted,
        missionId,
        source: agentAddress(leadId),
        payload: { missionId, taskId: task.id, leadAgentId: leadId, failedTaskIds: Array.from(failed) }
      })
      const synth = await this.sendToAgent(task, leadId, synthesisPrompt(text, parts), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM })
      if (synth.error) throw new Error("汇总阶段失败: " + synth.error)
      // 全部子任务失败时，合成结果不得被当成交付物：加硬性失败前缀，不完全依赖 lead 是否遵守提示词。
      const allSubtasksFailed = parts.length > 0 && parts.every(p => p.error)
      const finalContent = allSubtasksFailed
        ? "⚠️ 本次编排所有子任务均失败，以下为失败说明，不是已完成的交付物：\n\n" + synth.content
        : synth.content
      this.emit("stream", { kind: "orchestrate:final", taskId: task.id, content: finalContent })
      task.results.set("orchestrate", finalContent)
      this.missionStore?.setPlanStatus(missionId, failed.size ? "failed" : "completed")
      await this.recordCollaboration({
        type: CollaborationEventTypes.SynthesisCompleted,
        missionId,
        source: agentAddress(leadId),
        payload: { missionId, taskId: task.id, leadAgentId: leadId, summary: synth.content.slice(0, 1000) }
      })
      const outcome = this.missionStore?.recordOutcome({
        missionId,
        goal: text,
        status: failed.size ? "failed" : "completed",
        summary: synth.content.slice(0, 600) || (failed.size ? "Mission completed with failed contracts." : "Mission completed."),
        lessons: extractLessons(synth.content),
        blockers: parts.filter(p => p.error).map(p => `${p.title}: ${p.error}`).slice(0, 8),
        verified: failed.size === 0,
        taskCount: artifact.taskDag.nodes.length,
        failedTaskIds: Array.from(failed),
        resultPreview: synth.content.slice(0, 1200)
      })
      await this.recordCollaboration({
        type: CollaborationEventTypes.OutcomeRecorded,
        missionId,
        payload: outcome || {
          missionId,
          status: failed.size ? "failed" : "completed",
          summary: synth.content.slice(0, 600),
          failedTaskIds: Array.from(failed)
        }
      })
      await this.recordUserNotification(missionId, failed.size ? "mission_failed" : "mission_completed", {
        taskId: task.id,
        status: failed.size ? "failed" : "completed",
        failedTaskIds: Array.from(failed),
        summary: synth.content.slice(0, 800)
      })
      task.status = "completed"
    } catch (e: any) {
      if (task.missionId && task.status !== "cancelled") {
        this.missionStore?.setPlanStatus(task.missionId, "failed")
        const outcome = this.missionStore?.recordOutcome({
          missionId: task.missionId,
          goal: text,
          status: "failed",
          summary: e?.message || String(e),
          blockers: [e?.message || String(e)],
          verified: false,
          taskCount: task.planArtifact?.taskDag.nodes.length || 0,
          failedTaskIds: task.planArtifact?.taskDag.nodes.filter(node => node.status === "failed" || node.status === "blocked").map(node => node.id) || []
        })
        await this.recordCollaboration({
          type: CollaborationEventTypes.OutcomeRecorded,
          missionId: task.missionId,
          payload: outcome || { missionId: task.missionId, status: 'failed', summary: e?.message || String(e) }
        })
        await this.recordUserNotification(task.missionId, "mission_failed", {
          taskId: task.id,
          status: "failed",
          error: e?.message || String(e)
        })
      }
      this.emit("stream", { kind: "orchestrate:error", taskId: task.id, error: e?.message || String(e) })
      throw e
    }
  }

  private async sendToAgent(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions): Promise<{ content: string; error?: string }> {
    const mgr = getProviderManager()
    const resolved = mgr.resolveBinding(agentId)
 // stdio routing: 若 registry 注册的是 stdio adapter(非 http),则走本地 CLI 子进程
 const agentInfo = this.registry.get(agentId)
 if (agentInfo && (agentInfo.adapter as any).protocol === 'acp') {
 return this.sendToAgentAcp(task, agentId, text, opts, agentInfo.adapter)
 }
 if (agentInfo && (agentInfo.adapter as any).protocol && (agentInfo.adapter as any).protocol !== 'http') {
 const binding = mgr.getBinding(agentId)
 return this.sendToAgentStdio(task, agentId, text, opts, resolved, agentInfo.adapter, binding)
 }
    if (!resolved) {
      const err = "No available provider for agent " + agentId
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, error: err })
      return { content: "", error: err }
    }
    this.registry.setStatus(agentId, "busy")
    const messages: ChatCompletionMessage[] = [{ role: "user", content: text }]
    const client = buildProviderClient(resolved)
    const systemPrompt = this.systemPromptFor(agentId, opts.systemPrompt, text, opts.workspaceId)
    const thinking = opts.thinking || resolved.thinking

    // --- AgentHub native agentic (Claude-B 新增): 开启后 HTTP agent 走工具回环，真在工作区动手 ---
    if (isHttpAgenticEnabled(agentId)) {
      return this.runAgenticHttpBranch(task, agentId, text, systemPrompt, thinking, resolved, opts)
    }
    // --- /AgentHub native agentic ---

    let content = ""
    let thinkingTxt = ""
    let summary: any = undefined
    let usage: any = undefined
    const start = Date.now()
    this.emit("stream", {
      kind: "start",
      taskId: task.id,
      agentId,
      providerId: resolved.provider.id,
      modelId: resolved.model.id,
      mode: "content"
    })

    try {
      await this.pipeline.process(text, agentId)
      await new Promise<void>((resolve, reject) => {
        client.stream(
          { messages, systemPrompt, thinkingOverride: thinking },
          {
            onContent: (delta) => {
              content += delta
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: resolved.provider.id, modelId: resolved.model.id, channel: "content", text: delta })
            },
            onThinking: (delta) => {
              thinkingTxt += delta
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: resolved.provider.id, modelId: resolved.model.id, channel: "thinking", text: delta })
            },
            onDone: (final) => {
              summary = final.thinking
              usage = final.usage
              resolve()
            },
            onError: (err) => reject(err)
          }
        )
      })
      task.results.set(agentId, content)
      task.thinking.set(agentId, thinkingTxt)
      if (summary) task.thinkingSummary.set(agentId, summary)
      this.emit("stream", {
        kind: "done",
        taskId: task.id,
        agentId,
        providerId: resolved.provider.id,
        modelId: resolved.model.id,
        content,
        thinking: thinkingTxt,
        summary,
        usage,
        durationMs: Date.now() - start
      })
      task.usage.set(agentId, usage)
      return { content }
    } catch (e: any) {
      task.errors.set(agentId, e.message)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId: resolved.provider.id, modelId: resolved.model.id, error: e.message })
      return { content, error: e.message }
    } finally {
      this.registry.setStatus(agentId, "idle")
    }
  }

  private systemPromptFor(agentId: string, overridePrompt?: string, taskText = "", workspaceId?: string | null): string {
    if (overridePrompt) return overridePrompt
    const base = buildAgentRuntimeSystemPrompt(agentId, agentSystemPrompt(agentId), this.memoryContext(), taskText, this.skillsBlockFor(agentId))
    const ws = this.workspaceContextFor(workspaceId)
    return ws ? base + "\n\n" + ws : base
  }

  private promptForAgent(agentId: string, text: string, workspaceId?: string | null): string {
    const base = buildAgentTaskPrompt(agentId, text, this.memoryContext(), this.skillsBlockFor(agentId))
    const ws = this.workspaceContextFor(workspaceId)
    // 项目上下文置顶（CLAUDE.md/AGENTS.md 约定），其后才是 runtime 指令 + 用户任务
    return ws ? ws + "\n\n" + base : base
  }

  // --- AgentHub workspace bootstrap：把工作区 bootstrapFiles 作为项目级上下文拼入 prompt（全 agent 通用） ---
  private workspaceContextFor(workspaceId?: string | null): string {
    try {
      return getWorkspaceManager().bootstrapContext(workspaceId ?? null)
    } catch {
      return ""
    }
  }
  // --- /AgentHub workspace bootstrap ---

  // --- AgentHub skills (Claude-B 新增): 取目标 agent 已装技能拼成注入块 ---
  private skillsBlockFor(agentId: string): string {
    try {
      return buildSkillBlock(getSkillManager().installedFor(agentId))
    } catch {
      return ""
    }
  }
  // --- /AgentHub skills ---

  private async assessSupervision(
    task: DispatchTask,
    missionId: string,
    contract: TaskContract,
    kind: SupervisorSignalKind,
    patch: Partial<Parameters<Supervisor["assess"]>[0]>,
    leadAgentId: string,
    opts: DispatchOptions
  ): Promise<SupervisorDecision> {
    return this.supervisor.assess({
      missionId,
      contract,
      kind,
      elapsedMs: Date.now() - task.createdAt.getTime(),
      ...patch
    }, (prompt) => this.callSupervisorLLM(leadAgentId, prompt, opts))
  }

  private async callSupervisorLLM(agentId: string, prompt: string, _opts: DispatchOptions): Promise<string | undefined> {
    try {
      const agentInfo = this.registry.get(agentId)
      if (agentInfo && (agentInfo.adapter as any).protocol && (agentInfo.adapter as any).protocol !== 'http') return undefined
      const resolved = getProviderManager().resolveBinding(agentId)
      if (!resolved) return undefined
      const client = buildProviderClient(resolved)
      let content = ""
      await new Promise<void>((resolve, reject) => {
        client.stream(
          {
            messages: [{ role: "user", content: prompt }],
            systemPrompt: "You are a lightweight supervisor. Return only the requested JSON.",
            thinkingOverride: { mode: "off", level: "minimal" },
            signal: AbortSignal.timeout(20_000)
          },
          {
            onContent: delta => { content += delta },
            onDone: () => resolve(),
            onError: err => reject(err)
          }
        )
      })
      return content
    } catch {
      return undefined
    }
  }

  // --- AgentHub native agentic 工具回环（Claude-B 新增） ---
  // HTTP agent 开启 agentic 后：用 AgentHub 自带工具回环替代纯聊天流，让模型真在工作区
  // 读写文件、跑命令；每步发 activity 事件复用既有步骤卡。自管 start/done/error 与 registry。
  private async runAgenticHttpBranch(
    task: DispatchTask, agentId: string, userText: string, systemPrompt: string,
    thinking: ThinkingConfig, resolved: any, opts: DispatchOptions
  ): Promise<{ content: string; error?: string }> {
    const providerId = resolved.provider.id
    const modelId = resolved.model.id
    let root: string | null = null
    const wsId = opts.workspaceId ?? null
    if (wsId) {
      try { root = getWorkspaceManager().getById(wsId)?.rootPath ?? null } catch { root = null }
    }
    const start = Date.now()
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" })
    try {
      const res = await runAgenticHttp({
        userText,
        systemPrompt,
        resolved,
        thinking,
        root,
        agentId,
        policyFor: (tool) => getApprovalConfig().policyFor(agentId, tool),
        requestApproval: (req) => this.requestApprovalFor(task, agentId, req),
        isCancelled: () => (task as any).status === "cancelled",
        emit: {
          delta: (channel, textDelta) => this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel, text: textDelta }),
          activity: (step) => this.emit("stream", { kind: "activity", taskId: task.id, agentId, step })
        }
      })
      if (res.error) {
        task.errors.set(agentId, res.error)
        this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: res.error })
        return { content: res.content || "", error: res.error }
      }
      task.results.set(agentId, res.content)
      if (res.usage) task.usage.set(agentId, res.usage)
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content: res.content, usage: res.usage, durationMs: Date.now() - start })
      return { content: res.content }
    } catch (e: any) {
      task.errors.set(agentId, e.message)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: e.message })
      return { content: "", error: e.message }
    } finally {
      this.registry.setStatus(agentId, "idle")
    }
  }
  // --- /AgentHub native agentic ---

  private memoryContext(): RuntimeMemoryEntry[] {
    try {
      return this.memoryProvider() || []
    } catch {
      return []
    }
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (task && task.status === "running") {
      task.status = "cancelled"
      const planApproval = this.pendingPlanApprovals.get(taskId)
      if (planApproval) {
        this.pendingPlanApprovals.delete(taskId)
        planApproval.resolve(false)
      }
      // 清理该任务所有待决审批（拒绝放行），避免工具回环在 await 上永久挂起
      for (const [id, p] of this.pendingApprovals) {
        if (id.startsWith(`appr-${taskId}-`)) {
          clearTimeout(p.timer)
          this.pendingApprovals.delete(id)
          p.resolve(false)
        }
      }
      return true
    }
    return false
  }

  resolvePlanApproval(taskId: string, approved: boolean): boolean {
    const pending = this.pendingPlanApprovals.get(taskId)
    if (!pending) return false
    this.pendingPlanApprovals.delete(taskId)
    pending.resolve(approved)
    return true
  }

  private waitForPlanApproval(taskId: string): Promise<boolean> {
    return new Promise(resolve => {
      this.pendingPlanApprovals.set(taskId, { resolve })
    })
  }

  /** 渲染层审批决策回传：true=放行，false=拒绝。返回是否命中一个待决请求（用于 IPC 反馈）。 */
  resolveApproval(requestId: string, approved: boolean): boolean {
    const p = this.pendingApprovals.get(requestId)
    if (!p) return false
    clearTimeout(p.timer)
    this.pendingApprovals.delete(requestId)
    p.resolve(approved)
    return true
  }

  /** 发起一次写/执行审批：emit approval 事件 + 注册待决 Promise（超时自动拒绝）。 */
  private requestApprovalFor(task: DispatchTask, agentId: string, req: ApprovalRequest): Promise<boolean> {
    const requestId = `appr-${task.id}-${++this.approvalSeq}`
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingApprovals.delete(requestId)) resolve(false)
      }, APPROVAL_TIMEOUT_MS)
      this.pendingApprovals.set(requestId, { resolve, timer })
      this.emit("stream", {
        kind: "approval", taskId: task.id, agentId,
        request: { id: requestId, tool: req.tool, toolName: req.toolName, label: req.label, detail: req.detail }
      })
    })
  }

  getTask(taskId: string): DispatchTask | undefined {
    return this.tasks.get(taskId)
  }

  getRecentTasks(limit = 20): DispatchTask[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  /** Stdio路径: 通过本地 CLI 子进程向 agent 发 prompt, 收集 stdout 作为 stream 内容.
   * oneshot 适配器（codex exec / claude --print）以进程退出为完成信号;
   * interactive 适配器保留输出静默判定; 任务被取消时 kill 子进程.
   * 注意: stdio 不依赖 HTTP provider, resolved 可为 null.
   */
  private async sendToAgentStdio(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions, resolved: any, adapter: any, binding?: any): Promise<{ content: string; error?: string }> {
    this.registry.setStatus(agentId, "busy")
    let content = ""
    // stdio 直连本地 CLI：用绑定自身的 provider/model 做标注（而非 HTTP 回退结果，
    // 否则本地任务会被错标成 fallbackChain 里某个 HTTP provider）
    const providerId = binding?.providerId ?? resolved?.provider?.id ?? "local-cli"
    const modelId = binding?.modelId ?? resolved?.model?.id ?? "stdio"
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" })
    const start = Date.now()
    const TIMEOUT_MS = 5 * 60 * 1000           // 硬超时
    const POLL_MS = 200
    // 启动后这么久仍无任何输出且进程未退出 → 判为卡死（GUI/交互式二进制）。
    const STARTUP_SILENCE_MS = 60 * 1000
    // 已产生输出后静默这么久且进程未退出 → 兜底视为已完成（应对输出完却不退出的 CLI）
    const IDLE_AFTER_OUTPUT_MS = 45 * 1000
    const procField = "proc" // 适配器内部的子进程字段
    const self = this
    let settled = false
    let spawnedOnce = false
    let sawActivity = false
    const cleanup = () => {
      adapter.onOutput = null
      adapter.onError = null
      adapter.onActivity = null
    }
    try {
      let agentPrompt = this.promptForAgent(agentId, text, opts.workspaceId)
      // thinking 对齐：stdio 不能下发 reasoning 参数，开启时以指令注入（与 HTTP 路径行为一致）
      if (thinkingRequested(opts.thinking)) agentPrompt = STDIO_THINKING_DIRECTIVE + "\n\n" + agentPrompt
      // 工作区 → cwd：未指定/不存在 → 降级 home（不报错），并在 prompt 顶部打提示
      // 让 agent 知道它在 home 而非项目里，避免静默"在错地方改文件"。
      let cwd: string | null = null
      const wsId = opts.workspaceId ?? null
      if (wsId) {
        const ws = getWorkspaceManager().getById(wsId)
        if (ws?.rootPath) cwd = ws.rootPath
        else agentPrompt = '[AgentHub 提示] 指定的工作区不存在或已被删除；本次派发将在 home 目录运行（agent 看不到项目文件）。\n\n' + agentPrompt
      }
      // pipeline 看到的是最终 prompt（包含工作区提示）
      await this.pipeline.process(agentPrompt, agentId)
      await new Promise<void>((resolveP, rejectP) => {
        let lastOutputAt = Date.now()
        const onChunk = (chunk: string) => {
          content += chunk
          lastOutputAt = Date.now()
          self.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "content", text: chunk })
        }
        const onErr = (err: Error) => {
          if (settled) return
          settled = true
          clearInterval(poll)
          cleanup()
          rejectP(err)
        }
        // agentic 活动步骤：透传成 stream 事件；同时刷新"有输出"时间戳，防止长任务被 60s 静默检测误杀
        const onAct = (step: any) => {
          if (settled || !step) return
          lastOutputAt = Date.now()
          sawActivity = true
          self.emit("stream", { kind: "activity", taskId: task.id, agentId, step })
        }
        adapter.onOutput = onChunk
        adapter.onError = onErr
        adapter.onActivity = onAct
        adapter.start().then(() => {
          try {
            adapter.send(agentPrompt, { cwd })
            spawnedOnce = true
          } catch (e) { onErr(e as Error) }
        }).catch(onErr)
        const poll = setInterval(() => {
          if (settled) return
          const proc = adapter[procField]
          const idle = Date.now() - lastOutputAt
          const elapsed = Date.now() - start
          const hasOutput = content.length > 0 || sawActivity
          const procGone = spawnedOnce && !proc                                   // 进程退出 = oneshot 正常完成
          const quietDone = hasOutput && idle > IDLE_AFTER_OUTPUT_MS               // 有输出后久静默 → 兜底完成
          const stalledNoOutput = spawnedOnce && !hasOutput && elapsed > STARTUP_SILENCE_MS // 始终无输出 → 卡死
          const timedOut = elapsed > TIMEOUT_MS
          const cancelled = (task as any).status === "cancelled"
          if (procGone || quietDone || stalledNoOutput || timedOut || cancelled) {
            settled = true
            clearInterval(poll)
            cleanup()
            if (cancelled || timedOut || stalledNoOutput) {
              try { adapter.stop() } catch { /* noop */ }
            }
            // 卡死 / 超时 → 显式报错，绝不把卡住的 banner/动画当作“完成”静默返回
            if (stalledNoOutput) {
              rejectP(new Error(`本地 CLI 启动 ${Math.round(STARTUP_SILENCE_MS / 1000)}s 无任何输出，疑似无法用于非交互直连（GUI/REPL）。建议改用 HTTP 绑定。`))
              return
            }
            if (timedOut) {
              rejectP(new Error("本地 CLI 执行超时（5 分钟）" + (hasOutput ? "，仅收到部分输出" : "")))
              return
            }
            resolveP()  // procGone / quietDone / cancelled → 用已收集内容完成
          }
        }, POLL_MS)
      })
      task.results.set(agentId, content)
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content, durationMs: Date.now() - start })
      return { content }
    } catch (e: any) {
      task.errors.set(agentId, e.message)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: e.message })
      return { content, error: e.message }
    } finally {
      try { await adapter.stop() } catch { /* noop */ }
      this.registry.setStatus(agentId, "idle")
    }
  }

  /**
   * ACP 路径：常驻 server，靠 session/prompt 的 stopReason 判完成（不像 stdio oneshot 靠进程退出）。
   * session/update 通知经 adapter.runPrompt 的 handlers 透传为 delta(content/thinking) + activity 步骤。
   * 取消：轮询 task.status，cancelled 时发 session/cancel。每轮结束 stop() 杀掉 server（第一阶段不复用）。
   */
  private async sendToAgentAcp(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions, adapter: any): Promise<{ content: string; error?: string }> {
    this.registry.setStatus(agentId, "busy")
    const providerId = "local-acp"
    const modelId = "acp"
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" })
    const start = Date.now()
    let content = ""

    // prompt 构建与 stdio 一致：技能注入 + 工作区 bootstrap + 用户任务（+ 可选 thinking 指令）
    let agentPrompt = this.promptForAgent(agentId, text, opts.workspaceId)
    if (thinkingRequested(opts.thinking)) agentPrompt = STDIO_THINKING_DIRECTIVE + "\n\n" + agentPrompt

    // 工作区 → ACP session/new 的 cwd；未指定/不存在 → home（并在 prompt 顶部提示）
    let cwd = homedir()
    const wsId = opts.workspaceId ?? null
    if (wsId) {
      const ws = getWorkspaceManager().getById(wsId)
      if (ws?.rootPath) cwd = ws.rootPath
      else agentPrompt = '[AgentHub 提示] 指定的工作区不存在或已被删除；本次派发将在 home 目录运行（agent 看不到项目文件）。\n\n' + agentPrompt
    }

    const cancelPoll = setInterval(() => {
      if ((task as any).status === "cancelled") { try { adapter.cancel() } catch { /* noop */ } }
    }, 300)

    try {
      await this.pipeline.process(agentPrompt, agentId)
      const stopReason: string = await adapter.runPrompt(agentPrompt, cwd, {
        onChunk: (t: string) => { content += t; this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "content", text: t }) },
        onThought: (t: string) => this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "thinking", text: t }),
        onActivity: (step: any) => this.emit("stream", { kind: "activity", taskId: task.id, agentId, step }),
        onRequestPermission: (req: any) => this.requestAcpPermission(task, agentId, req)
      })
      if ((task as any).status === "cancelled") return { content }
      // refusal 且无任何内容 → 作为错误外显；否则按已收内容正常收尾
      if (stopReason === "refusal" && !content) {
        const err = "ACP agent 拒绝了本次请求（refusal）"
        task.errors.set(agentId, err)
        this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err })
        return { content: "", error: err }
      }
      task.results.set(agentId, content)
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content, durationMs: Date.now() - start })
      return { content }
    } catch (e: any) {
      const err = e?.message || String(e)
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err })
      return { content, error: err }
    } finally {
      clearInterval(cancelPoll)
      try { await adapter.stop() } catch { /* noop */ }
      this.registry.setStatus(agentId, "idle")
    }
  }

  private async requestAcpPermission(task: DispatchTask, agentId: string, req: any): Promise<boolean> {
    if (!req?.tool) return true
    const stepId = String(
      req.raw?.toolCall?.toolCallId ||
      req.raw?.toolCall?.id ||
      req.raw?.toolCallId ||
      `acp-perm-${task.id}-${++this.approvalSeq}`
    )
    const tool = req.tool as GuardedTool
    const toolName = req.toolName || (tool === "exec" ? "exec" : "fs_write")
    const label = req.label || toolName
    const detail = req.detail || ""
    const policy = getApprovalConfig().policyFor(agentId, tool)

    if (policy === "allow") return true

    if (policy === "deny") {
      this.emit("stream", {
        kind: "activity",
        taskId: task.id,
        agentId,
        step: {
          id: stepId,
          kind: "tool",
          tool: toolName,
          label,
          detail,
          output: `Rejected by approval policy: '${tool}' is denied for this agent.`,
          status: "error"
        }
      })
      return false
    }

    this.emit("stream", {
      kind: "activity",
      taskId: task.id,
      agentId,
      step: { id: stepId, kind: "tool", tool: toolName, label, detail, status: "awaiting" }
    })
    const approved = await this.requestApprovalFor(task, agentId, { stepId, agentId, tool, toolName, label, detail })
    if (!approved) {
      this.emit("stream", {
        kind: "activity",
        taskId: task.id,
        agentId,
        step: {
          id: stepId,
          kind: "tool",
          tool: toolName,
          label,
          detail,
          output: "Rejected by user (approval denied).",
          status: "error"
        }
      })
    }
    return approved
  }
}

function errorKind(error: string): SupervisorSignalKind {
  return /timeout|timed out|无任何输出|卡死|stalled|idle|no output/i.test(error || '')
    ? 'stall'
    : 'worker_error'
}

function dependencyStatuses(st: TaskContract, finished: Set<string>, failed: Set<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const dep of st.dependsOn) out[dep] = failed.has(dep) ? 'failed' : finished.has(dep) ? 'done' : 'pending'
  return out
}

function contractSnapshot(contract: TaskContract, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractId: contract.id,
    title: contract.title,
    agentId: contract.agentId,
    status: contract.status,
    fileScope: contract.fileScope,
    dependsOn: contract.dependsOn,
    doneWhen: contract.doneWhen,
    verifyCommand: contract.verifyCommand,
    interfaceRef: contract.interfaceRef,
    ...patch
  }
}

function extractLessons(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(line => /lesson|经验|教训|注意|下次|风险|risk/i.test(line))
    .slice(0, 8)
}
