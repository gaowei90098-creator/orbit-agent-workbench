/* ============================================================
   AgentHub 玻璃拟态 UI — 编排模式视图（Orchestrator）
   渲染"总-agent 分解 → 子任务委派各 agent → 最终合成"的执行过程。
   纯展示组件：由 App 监听 orchestrate:* 流事件聚合成 OrchestrateState 后传入。
   契约见 COLLAB.md（lead 分解 / routeScores 指派 / 并行执行 / lead 汇总）。
   ============================================================ */

import React from 'react'
import { Icon, IC, AgentMark, Enter } from './ui'
import { AGENT_META } from './meta'
import { tr } from './i18n'
import { SpotlightPanel } from './react-bits'

export type OrchestrateSubtaskStatus = 'pending' | 'running' | 'done' | 'error'

export interface OrchestrateSubtask {
  id: string
  title: string
  detail?: string
  /** 委派到的 agent（来自 lead 建议或 routeScores 指派） */
  agentId?: string
  fileScope?: string[]
  dependsOn?: string[]
  doneWhen?: string
  verifyCommand?: string
  interfaceRef?: string
  status: OrchestrateSubtaskStatus
  content?: string
  /** O3：测试 agent 校验结论 */
  verdict?: { pass: boolean; note?: string }
}

export interface OrchestrateState {
  /** 整体阶段：planning=分解中 / awaiting-approval=等用户确认 / running=子任务执行 / synthesizing=汇总中 / done / error */
  phase: 'planning' | 'awaiting-approval' | 'running' | 'synthesizing' | 'done' | 'error'
  taskId?: string
  missionId?: string
  planArtifact?: any
  subtasks: OrchestrateSubtask[]
  /** lead 的最终合成结果 */
  final?: string
  /** 负责分解+汇总的 lead agent */
  leadAgentId?: string
  error?: string
}

const DOT: Record<OrchestrateSubtaskStatus, string> = {
  pending: 'off', running: 'busy', done: 'idle', error: 'error'
}

function statusText(s: OrchestrateSubtaskStatus): string {
  return s === 'running' ? tr('执行中', 'Running')
    : s === 'done' ? tr('完成', 'Done')
    : s === 'error' ? tr('失败', 'Failed')
    : tr('待执行', 'Pending')
}

function agentLabel(id?: string): string {
  if (!id) return tr('待指派', 'Unassigned')
  return AGENT_META[id]?.name ?? id
}

/** 单个子任务卡 */
function SubtaskRow({ st, index }: { st: OrchestrateSubtask; index: number }) {
  return (
    <SpotlightPanel className="rb-table" spotlightColor="rgba(88, 217, 149, 0.10)" style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '10px 13px', background: 'rgba(0,0,0,0.18)', borderRadius: 8, border: '1px solid rgba(170,194,220,0.08)' }}>
      <div style={{
        flex: 'none', width: 22, height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11.5, fontWeight: 700, color: 'var(--tx-2)', background: 'rgba(255,255,255,0.06)'
      }}>{index + 1}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{st.title}</span>
          <span className="ah-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className={'ah-dot ' + DOT[st.status]}></span>{statusText(st.status)}
          </span>
          {st.verdict && (
            <span className="ah-hint" style={{ color: st.verdict.pass ? 'var(--mint)' : 'var(--st-error)' }}>
              {st.verdict.pass
                ? tr('✓ 校验通过', '✓ Verified')
                : (tr('✗ 校验未过', '✗ Failed review') + (st.verdict.note ? ': ' + st.verdict.note : ''))}
            </span>
          )}
        </div>
        {st.detail && <div className="ah-hint" style={{ marginTop: 2 }}>{st.detail}</div>}
        <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {st.fileScope && st.fileScope.length > 0 && <span className="ah-chip" style={{ fontSize: 10 }}>{tr('范围', 'Scope')}: {st.fileScope.join(', ')}</span>}
          {st.dependsOn && st.dependsOn.length > 0 && <span className="ah-chip" style={{ fontSize: 10 }}>{tr('依赖', 'Deps')}: {st.dependsOn.join(', ')}</span>}
          {st.verifyCommand && <span className="ah-chip" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>{st.verifyCommand}</span>}
          {st.interfaceRef && <span className="ah-chip" style={{ fontSize: 10 }}>{st.interfaceRef}</span>}
        </div>
        {st.doneWhen && <div className="ah-hint" style={{ marginTop: 5 }}>{tr('验收：', 'Done: ')}{st.doneWhen}</div>}
        {st.content && (
          <div style={{ marginTop: 7, fontSize: 12.5, color: 'var(--tx-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 200, overflowY: 'auto', background: 'rgba(0,0,0,0.22)', borderRadius: 8, padding: '7px 10px' }}>{st.content}</div>
        )}
      </div>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }} title={agentLabel(st.agentId)}>
        {st.agentId && AGENT_META[st.agentId]
          ? <AgentMark id={st.agentId} size={26} radius={8} />
          : <div style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon d={IC.bolt} size={13} style={{ color: 'var(--tx-3)' }} /></div>}
        <span className="ah-hint" style={{ fontSize: 10, maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agentLabel(st.agentId)}</span>
      </div>
    </SpotlightPanel>
  )
}

export function OrchestrateView({ state, onApprovePlan }: { state: OrchestrateState; onApprovePlan?: (taskId: string, approved: boolean) => void }) {
  const { phase, subtasks, final, leadAgentId, error, taskId } = state
  const doneCount = subtasks.filter(s => s.status === 'done').length

  return (
    <Enter>
      <SpotlightPanel className="glass rb-command-surface" spotlightColor="rgba(88, 217, 149, 0.14)" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 头部：阶段 + lead + 进度 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon d={IC.broadcast} size={16} style={{ color: 'var(--mint)' }} />
        <span style={{ fontWeight: 700 }}>{tr('编排执行', 'Orchestration')}</span>
        {leadAgentId && AGENT_META[leadAgentId] && (
          <span className="ah-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <AgentMark id={leadAgentId} size={18} radius={5} /> {tr('总控', 'Lead')}: {agentLabel(leadAgentId)}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {subtasks.length > 0 && (
          <span className="ah-hint" style={{ fontFamily: 'var(--font-mono)' }}>{doneCount}/{subtasks.length}</span>
        )}
        <span className="ah-chip" style={{ fontSize: 11 }}>
          {phase === 'planning' ? tr('分解中…', 'Planning…')
            : phase === 'awaiting-approval' ? tr('待确认', 'Awaiting approval')
            : phase === 'running' ? tr('执行子任务', 'Running subtasks')
            : phase === 'synthesizing' ? tr('汇总中…', 'Synthesizing…')
            : phase === 'error' ? tr('出错', 'Error')
            : tr('已完成', 'Done')}
        </span>
      </div>

      {/* 分解中占位 */}
      {phase === 'planning' && subtasks.length === 0 && (
        <div className="ah-hint" style={{ padding: '8px 2px' }}>{tr('总控 agent 正在分解任务…', 'Lead agent is decomposing the task…')}</div>
      )}

      {phase === 'awaiting-approval' && taskId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '9px 11px', border: '1px solid rgba(84,214,147,0.22)', background: 'rgba(84,214,147,0.08)', borderRadius: 10 }}>
          <span className="ah-hint" style={{ flex: 1, minWidth: 220 }}>{tr('主 Agent 已生成协作流程，确认后才会派发给子 Agent。', 'The main Agent generated the workflow. Workers start only after approval.')}</span>
          <button className="ah-btn sm primary" onClick={() => onApprovePlan?.(taskId, true)}>{tr('确认派发', 'Approve')}</button>
          <button className="ah-btn sm" onClick={() => onApprovePlan?.(taskId, false)}>{tr('退回', 'Reject')}</button>
        </div>
      )}

      {/* 子任务列表 */}
      {subtasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {subtasks.map((st, i) => <SubtaskRow key={st.id} st={st} index={i} />)}
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div style={{ fontSize: 12.5, color: 'var(--st-error)', background: 'rgba(232,112,106,0.08)', border: '1px solid rgba(232,112,106,0.2)', borderRadius: 10, padding: '9px 13px' }}>{error}</div>
      )}

      {/* 最终合成 */}
      {final && (
        <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 11 }}>
          <div className="ah-label" style={{ marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon d={IC.check} size={13} style={{ color: 'var(--mint)' }} />{tr('最终合成', 'Final synthesis')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--tx-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{final}</div>
        </div>
      )}
      </SpotlightPanel>
    </Enter>
  )
}
