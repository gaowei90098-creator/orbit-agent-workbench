/* ============================================================
   AgentHub 玻璃拟态 UI — 自绘标题栏（46px，frame:false）
   左：三色圆点（可点击：红=关闭 黄=最小化 绿=最大化）→ AH 徽标
   中右：280px 玻璃搜索框
   右：Hub 运行状态（hub:status）
   ============================================================ */

import React from 'react'
import { Icon, IC } from './ui'
import { tr } from './i18n'
import { ShinyText } from './react-bits'

export function Titlebar({ search, onSearch, hubRunning }:
  { search: string; onSearch: (v: string) => void; hubRunning: boolean }) {
  const win = window.electronAPI?.win
  const dots: Array<{ c: string; title: string; act: () => void }> = [
    { c: '#ec6a5e', title: tr('关闭', 'Close'), act: () => win?.close() },
    { c: '#f4bf4f', title: tr('最小化', 'Minimize'), act: () => win?.minimize() },
    { c: '#61c554', title: tr('最大化/还原', 'Maximize/Restore'), act: () => win?.maximizeToggle() }
  ]
  return (
    <div className="app-drag" style={{
      height: 46, flex: 'none', display: 'flex', alignItems: 'center',
      padding: '0 16px', gap: 14, position: 'relative', zIndex: 5
    }}
      onDoubleClick={() => win?.maximizeToggle()}>
      <div className="app-no-drag" style={{ display: 'flex', gap: 8 }}>
        {dots.map(d => (
          <span key={d.c} title={d.title} onClick={d.act} style={{
            width: 12, height: 12, borderRadius: '50%', background: d.c, opacity: 0.92, cursor: 'pointer'
          }}></span>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
        <img src="icons/orbit.png" alt="Orbit" style={{
          width: 23, height: 23, borderRadius: 6, objectFit: 'cover',
          boxShadow: '0 5px 16px -8px rgba(139,145,232,0.72)',
          border: '1px solid rgba(255,255,255,0.12)'
        }} />
        <ShinyText>Orbit</ShinyText>
        <span className="ah-hint" style={{ fontWeight: 400 }}>{tr('多智能体工作台', 'Multi-Agent Workspace')}</span>
      </div>
      <div style={{ flex: 1 }}></div>
      <div className="glass app-no-drag" style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 13px',
        borderRadius: 8, width: 300, color: 'var(--tx-3)'
      }}>
        <Icon d={IC.search} size={14} />
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder={tr('搜索任务、Agent、设置…', 'Search tasks, agents, settings…')}
          style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--tx-1)', font: 'inherit', fontSize: 12.5, width: '100%' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: hubRunning ? 'var(--mint)' : 'var(--st-error)' }}>
        <span className={'ah-dot ' + (hubRunning ? 'idle' : 'error')}></span> {hubRunning ? tr('Hub 运行中', 'Hub running') : tr('Hub 未运行', 'Hub offline')}
      </div>
    </div>
  )
}
