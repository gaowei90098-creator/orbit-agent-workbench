/* ============================================================
   AgentHub 玻璃拟态 UI — 侧边栏（218px，常驻）
   导航 + Agents 列表（点击跳会话并指定）+ proxy 地址
   ============================================================ */

import React, { ReactNode, useState } from 'react'
import { Icon, IC, AgentMark, StatusDot } from './ui'
import { AGENT_META, AGENT_IDS, AgentUIStatus, ConversationItem, WorkspaceItem } from './meta'
import { tr } from './i18n'
import { SpotlightPanel } from './react-bits'

export type PageId = 'home' | 'chat' | 'tasks' | 'settings'

const NAV: Array<{ id: PageId; zh: string; en: string; icon: ReactNode }> = [
  { id: 'home', zh: '总览', en: 'Overview', icon: IC.home },
  { id: 'chat', zh: '会话', en: 'Chat', icon: IC.chat },
  { id: 'tasks', zh: '任务', en: 'Tasks', icon: IC.tasks },
  { id: 'settings', zh: '设置', en: 'Settings', icon: IC.gear }
]

export function Sidebar({
  page, setPage, agents, activeAgent, setActiveAgent, providerCount, proxyHost,
  workspaces, activeWorkspaceId, conversations, activeConversationId,
  onNewConversation, onSelectWorkspace, onSelectConversation, onDeleteConversation
}: {
  page: PageId
  setPage: (p: PageId) => void
  agents: Record<string, { status: AgentUIStatus }>
  activeAgent: string | null
  setActiveAgent: (id: string | null) => void
  providerCount: number
  proxyHost: string
  workspaces: WorkspaceItem[]
  activeWorkspaceId: string | null
  conversations: ConversationItem[]
  activeConversationId: string | null
  onNewConversation: (workspaceId?: string | null) => void
  onSelectWorkspace: (workspaceId: string | null) => void
  onSelectConversation: (conversationId: string) => void
  onDeleteConversation: (conversationId: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const orderedConversations = conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  const orphanConversations = orderedConversations.filter(c => !c.workspaceId)
  const workspaceGroups = [
    ...workspaces.map(w => ({ id: w.id as string | null, name: w.name, rootPath: w.rootPath })),
    ...((orphanConversations.length > 0 || workspaces.length === 0)
      ? [{ id: null as string | null, name: tr('未指定工作区', 'No workspace'), rootPath: '' }]
      : [])
  ]

  return (
    <SpotlightPanel className="glass" spotlightColor="rgba(90, 167, 240, 0.13)" style={{
      width: 262, flex: 'none', display: 'flex', flexDirection: 'column',
      margin: '0 0 14px 14px', padding: 11, gap: 2, overflow: 'hidden auto', minHeight: 0
    }}>
      <div style={{ padding: '3px 10px 8px', display: 'flex', alignItems: 'center', gap: 9 }}>
        <img src="icons/orbit.png" alt="Orbit" style={{
          width: 34, height: 34, borderRadius: 9, objectFit: 'cover',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 7px 20px -10px rgba(139,145,232,0.78)'
        }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Orbit</div>
          <div className="ah-hint">{tr(`${AGENT_IDS.length} 个 Agent · ${providerCount} 个提供商`, `${AGENT_IDS.length} agents · ${providerCount} providers`)}</div>
        </div>
      </div>

      <button onClick={() => onNewConversation(activeWorkspaceId)} style={primarySideActionStyle}>
        <Icon d={IC.pencil} size={16} />
        {tr('新对话', 'New chat')}
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, padding: '4px 0 6px' }}>
        {NAV.filter(n => n.id !== 'chat').map(n => (
          <button key={n.id} onClick={() => setPage(n.id)} title={tr(n.zh, n.en)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            minHeight: 32, borderRadius: 8, border: '1px solid',
            borderColor: page === n.id ? 'rgba(139,145,232,0.26)' : 'rgba(255,255,255,0.06)',
            background: page === n.id ? 'rgba(139,145,232,0.13)' : 'rgba(255,255,255,0.035)',
            color: page === n.id ? 'var(--tx-1)' : 'var(--tx-2)',
            cursor: 'pointer', font: 'inherit', fontSize: 12
          }}>
            <Icon d={n.icon} size={14} />
            <span>{tr(n.zh, n.en)}</span>
          </button>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--glass-border)', margin: '9px 4px', flex: 'none' }}></div>
      <div className="ah-label" style={{ padding: '0 10px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {tr('工作区', 'Workspaces')}
        <button className="ah-btn sm" style={{ padding: '3px 7px', minHeight: 0 }} onClick={() => onNewConversation(activeWorkspaceId)}>
          <Icon d={IC.plus} size={12} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 'none' }}>
        {workspaceGroups.map(group => {
          const key = group.id ?? '__none__'
          const groupConversations = orderedConversations.filter(c => (c.workspaceId ?? null) === group.id)
          const visible = expanded[key] ? groupConversations : groupConversations.slice(0, 5)
          const activeGroup = (activeWorkspaceId ?? null) === group.id
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button onClick={() => onSelectWorkspace(group.id)} style={{
                display: 'flex', alignItems: 'center', gap: 8, font: 'inherit',
                color: activeGroup ? 'var(--tx-1)' : 'var(--tx-2)',
                background: activeGroup ? 'rgba(139,145,232,0.12)' : 'transparent',
                border: '1px solid',
                borderColor: activeGroup ? 'rgba(139,145,232,0.22)' : 'transparent',
                borderRadius: 8, padding: '7px 9px', cursor: 'pointer',
                textAlign: 'left'
              }}>
                <Icon d={IC.folder} size={15} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: activeGroup ? 650 : 560 }}>
                  {group.name}
                </span>
                <span className="ah-hint" style={{ fontSize: 10.5 }}>{groupConversations.length || ''}</span>
              </button>
              {visible.map(conv => (
                <div key={conv.id} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 24px', alignItems: 'center', columnGap: 4,
                  marginLeft: 20, minHeight: 29, padding: '2px 3px 2px 0', borderRadius: 7,
                  border: '1px solid',
                  borderColor: activeConversationId === conv.id ? 'rgba(88,217,149,0.24)' : 'transparent',
                  background: activeConversationId === conv.id ? 'rgba(88,217,149,0.12)' : 'transparent',
                  color: activeConversationId === conv.id ? 'var(--tx-1)' : 'var(--tx-2)',
                  font: 'inherit', fontSize: 12.5
                }}>
                  <button onClick={() => onSelectConversation(conv.id)} style={{
                    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', columnGap: 8,
                    minWidth: 0, minHeight: 25, padding: '3px 0 3px 8px',
                    border: 'none', background: 'transparent', color: 'inherit',
                    font: 'inherit', fontSize: 12.5, textAlign: 'left', cursor: 'pointer'
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: activeConversationId === conv.id ? 650 : 460 }}>
                      {conv.title || tr('新对话', 'New chat')}
                    </span>
                    <span className="ah-hint" style={{ fontSize: 10.5 }}>{formatRelativeTime(conv.updatedAt)}</span>
                  </button>
                  <button
                    title={tr('删除对话', 'Delete chat')}
                    aria-label={tr('删除对话', 'Delete chat')}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteConversation(conv.id)
                    }}
                    style={{
                      width: 22, height: 22, borderRadius: 6, border: '1px solid transparent',
                      background: 'transparent', color: 'var(--tx-3)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0
                    }}>
                    <Icon d={IC.trash} size={12} />
                  </button>
                </div>
              ))}
              {groupConversations.length > 5 && (
                <button onClick={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))} style={{
                  marginLeft: 20, minHeight: 26, padding: '3px 8px', borderRadius: 7,
                  border: '1px solid transparent', background: 'transparent', color: 'var(--tx-3)',
                  font: 'inherit', fontSize: 12, textAlign: 'left', cursor: 'pointer'
                }}>
                  {expanded[key] ? tr('收起', 'Collapse') : tr('展开显示', 'Show more')}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ borderTop: '1px solid var(--glass-border)', margin: '9px 4px', flex: 'none' }}></div>
      <div className="ah-label" style={{ padding: '0 10px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Agents <Icon d={IC.chevDown} size={13} />
      </div>
      {AGENT_IDS.map(id => {
        const a = agents[id] || { status: 'off' as AgentUIStatus }
        const sel = activeAgent === id
        return (
          <button key={id} onClick={() => { setActiveAgent(sel ? null : id); setPage('chat') }} style={{
            display: 'flex', alignItems: 'center', gap: 10, font: 'inherit',
            background: sel ? `color-mix(in srgb, ${AGENT_META[id].colorRaw} 15%, transparent)` : 'transparent',
            border: '1px solid',
            borderColor: sel ? `color-mix(in srgb, ${AGENT_META[id].colorRaw} 28%, transparent)` : 'transparent',
            borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
            color: 'var(--tx-1)', textAlign: 'left', transition: 'background 0.15s', flex: 'none'
          }}>
            <AgentMark id={id} size={28} radius={8} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: sel ? 600 : 400 }}>{AGENT_META[id].name}</span>
            <StatusDot status={a.status} />
          </button>
        )
      })}
      <div style={{ flex: 1, minHeight: 6 }}></div>
      <div className="ah-hint" style={{ padding: '8px 10px 2px', fontFamily: 'var(--font-mono)', fontSize: 10.5, flex: 'none' }}>
        proxy · {proxyHost}
      </div>
    </SpotlightPanel>
  )
}

const primarySideActionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  font: 'inherit',
  fontSize: 14,
  color: 'var(--tx-1)',
  background: 'linear-gradient(90deg, rgba(139,145,232,0.18), rgba(88,217,149,0.11))',
  border: '1px solid rgba(139,145,232,0.24)',
  borderRadius: 8,
  padding: '9px 11px',
  cursor: 'pointer',
  textAlign: 'left',
  fontWeight: 680,
  flex: 'none'
}

function formatRelativeTime(ts: number): string {
  if (!Number.isFinite(ts)) return ''
  const delta = Math.max(0, Date.now() - ts)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  if (delta < minute) return tr('刚刚', 'now')
  if (delta < hour) return tr(`${Math.floor(delta / minute)} 分`, `${Math.floor(delta / minute)}m`)
  if (delta < day) return tr(`${Math.floor(delta / hour)} 时`, `${Math.floor(delta / hour)}h`)
  if (delta < week) return tr(`${Math.floor(delta / day)} 天`, `${Math.floor(delta / day)}d`)
  if (delta < 5 * week) return tr(`${Math.floor(delta / week)} 周`, `${Math.floor(delta / week)}w`)
  return new Date(ts).toLocaleDateString()
}
