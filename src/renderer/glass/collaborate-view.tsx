import React from 'react'
import { Icon, IC, AgentMark, Enter } from './ui'
import { AGENT_META } from './meta'
import { tr } from './i18n'
import { SpotlightPanel } from './react-bits'

export type CollaboratePhase = 'running' | 'synthesizing' | 'done' | 'error'
export type CollaborateTurnStatus = 'running' | 'done' | 'error'

export interface CollaborateTurn {
  id: string
  round: number
  agentId: string
  status: CollaborateTurnStatus
  content?: string
  error?: string
}

export interface CollaborateState {
  phase: CollaboratePhase
  taskId?: string
  missionId?: string
  topic?: string
  participants: string[]
  rounds: number
  turns: CollaborateTurn[]
  final?: string
  leadAgentId?: string
  error?: string
}

function agentName(id: string): string {
  return AGENT_META[id]?.name ?? id
}

function phaseLabel(phase: CollaboratePhase): string {
  return phase === 'running' ? tr('轮流协作中', 'Collaborating')
    : phase === 'synthesizing' ? tr('Orbit 合成中', 'Orbit synthesizing')
    : phase === 'done' ? tr('已完成', 'Done')
    : tr('出错', 'Error')
}

function TurnCard({ turn, index }: { turn: CollaborateTurn; index: number }) {
  const meta = AGENT_META[turn.agentId]
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: index % 2 === 0 ? '34px minmax(0, 1fr)' : 'minmax(0, 1fr) 34px',
      gap: 10,
      alignItems: 'start'
    }}>
      {index % 2 === 0 && <AgentSlot agentId={turn.agentId} />}
      <div style={{
        border: '1px solid',
        borderColor: meta ? `color-mix(in srgb, ${meta.colorRaw} 30%, transparent)` : 'var(--glass-border)',
        background: 'rgba(10, 17, 25, 0.66)',
        borderRadius: 8,
        padding: '9px 12px',
        minWidth: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 650 }}>{agentName(turn.agentId)}</span>
          <span className="ah-chip" style={{ fontSize: 10 }}>{tr('第', 'Round ')}{turn.round}{tr('轮', '')}</span>
          <span className="ah-hint" style={{ color: turn.status === 'error' ? 'var(--st-error)' : turn.status === 'done' ? 'var(--mint)' : 'var(--st-busy)' }}>
            {turn.status === 'running' ? tr('发言中…', 'Speaking…') : turn.status === 'done' ? tr('已回应', 'Responded') : tr('失败', 'Failed')}
          </span>
        </div>
        {turn.error ? (
          <div style={{ color: 'var(--st-error)', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{turn.error}</div>
        ) : turn.content ? (
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, color: 'var(--tx-1)' }}>{turn.content}</div>
        ) : (
          <span className="ah-thinking">
            <span>{tr('等待输出', 'Waiting')}</span>
            <span className="ah-thinking-dots"><i></i><i></i><i></i></span>
          </span>
        )}
      </div>
      {index % 2 === 1 && <AgentSlot agentId={turn.agentId} />}
    </div>
  )
}

function AgentSlot({ agentId }: { agentId: string }) {
  return AGENT_META[agentId]
    ? <AgentMark id={agentId} size={34} radius={9} />
    : <div className="ah-chat-avatar agent"><Icon d={IC.bolt} size={15} /></div>
}

export function CollaborateView({ state }: { state: CollaborateState }) {
  return (
    <Enter>
      <SpotlightPanel className="glass rb-command-surface" spotlightColor="rgba(90, 167, 240, 0.15)" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Icon d={IC.broadcast} size={16} style={{ color: 'var(--cyan)' }} />
          <span style={{ fontWeight: 700 }}>{tr('多轮协作', 'Multi-turn collaboration')}</span>
          <span className="ah-chip">{phaseLabel(state.phase)}</span>
          {state.rounds > 0 && <span className="ah-hint" style={{ fontFamily: 'var(--font-mono)' }}>{state.turns.length}/{state.rounds * Math.max(1, state.participants.length)}</span>}
          <div style={{ flex: 1 }} />
          {state.participants.map(id => <span key={id} className="ah-chip" style={{ fontSize: 10 }}>{agentName(id)}</span>)}
        </div>

        {state.topic && <div className="ah-hint">{state.topic}</div>}

        {state.turns.length === 0 && state.phase === 'running' && (
          <div className="ah-hint" style={{ padding: '8px 2px' }}>{tr('正在启动协作线程…', 'Starting the shared collaboration thread…')}</div>
        )}

        {state.turns.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {state.turns.map((turn, index) => <TurnCard key={turn.id} turn={turn} index={index} />)}
          </div>
        )}

        {state.phase === 'synthesizing' && (
          <div className="ah-hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="ah-dot busy"></span>
            {tr('Orbit 正在读取完整 transcript 并合成结论…', 'Orbit is reading the transcript and synthesizing the conclusion…')}
          </div>
        )}

        {state.error && (
          <div style={{ fontSize: 12.5, color: 'var(--st-error)', background: 'rgba(232,112,106,0.08)', border: '1px solid rgba(232,112,106,0.2)', borderRadius: 8, padding: '9px 12px' }}>{state.error}</div>
        )}

        {state.final && (
          <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 11 }}>
            <div className="ah-label" style={{ marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon d={IC.check} size={13} style={{ color: 'var(--mint)' }} />
              {tr('Orbit 结论', 'Orbit conclusion')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--tx-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{state.final}</div>
          </div>
        )}
      </SpotlightPanel>
    </Enter>
  )
}
