import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import { PlanArtifact, setContractStatus, setPlanStatus, TaskContractStatus } from './plan-artifact'
import type { RouterContext } from './router'

export interface MissionOutcome {
  id: string
  missionId: string
  goal: string
  status: 'completed' | 'failed' | 'cancelled'
  summary: string
  lessons: string[]
  blockers: string[]
  verified: boolean
  taskCount: number
  failedTaskIds: string[]
  createdAt: string
  updatedAt: string
  resultPreview?: string
}

export interface MissionSTM {
  activeMissionId?: string
  routeContext?: string
  recentDecisions: string[]
  updatedAt?: string
}

interface MissionStoreState {
  version: 1
  plans: PlanArtifact[]
  outcomes: MissionOutcome[]
  stm: MissionSTM
}

const DEFAULT_STATE: MissionStoreState = {
  version: 1,
  plans: [],
  outcomes: [],
  stm: { recentDecisions: [] }
}

export class MissionStore {
  readonly root: string
  private readonly statePath: string

  constructor(root: string) {
    this.root = basename(normalize(root)) === 'missions' ? root : join(root, 'missions')
    this.statePath = join(this.root, 'mission-state.json')
    mkdirSync(this.root, { recursive: true })
  }

  listPlans(): PlanArtifact[] {
    return this.read().plans.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  listOutcomes(limit = 50): MissionOutcome[] {
    return this.read().outcomes
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
  }

  getActivePlan(): PlanArtifact | null {
    const state = this.read()
    const id = state.stm.activeMissionId
    return id ? state.plans.find(plan => plan.missionId === id) || null : null
  }

  getSTM(): MissionSTM {
    return { ...this.read().stm, recentDecisions: this.read().stm.recentDecisions.slice() }
  }

  upsertPlan(plan: PlanArtifact): PlanArtifact {
    const state = this.read()
    state.plans = [plan, ...state.plans.filter(item => item.missionId !== plan.missionId)].slice(0, 100)
    state.stm.activeMissionId = plan.missionId
    state.stm.routeContext = missionRouteText(plan)
    state.stm.updatedAt = new Date().toISOString()
    this.write(state)
    return plan
  }

  setPlanStatus(missionId: string, status: PlanArtifact['status']): PlanArtifact | null {
    const state = this.read()
    const idx = state.plans.findIndex(plan => plan.missionId === missionId)
    if (idx < 0) return null
    state.plans[idx] = setPlanStatus(state.plans[idx], status)
    state.stm.activeMissionId = missionId
    state.stm.routeContext = missionRouteText(state.plans[idx])
    state.stm.updatedAt = new Date().toISOString()
    this.write(state)
    return state.plans[idx]
  }

  updateTaskStatus(missionId: string, taskId: string, status: TaskContractStatus): PlanArtifact | null {
    const state = this.read()
    const idx = state.plans.findIndex(plan => plan.missionId === missionId)
    if (idx < 0) return null
    state.plans[idx] = setContractStatus(state.plans[idx], taskId, status)
    state.stm.activeMissionId = missionId
    state.stm.routeContext = missionRouteText(state.plans[idx])
    state.stm.updatedAt = new Date().toISOString()
    this.write(state)
    return state.plans[idx]
  }

  addDecision(note: string): void {
    const clean = note.trim()
    if (!clean) return
    const state = this.read()
    state.stm.recentDecisions = [clean, ...state.stm.recentDecisions.filter(item => item !== clean)].slice(0, 20)
    state.stm.updatedAt = new Date().toISOString()
    this.write(state)
  }

  recordOutcome(input: {
    missionId: string
    goal: string
    status: MissionOutcome['status']
    summary: string
    lessons?: string[]
    blockers?: string[]
    verified?: boolean
    taskCount?: number
    failedTaskIds?: string[]
    resultPreview?: string
  }): MissionOutcome {
    const state = this.read()
    const now = new Date().toISOString()
    const existing = state.outcomes.find(item => item.missionId === input.missionId)
    const outcome: MissionOutcome = {
      id: existing?.id || `outcome-${input.missionId}`,
      missionId: input.missionId,
      goal: input.goal,
      status: input.status,
      summary: input.summary,
      lessons: input.lessons || [],
      blockers: input.blockers || [],
      verified: !!input.verified,
      taskCount: input.taskCount || 0,
      failedTaskIds: input.failedTaskIds || [],
      resultPreview: input.resultPreview,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    state.outcomes = [outcome, ...state.outcomes.filter(item => item.missionId !== input.missionId)].slice(0, 200)
    state.stm.updatedAt = now
    this.write(state)
    return outcome
  }

  buildPlannerContext(limit = 6): string {
    const state = this.read()
    const lines: string[] = []
    const active = state.stm.activeMissionId ? state.plans.find(plan => plan.missionId === state.stm.activeMissionId) : null
    if (active) {
      lines.push('ACTIVE MISSION STM:')
      lines.push(`- ${active.goal}`)
      const pending = active.taskDag.nodes
        .filter(node => !['done', 'failed', 'cancelled'].includes(node.status))
        .slice(0, 8)
        .map(node => `${node.id}:${node.title}${node.agentId ? `[${node.agentId}]` : ''}`)
      if (pending.length) lines.push('- Pending contracts: ' + pending.join(', '))
    }
    const outcomes = state.outcomes.slice(0, limit)
    if (outcomes.length) {
      lines.push('RECENT EPISODIC OUTCOMES:')
      for (const outcome of outcomes) {
        lines.push(`- ${outcome.status.toUpperCase()} ${outcome.goal}: ${outcome.summary}`)
        if (outcome.lessons.length) lines.push('  lessons: ' + outcome.lessons.slice(0, 3).join(' | '))
        if (outcome.blockers.length) lines.push('  blockers: ' + outcome.blockers.slice(0, 3).join(' | '))
      }
    }
    return lines.join('\n').slice(0, 5000)
  }

  getRouterContext(): RouterContext | undefined {
    const state = this.read()
    const active = state.stm.activeMissionId ? state.plans.find(plan => plan.missionId === state.stm.activeMissionId) : null
    if (!active && !state.stm.routeContext && state.stm.recentDecisions.length === 0) return undefined
    return {
      activeMissionId: state.stm.activeMissionId,
      goal: active?.goal,
      routeContext: state.stm.routeContext,
      recentDecisions: state.stm.recentDecisions.slice(0, 6),
      pendingContracts: active?.taskDag.nodes
        .filter(node => !['done', 'failed', 'cancelled'].includes(node.status))
        .slice(0, 10)
        .map(node => ({
          id: node.id,
          title: node.title,
          detail: node.detail,
          agentId: node.agentId,
          status: node.status
        }))
    }
  }

  private read(): MissionStoreState {
    if (!existsSync(this.statePath)) return cloneState(DEFAULT_STATE)
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf-8'))
      return {
        version: 1,
        plans: Array.isArray(parsed.plans) ? parsed.plans.filter(isPlanArtifact) : [],
        outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes.filter(isMissionOutcome) : [],
        stm: normalizeSTM(parsed.stm)
      }
    } catch {
      return cloneState(DEFAULT_STATE)
    }
  }

  private write(state: MissionStoreState): void {
    mkdirSync(this.root, { recursive: true })
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8')
  }
}

function missionRouteText(plan: PlanArtifact): string {
  const contracts = plan.taskDag.nodes.map(node =>
    `${node.title} ${node.detail} ${node.agentId || ''} ${node.fileScope.join(' ')} ${node.interfaceRef}`)
  return [plan.goal, ...contracts].join('\n').slice(0, 6000)
}

function normalizeSTM(input: any): MissionSTM {
  return {
    activeMissionId: typeof input?.activeMissionId === 'string' ? input.activeMissionId : undefined,
    routeContext: typeof input?.routeContext === 'string' ? input.routeContext : undefined,
    recentDecisions: Array.isArray(input?.recentDecisions) ? input.recentDecisions.filter((x: any) => typeof x === 'string') : [],
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : undefined
  }
}

function isPlanArtifact(input: any): input is PlanArtifact {
  return input?.version === 1 && typeof input?.missionId === 'string' && input?.taskDag && Array.isArray(input.taskDag.nodes)
}

function isMissionOutcome(input: any): input is MissionOutcome {
  return typeof input?.missionId === 'string' && typeof input?.goal === 'string' && typeof input?.summary === 'string'
}

function cloneState(state: MissionStoreState): MissionStoreState {
  return {
    version: 1,
    plans: state.plans.slice(),
    outcomes: state.outcomes.slice(),
    stm: { ...state.stm, recentDecisions: state.stm.recentDecisions.slice() }
  }
}
