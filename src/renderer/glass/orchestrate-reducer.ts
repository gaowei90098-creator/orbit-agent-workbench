/* ============================================================
   编排模式 — 纯 reducer：把 orchestrate:* 流事件折叠成 OrchestrateState
   App 的 onStream 收到 orchestrate:* 事件时调用本函数即可（接线只需一行）。
   事件契约见 COLLAB.md：orchestrate:plan / orchestrate:subtask / orchestrate:final。
   ============================================================ */

import { OrchestrateState, OrchestrateSubtask } from './orchestrate-view'

export function initialOrchestrateState(): OrchestrateState {
  return { phase: 'planning', subtasks: [] }
}

/** 纯函数：依据一条 orchestrate:* 事件返回新状态（不可变更新）。未知事件原样返回。 */
export function applyOrchestrateEvent(prev: OrchestrateState | undefined, ev: any): OrchestrateState {
  const state: OrchestrateState = prev
    ? { ...prev, subtasks: prev.subtasks.map(s => ({ ...s })) }
    : initialOrchestrateState()
  const base = ev?.taskId ? { ...state, taskId: String(ev.taskId), missionId: ev.missionId ?? state.missionId } : state

  switch (ev?.kind) {
    case 'orchestrate:plan': {
      const subtasks: OrchestrateSubtask[] = Array.isArray(ev.subtasks)
        ? ev.subtasks.map((s: any) => ({
            id: String(s.id),
            title: s.title || String(s.id),
            detail: s.detail,
            agentId: s.agentId,
            fileScope: Array.isArray(s.fileScope) ? s.fileScope : undefined,
            dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : undefined,
            doneWhen: s.doneWhen,
            verifyCommand: s.verifyCommand,
            interfaceRef: s.interfaceRef,
            status: 'pending' as const,
            content: ''
          }))
        : []
      return {
        ...base,
        phase: ev.planArtifact?.status === 'awaiting-approval' ? 'awaiting-approval' : 'running',
        subtasks,
        leadAgentId: ev.leadAgentId ?? state.leadAgentId,
        planArtifact: ev.planArtifact ?? state.planArtifact
      }
    }

    case 'orchestrate:approval': {
      if (ev.status === 'awaiting') return { ...base, phase: 'awaiting-approval', planArtifact: ev.planArtifact ?? state.planArtifact }
      if (ev.status === 'approved') return { ...base, phase: 'running', planArtifact: ev.planArtifact ?? state.planArtifact }
      if (ev.status === 'rejected') return { ...base, phase: 'error', error: 'Plan rejected' }
      return base
    }

    case 'orchestrate:subtask': {
      const subtasks = base.subtasks.slice()
      let idx = subtasks.findIndex(s => s.id === String(ev.subtaskId))
      if (idx < 0) {
        subtasks.push({ id: String(ev.subtaskId), title: ev.title || String(ev.subtaskId), status: 'pending' })
        idx = subtasks.length - 1
      }
      const cur = { ...subtasks[idx] }
      if (ev.agentId) cur.agentId = ev.agentId
      if (ev.status) cur.status = ev.status
      if (typeof ev.contentDelta === 'string') cur.content = (cur.content || '') + ev.contentDelta
      else if (typeof ev.content === 'string') cur.content = ev.content
      subtasks[idx] = cur
      return { ...base, subtasks }
    }

    case 'orchestrate:verdict': {
      const subtasks = base.subtasks.map(s =>
        s.id === String(ev.subtaskId) ? { ...s, verdict: { pass: !!ev.pass, note: ev.note } } : s)
      return { ...base, subtasks }
    }

    case 'orchestrate:synthesizing':
      return { ...base, phase: 'synthesizing' }

    case 'orchestrate:final':
      return { ...base, phase: 'done', final: typeof ev.content === 'string' ? ev.content : state.final }

    case 'orchestrate:error':
      return { ...base, phase: 'error', error: ev.error || 'orchestration error' }

    default:
      return state
  }
}
