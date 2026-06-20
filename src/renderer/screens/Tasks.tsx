/* ============================================================
   AgentHub 玻璃拟态 UI — 任务历史页
   筛选分段 + 顶栏搜索联动 + 行展开详情 + 运行中可取消
   ============================================================ */

import React, { useState } from 'react'
import { Icon, IC, AgentMark, Enter, Seg, SectionTitle, Collapse, TaskStatusBadge } from '../glass/ui'
import { TaskItem, fmtDur, sumTokens, fmtTokens, usageTotal, sumCost, costOf, fmtCost } from '../glass/meta'
import { tr, modeLabel } from '../glass/i18n'
import { SetupTab, firstRunActionForError } from '../glass/connection-status'
import { ActivityTrail } from '../glass/activity-view'
import { SpotlightPanel } from '../glass/react-bits'

/** 结果一键复制（带 1.2s “已复制”反馈） */
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="ah-btn sm" title={tr('复制结果', 'Copy result')}
      style={{ flex: 'none', padding: '4px 9px' }}
      onClick={(e) => {
        e.stopPropagation()
        try { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) } catch { /* noop */ }
      }}>
      <Icon d={done ? IC.check : IC.copy} size={12} /> {done ? tr('已复制', 'Copied') : tr('复制', 'Copy')}
    </button>
  )
}

export function TasksScreen({ tasks, search, onCancelTask, openSetup }: {
  tasks: TaskItem[]
  search: string
  onCancelTask: (id: string) => void
  openSetup: (tab?: SetupTab) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')

  const visible = tasks.filter(t =>
    (filter === 'all' || t.status === filter) &&
    (!search || t.text.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div data-screen-label="任务" style={{ padding: '6px 4px 30px' }}>
      <SectionTitle right={
        <Seg value={filter} onChange={setFilter} options={[
          { value: 'all', label: tr('全部', 'All') }, { value: 'running', label: tr('运行中', 'Running') },
          { value: 'completed', label: tr('已完成', 'Done') }, { value: 'failed', label: tr('失败', 'Failed') }
        ]} />
      }>{tr('任务历史', 'Task history')}</SectionTitle>

      {visible.length === 0 && (
        <SpotlightPanel className="glass" spotlightColor="rgba(90, 167, 240, 0.12)" style={{ padding: 40, textAlign: 'center', color: 'var(--tx-3)' }}>{tr('没有匹配的任务', 'No matching tasks')}</SpotlightPanel>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.map((t, i) => {
          const isOpen = open === t.id
          return (
            <Enter key={t.id} delay={i * 45}>
              <SpotlightPanel className="glass hover-glow rb-table" spotlightColor="rgba(90, 167, 240, 0.12)" style={{ overflow: 'hidden' }}>
                <div onClick={() => setOpen(isOpen ? null : t.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 13, padding: '13px 18px', cursor: 'pointer'
                }}>
                  <TaskStatusBadge status={t.status} />
                  <span style={{ flex: 1, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
                  <span className="ah-chip">{modeLabel(t.mode)}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {t.agents.map(a => <AgentMark key={a} id={a} size={20} radius={6} />)}
                  </div>
                  {sumTokens(t.usage) > 0 && (
                    <span className="ah-chip" title={tr('Token 总量 / 估算费用', 'Total tokens / est. cost')} style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {fmtTokens(sumTokens(t.usage))} tok{sumCost(t.usage) != null ? ` · ≈${fmtCost(sumCost(t.usage)!)}` : ''}
                    </span>
                  )}
                  <span className="ah-hint" style={{ width: 50, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {t.status === 'running' ? '…' : fmtDur(t.durationMs)}
                  </span>
                  <span className="ah-hint" style={{ width: 40, textAlign: 'right' }}>{t.createdAt}</span>
                  {t.status === 'running'
                    ? <button className="ah-btn sm danger" onClick={e => { e.stopPropagation(); onCancelTask(t.id) }}>{tr('取消', 'Cancel')}</button>
                    : <Icon d={IC.chevDown} size={14} style={{ color: 'var(--tx-3)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
                </div>
                <Collapse open={isOpen}>
                  <div style={{ borderTop: '1px solid var(--glass-border)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)' }}>{t.id} · {modeLabel(t.mode)} · {tr(`${t.agents.length} 个 Agent`, `${t.agents.length} agents`)}</div>
                  {sumTokens(t.usage) > 0 && (
                    <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ color: 'var(--mint)' }}>{tr('Token 合计', 'Total tokens')} {fmtTokens(sumTokens(t.usage))}{sumCost(t.usage) != null ? ` · ≈${fmtCost(sumCost(t.usage)!)}` : ''}</span>
                      {Object.entries(t.usage!).map(([aid, u]) => (
                        <span key={aid} style={{ color: 'var(--tx-3)' }}>
                          {aid}: {fmtTokens(usageTotal(u))} (↑{fmtTokens(u.prompt_tokens || 0)} ↓{fmtTokens(u.completion_tokens || 0)}){costOf(u) != null ? ` ≈${fmtCost(costOf(u)!)}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {t.results && Object.entries(t.results).map(([agentId, content]) => (
                    <div key={agentId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <AgentMark id={agentId} size={24} radius={7} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {t.steps?.[agentId]?.length ? <ActivityTrail steps={t.steps[agentId]} running={t.status === 'running'} /> : null}
                        <div style={{ fontSize: 13, color: 'var(--tx-2)', background: 'rgba(0,0,0,0.18)', borderRadius: 10, padding: '9px 13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>
                      </div>
                      {content && <CopyBtn text={content} />}
                    </div>
                  ))}
                  {t.errors && Object.entries(t.errors).map(([agentId, err]) => {
                    const action = firstRunActionForError(err)
                    return (
                      <div key={agentId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <AgentMark id={agentId} size={24} radius={7} />
                        <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {t.steps?.[agentId]?.length ? <ActivityTrail steps={t.steps[agentId]} running={false} /> : null}
                          <div style={{ fontSize: 12.5, color: 'var(--st-error)', background: 'rgba(232,112,106,0.08)', border: '1px solid rgba(232,112,106,0.2)', borderRadius: 10, padding: '9px 13px', fontFamily: 'var(--font-mono)' }}>{err}</div>
                        </div>
                        {action && (
                          <button className="ah-btn sm primary" onClick={() => openSetup(action.tab)}>
                            {tr(action.labelZh, action.labelEn)}
                          </button>
                        )}
                        {err && <CopyBtn text={err} />}
                      </div>
                    )
                  })}
                  {/* steps-only（运行中尚无 result/error 的 agent）也展示活动轨迹 */}
                  {t.steps && Object.entries(t.steps).map(([agentId, steps]) =>
                    (steps?.length && !t.results?.[agentId] && !t.errors?.[agentId]) ? (
                      <div key={`steps-${agentId}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <AgentMark id={agentId} size={24} radius={7} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <ActivityTrail steps={steps} running={t.status === 'running'} />
                        </div>
                      </div>
                    ) : null
                  )}
                  </div>
                </Collapse>
              </SpotlightPanel>
            </Enter>
          )
        })}
      </div>
    </div>
  )
}
