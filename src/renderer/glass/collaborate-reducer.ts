import { CollaborateState, CollaborateTurn } from './collaborate-view'

export function initialCollaborateState(): CollaborateState {
  return { phase: 'running', participants: [], rounds: 3, turns: [] }
}

export function applyCollaborateEvent(prev: CollaborateState | undefined, ev: any): CollaborateState {
  const state: CollaborateState = prev
    ? { ...prev, turns: prev.turns.map(turn => ({ ...turn })) }
    : initialCollaborateState()
  const base = ev?.taskId ? { ...state, taskId: String(ev.taskId), missionId: ev.missionId ?? state.missionId } : state

  switch (ev?.kind) {
    case 'collaborate:start':
      return {
        ...base,
        phase: 'running',
        participants: Array.isArray(ev.participants) ? ev.participants.map(String) : [],
        rounds: typeof ev.rounds === 'number' ? ev.rounds : 3,
        topic: typeof ev.topic === 'string' ? ev.topic : state.topic,
        turns: []
      }

    case 'collaborate:turn': {
      const id = `${ev.round || 0}-${ev.agentId || 'agent'}`
      const turns = base.turns.slice()
      let idx = turns.findIndex(turn => turn.id === id)
      if (idx < 0) {
        const turn: CollaborateTurn = {
          id,
          round: Number(ev.round || 0),
          agentId: String(ev.agentId || 'agent'),
          status: 'running',
          content: ''
        }
        turns.push(turn)
        idx = turns.length - 1
      }
      turns[idx] = {
        ...turns[idx],
        status: ev.status || turns[idx].status,
        content: typeof ev.content === 'string' ? ev.content : turns[idx].content,
        error: typeof ev.error === 'string' ? ev.error : turns[idx].error
      }
      return { ...base, phase: ev.status === 'error' ? 'error' : base.phase, turns }
    }

    case 'collaborate:synthesizing':
      return { ...base, phase: 'synthesizing', leadAgentId: ev.leadAgentId ?? state.leadAgentId }

    case 'collaborate:final':
      return { ...base, phase: 'done', final: typeof ev.content === 'string' ? ev.content : state.final }

    case 'collaborate:error':
      return { ...base, phase: 'error', error: ev.error || 'collaboration error' }

    default:
      return state
  }
}
