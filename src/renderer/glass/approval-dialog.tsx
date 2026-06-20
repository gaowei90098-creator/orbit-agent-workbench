/* ============================================================
   AgentHub — 写/执行审批弹窗（Item K）
   当某 agent 的 write/exec 策略为 'ask' 时，工具回环暂停并发 approval 事件，
   本覆盖层呈现请求详情，用户「允许 / 拒绝」经 agentic:resolveApproval 回传。
   可勾选「记住」把决定固化为该 agent 该工具的 allow/deny 覆盖。
   ============================================================ */

import React, { useState } from 'react'
import { Icon, IC, AgentMark } from './ui'
import { AGENT_META } from './meta'
import { tr } from './i18n'

export interface ApprovalItem {
  id: string
  taskId: string
  agentId: string
  tool: 'write' | 'exec'
  toolName: string
  label?: string
  detail?: string
}

const AMBER = '#f5b45a'

export function ApprovalDialog({ items, onDecide }: {
  items: ApprovalItem[]
  onDecide: (item: ApprovalItem, approved: boolean, remember: boolean) => void
}) {
  const [remember, setRemember] = useState(false)
  if (items.length === 0) return null
  const it = items[0]
  const meta = AGENT_META[it.agentId]
  const toolZh = it.tool === 'write' ? '写文件' : '执行命令'
  const toolEn = it.tool === 'write' ? 'write a file' : 'run a command'
  const decide = (approved: boolean) => { onDecide(it, approved, remember); setRemember(false) }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(8,10,14,0.55)', backdropFilter: 'blur(2px)'
    }}>
      <div className="glass" style={{
        width: 'min(540px, 92vw)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
        borderColor: 'color-mix(in srgb, ' + AMBER + ' 45%, transparent)',
        boxShadow: '0 18px 50px -12px rgba(0,0,0,0.6)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon d={IC.bolt} size={18} style={{ color: AMBER }} />
          <div style={{ fontWeight: 700, fontSize: 15 }}>{tr('需要你批准一次操作', 'Approval required')}</div>
          {items.length > 1 && (
            <span className="ah-chip" style={{ fontSize: 10.5 }}>
              {tr(`队列还有 ${items.length - 1}`, `${items.length - 1} more`)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {meta ? <AgentMark id={it.agentId} size={30} radius={8} /> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 600 }}>{meta?.name || it.agentId}</span>
            <span className="ah-hint" style={{ fontSize: 11.5 }}>
              {tr('请求', 'wants to')}{' '}
              <b style={{ color: AMBER }}>{tr(toolZh, toolEn)}</b>
            </span>
          </div>
        </div>

        {it.label && <div style={{ fontWeight: 600, fontSize: 13 }}>{it.label}</div>}
        {it.detail && (
          <pre className="mono" style={{
            margin: 0, maxHeight: 180, overflow: 'auto', fontSize: 11.5, lineHeight: 1.5,
            padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 8,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word'
          }}>{it.detail}</pre>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', color: 'var(--tx-2)' }}>
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          {tr(`记住：以后「${meta?.name || it.agentId}」的「${toolZh}」都按本次决定`,
              `Remember this decision for ${meta?.name || it.agentId}`)}
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="ah-btn" onClick={() => decide(false)}><Icon d={IC.x} size={14} /> {tr('拒绝', 'Deny')}</button>
          <button className="ah-btn primary" onClick={() => decide(true)}><Icon d={IC.check} size={14} /> {tr('允许', 'Allow')}</button>
        </div>
      </div>
    </div>
  )
}
