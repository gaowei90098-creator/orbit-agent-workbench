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
  sharedContextPath?: string
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

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>
type LaneTone = OrchestrateSubtaskStatus | 'review-failed'

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

function phaseText(phase: OrchestrateState['phase']): string {
  return phase === 'planning' ? tr('分解中…', 'Planning…')
    : phase === 'awaiting-approval' ? tr('待确认', 'Awaiting approval')
    : phase === 'running' ? tr('并行执行中', 'Running in parallel')
    : phase === 'synthesizing' ? tr('汇总中…', 'Synthesizing…')
    : phase === 'error' ? tr('出错', 'Error')
    : tr('已完成', 'Done')
}

function laneTone(st: OrchestrateSubtask): LaneTone {
  if (st.status === 'error') return 'error'
  if (st.verdict && !st.verdict.pass) return 'review-failed'
  return st.status
}

function laneStatusText(st: OrchestrateSubtask): string {
  if (st.verdict && !st.verdict.pass) return tr('校验未过', 'Review failed')
  if (st.verdict?.pass) return tr('校验通过', 'Verified')
  return statusText(st.status)
}

function laneFill(st: OrchestrateSubtask): number {
  const tone = laneTone(st)
  if (tone === 'pending') return 14
  if (tone === 'running') return 78
  return 100
}

function agentColor(id?: string): string {
  return id && AGENT_META[id] ? AGENT_META[id].colorRaw : '#aab4c4'
}

function compactList(items?: string[], max = 2): string | null {
  if (!items || items.length === 0) return null
  const head = items.slice(0, max).join(', ')
  return items.length > max ? `${head} +${items.length - max}` : head
}

function clip(text: string, max = 420): string {
  const t = text.trim()
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t
}

function logLines(st: OrchestrateSubtask): string[] {
  const contentLines = (st.content || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (contentLines.length > 0) return contentLines.slice(-4)

  const lines: string[] = []
  if (st.status === 'pending') lines.push(tr('等待总控派发任务合约', 'Waiting for the lead contract'))
  if (st.status === 'running') lines.push(tr('Worker 正在执行当前合约', 'Worker is executing the current contract'))
  if (st.status === 'done') lines.push(st.verdict?.pass ? tr('产物已通过验收', 'Artifact passed verification') : tr('产物已返回，等待复核', 'Artifact returned, awaiting review'))
  if (st.status === 'error') lines.push(tr('执行失败，等待 Orbit 复盘', 'Execution failed, waiting for Orbit review'))
  if (st.verifyCommand) lines.push('$ ' + st.verifyCommand)
  if (st.doneWhen) lines.push(tr('验收：', 'Done: ') + st.doneWhen)
  if (st.detail) lines.push(st.detail)
  return lines.slice(0, 4)
}

function LaneStatusPill({ st }: { st: OrchestrateSubtask }) {
  const tone = laneTone(st)
  return (
    <span className={'orx-pill ' + tone}>
      {tone === 'running'
        ? <span className="orx-spin" />
        : tone === 'error' || tone === 'review-failed'
          ? <Icon d={IC.x} size={11} sw={2.2} />
          : tone === 'done'
            ? <Icon d={IC.check} size={12} sw={2.2} />
            : <span className={'ah-dot ' + DOT[st.status]} />}
      {laneStatusText(st)}
    </span>
  )
}

/** 单个并行泳道 */
function SubtaskLane({ st, index }: { st: OrchestrateSubtask; index: number }) {
  const tone = laneTone(st)
  const color = agentColor(st.agentId)
  const scope = compactList(st.fileScope)
  const deps = compactList(st.dependsOn, 3)
  const lines = logLines(st)
  const style = {
    '--orx-agent': color,
    '--orx-fill': laneFill(st) + '%',
    '--orx-speed': (3.1 + (index % 3) * 0.75).toFixed(2) + 's'
  } as CSSVars

  return (
    <SpotlightPanel className={'orx-lane ' + tone} spotlightColor={`color-mix(in srgb, ${color} 18%, transparent)`} style={style}>
      <div className="orx-lane-head">
        <div className="orx-index">{index + 1}</div>
        <div className="orx-agent">
          {st.agentId && AGENT_META[st.agentId]
            ? <AgentMark id={st.agentId} size={30} radius={8} />
            : <div className="orx-agent-empty"><Icon d={IC.bolt} size={13} /></div>}
        </div>
        <div className="orx-lane-title">
          <b>{st.title}</b>
          <span>{agentLabel(st.agentId)}</span>
        </div>
        <LaneStatusPill st={st} />
      </div>

      <div className="orx-progress" aria-hidden="true"><i /></div>

      <div className="orx-contract">
        {scope && <span className="orx-chip scope">{tr('范围', 'Scope')}: {scope}</span>}
        {deps && <span className="orx-chip">{tr('依赖', 'Deps')}: {deps}</span>}
        {st.verifyCommand && <span className="orx-chip mono">{st.verifyCommand}</span>}
        {st.interfaceRef && <span className="orx-chip">{st.interfaceRef}</span>}
      </div>

      {(st.detail || st.doneWhen || st.verdict?.note) && (
        <div className="orx-task-copy">
          {st.detail && <div>{st.detail}</div>}
          {st.doneWhen && <div><b>{tr('验收：', 'Done: ')}</b>{st.doneWhen}</div>}
          {st.verdict?.note && <div className={st.verdict.pass ? 'ok' : 'bad'}>{st.verdict.pass ? tr('复核：', 'Review: ') : tr('复核问题：', 'Review issue: ')}{st.verdict.note}</div>}
        </div>
      )}

      <div className="orx-log">
        {lines.map((line, i) => <span key={i}>{line}</span>)}
      </div>

      {st.content && <div className="orx-content-preview">{clip(st.content)}</div>}
    </SpotlightPanel>
  )
}

export function OrchestrateView({ state, onApprovePlan }: { state: OrchestrateState; onApprovePlan?: (taskId: string, approved: boolean) => void }) {
  const { phase, subtasks, final, leadAgentId, error, taskId, sharedContextPath } = state
  const doneCount = subtasks.filter(s => s.status === 'done').length
  const blockedCount = subtasks.filter(s => laneTone(s) === 'error' || laneTone(s) === 'review-failed').length
  const activeCount = subtasks.filter(s => s.status === 'running').length
  const leadColor = agentColor(leadAgentId || 'orbit')
  const summary = subtasks.length > 0
    ? blockedCount > 0
      ? tr(`${blockedCount} 条需复核`, `${blockedCount} need review`)
      : activeCount > 0
        ? tr(`${activeCount} 条执行中`, `${activeCount} running`)
        : tr('全部产物已回收', 'All artifacts returned')
    : tr('等待任务拆解', 'Waiting for task decomposition')

  return (
    <Enter>
      <SpotlightPanel className="glass rb-command-surface orx-shell" spotlightColor="rgba(88, 217, 149, 0.14)">
      {/* 头部：阶段 + lead + 进度 */}
      <div className="orx-header">
        <Icon d={IC.broadcast} size={16} style={{ color: 'var(--mint)' }} />
        <span className="orx-header-title">{tr('编排执行', 'Orchestration')}</span>
        {leadAgentId && AGENT_META[leadAgentId] && (
          <span className="ah-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <AgentMark id={leadAgentId} size={18} radius={5} /> {tr('总控', 'Lead')}: {agentLabel(leadAgentId)}
          </span>
        )}
        <span className="orx-live"><span className={'ah-dot ' + (phase === 'error' ? 'error' : phase === 'done' ? 'idle' : 'busy')} />{phaseText(phase)}</span>
        <div className="orx-header-spacer" />
        {subtasks.length > 0 && (
          <span className="ah-hint" style={{ fontFamily: 'var(--font-mono)' }}>{doneCount}/{subtasks.length}</span>
        )}
        <span className="ah-chip" style={{ fontSize: 11 }}>{summary}</span>
      </div>

      <div className="orx-top-grid">
        <SpotlightPanel className="orx-fanout" spotlightColor={`color-mix(in srgb, ${leadColor} 14%, transparent)`} style={{ '--orx-agent': leadColor } as CSSVars}>
          <div className="orx-core">{leadAgentId && AGENT_META[leadAgentId] ? <AgentMark id={leadAgentId} size={38} radius={9} /> : <span>O</span>}</div>
          <div className="orx-fanout-copy">
            <b>{tr('总控 Orbit', 'Orbit lead')}</b>
            <span>{tr('fan-out 派发 · 共享上下文 · 统一验收标准', 'fan-out dispatch · shared context · one acceptance bar')}</span>
            <small>{subtasks.length > 0
              ? tr(`拆解 ${subtasks.length} 个任务合约，并行交给 worker 执行。`, `Split into ${subtasks.length} task contracts and dispatched to workers in parallel.`)
              : tr('主 Agent 正在把目标整理成可执行合约。', 'The lead agent is turning the goal into executable contracts.')}</small>
            {sharedContextPath && <code className="orx-ledger">{sharedContextPath}</code>}
          </div>
          <div className="orx-dispatch">
            <span>{tr('实时派发流', 'Dispatch stream')}</span>
            <i><b /></i>
          </div>
        </SpotlightPanel>

        <SpotlightPanel className="orx-summary" spotlightColor="rgba(90, 167, 240, 0.13)">
          <span>{tr('执行进度', 'Execution progress')}</span>
          <b>{subtasks.length > 0 ? `${doneCount} / ${subtasks.length}` : '--'}</b>
          <div className="orx-summary-meter"><i style={{ width: subtasks.length > 0 ? `${Math.round((doneCount / subtasks.length) * 100)}%` : '0%' }} /></div>
          <small>{summary}</small>
        </SpotlightPanel>
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

      {/* 并行泳道 */}
      {subtasks.length > 0 && (
        <div className="orx-lanes" aria-label={tr('并行执行泳道', 'Parallel execution lanes')}>
          {subtasks.map((st, i) => <SubtaskLane key={st.id} st={st} index={i} />)}
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div style={{ fontSize: 12.5, color: 'var(--st-error)', background: 'rgba(232,112,106,0.08)', border: '1px solid rgba(232,112,106,0.2)', borderRadius: 10, padding: '9px 13px' }}>{error}</div>
      )}

      {subtasks.length > 0 && (
        <div className="orx-merge-grid">
          <SpotlightPanel className={'orx-merge ' + (final ? 'done' : phase === 'synthesizing' ? 'running' : '')} spotlightColor="rgba(88, 217, 149, 0.13)">
            <div className="orx-merge-icon"><Icon d={final ? IC.check : IC.chevDown} size={15} /></div>
            <div className="orx-merge-copy">
              <b>{tr('Orbit fan-in 合成', 'Orbit fan-in synthesis')}</b>
              <small>{final
                ? tr('已汇聚通过验收的产物并生成最终答复。', 'Verified artifacts were merged into the final answer.')
                : blockedCount > 0
                  ? tr('失败/复核轨道会返回修复，不伪装成完成。', 'Failed or review-blocked lanes return for repair instead of pretending to be complete.')
                  : tr('等待 worker 产物回流后进入最终合成。', 'Waiting for worker artifacts before final synthesis.')}</small>
            </div>
          </SpotlightPanel>
          <SpotlightPanel className="orx-bridge" spotlightColor="rgba(170, 194, 220, 0.10)">
            <div className="orx-merge-icon">H</div>
            <div className="orx-merge-copy">
              <b>{tr('Hermes 远程通报', 'Hermes bridge')}</b>
              <small>{tr('只负责进度通知与确认回传，不进入执行 worker 池。', 'Handles notifications and approvals only; not an execution worker.')}</small>
            </div>
          </SpotlightPanel>
        </div>
      )}

      {/* 最终合成 */}
      {final && (
        <div className="orx-final">
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
