import type { TaskContract } from './plan-artifact'

export type SupervisorSignalKind =
  | 'progress'
  | 'dependency_wait'
  | 'verification_failed'
  | 'worker_error'
  | 'stall'

export type SupervisorAction =
  | 'continue'
  | 'wait'
  | 'retry'
  | 'handoff'
  | 'fail'

export interface SupervisorSignal {
  missionId: string
  contract: Pick<TaskContract, 'id' | 'title' | 'detail' | 'agentId' | 'dependsOn' | 'doneWhen' | 'verifyCommand' | 'interfaceRef'>
  kind: SupervisorSignalKind
  elapsedMs?: number
  idleMs?: number
  error?: string
  verifierNote?: string
  dependencyStatuses?: Record<string, string>
  outputPreview?: string
}

export interface SupervisorDecision {
  state: 'healthy' | 'waiting' | 'stalled' | 'needs-rework' | 'failed'
  action: SupervisorAction
  reason: string
  source: 'rule' | 'llm'
  confidence: number
  suggestedAgentId?: string
}

export class Supervisor {
  constructor(private thresholds = { stallAfterMs: 90_000 }) {}

  async assess(signal: SupervisorSignal, llmJudge?: (prompt: string) => Promise<string | undefined>): Promise<SupervisorDecision> {
    const rule = this.assessByRules(signal)
    if (!needsLlm(signal, rule) || !llmJudge) return rule

    try {
      const raw = await llmJudge(supervisorPrompt(signal, rule))
      const parsed = parseSupervisorDecision(raw || '')
      return parsed || rule
    } catch {
      return rule
    }
  }

  assessByRules(signal: SupervisorSignal): SupervisorDecision {
    if (signal.kind === 'dependency_wait') {
      return {
        state: 'waiting',
        action: 'wait',
        reason: 'Task is waiting for upstream contracts to finish.',
        source: 'rule',
        confidence: 0.95
      }
    }

    if (signal.kind === 'verification_failed') {
      return {
        state: 'needs-rework',
        action: 'retry',
        reason: signal.verifierNote || 'Verification failed; ask the same worker to repair within the contract.',
        source: 'rule',
        confidence: 0.86
      }
    }

    if (signal.kind === 'worker_error') {
      const text = (signal.error || '').toLowerCase()
      const stallLike = /timeout|timed out|无任何输出|卡死|stalled|idle|no output/.test(text)
      return {
        state: stallLike ? 'stalled' : 'failed',
        action: stallLike ? 'handoff' : 'fail',
        reason: signal.error || 'Worker returned an error.',
        source: 'rule',
        confidence: stallLike ? 0.62 : 0.78
      }
    }

    if (signal.kind === 'stall' || (signal.idleMs && signal.idleMs > this.thresholds.stallAfterMs)) {
      return {
        state: 'stalled',
        action: 'handoff',
        reason: `No meaningful progress for ${Math.round((signal.idleMs || this.thresholds.stallAfterMs) / 1000)}s.`,
        source: 'rule',
        confidence: 0.55
      }
    }

    return {
      state: 'healthy',
      action: 'continue',
      reason: 'No intervention needed.',
      source: 'rule',
      confidence: 0.9
    }
  }
}

export function supervisorPrompt(signal: SupervisorSignal, rule: SupervisorDecision): string {
  return [
    'You are the lightweight Supervisor for a multi-agent coding mission.',
    'Decide whether the worker is truly stuck, waiting for teammates, or needs rework.',
    'Rules already produced this provisional decision:',
    JSON.stringify(rule),
    '',
    'Mission signal:',
    JSON.stringify({
      missionId: signal.missionId,
      kind: signal.kind,
      contract: signal.contract,
      elapsedMs: signal.elapsedMs,
      idleMs: signal.idleMs,
      error: signal.error,
      verifierNote: signal.verifierNote,
      dependencyStatuses: signal.dependencyStatuses,
      outputPreview: signal.outputPreview
    }, null, 2),
    '',
    'Reply with ONLY JSON:',
    '{"state":"healthy|waiting|stalled|needs-rework|failed","action":"continue|wait|retry|handoff|fail","reason":"short reason","confidence":0.0}'
  ].join('\n')
}

export function parseSupervisorDecision(raw: string): SupervisorDecision | null {
  if (!raw) return null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(raw.slice(start, end + 1))
    if (!['healthy', 'waiting', 'stalled', 'needs-rework', 'failed'].includes(obj.state)) return null
    if (!['continue', 'wait', 'retry', 'handoff', 'fail'].includes(obj.action)) return null
    return {
      state: obj.state,
      action: obj.action,
      reason: typeof obj.reason === 'string' ? obj.reason : 'Supervisor decision',
      source: 'llm',
      confidence: typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
      suggestedAgentId: typeof obj.suggestedAgentId === 'string' ? obj.suggestedAgentId : undefined
    }
  } catch {
    return null
  }
}

function needsLlm(signal: SupervisorSignal, rule: SupervisorDecision): boolean {
  if (signal.kind === 'stall') return true
  if (rule.state === 'stalled' && rule.confidence < 0.7) return true
  if (signal.kind === 'worker_error' && rule.action === 'handoff') return true
  return false
}
