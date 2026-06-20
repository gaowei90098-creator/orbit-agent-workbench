/* ============================================================
   AgentHub 玻璃拟态 UI — 共享组件
   Icon / AgentMark / StatusDot / Switch / Seg / SectionTitle /
   Enter / Collapse / TaskStatusBadge
   （对应 design_handoff_glass_ui/app/components.jsx）
   ============================================================ */

import React, { useState, useEffect, CSSProperties, ReactNode } from 'react'
import { AGENT_META, AgentUIStatus, TaskUIStatus, TASK_ST } from './meta'
import { taskStatusLabel } from './i18n'

/* ---------- 线性图标（简单几何） ---------- */
export function Icon({ d, size = 17, sw = 1.7, style }: { d: ReactNode; size?: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>{d}</svg>
  )
}

export const IC = {
  home: <><path d="M4 11l8-7 8 7"></path><path d="M6 9.5V20h12V9.5"></path></>,
  chat: <><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"></path></>,
  tasks: <><path d="M5 6h14"></path><path d="M5 12h14"></path><path d="M5 18h9"></path></>,
  gear: <><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"></path></>,
  search: <><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></>,
  send: <><path d="M21 3L10.5 13.5"></path><path d="M21 3l-7 18-3.5-7.5L3 10z"></path></>,
  bolt: <><path d="M13 2L5 13.5h6L11 22l8-11.5h-6z"></path></>,
  link: <><path d="M9 15l6-6"></path><path d="M10.5 18.5l-2 2a3.5 3.5 0 0 1-5-5l3-3"></path><path d="M13.5 5.5l2-2a3.5 3.5 0 0 1 5 5l-3 3"></path></>,
  terminal: <><path d="M5 7l5 5-5 5"></path><path d="M12 17h7"></path></>,
  pulse: <><path d="M3 12h4l2.5-7 4 14 2.5-7h5"></path></>,
  chev: <><path d="M9 6l6 6-6 6"></path></>,
  chevDown: <><path d="M6 9l6 6 6-6"></path></>,
  stop: <><rect x="6.5" y="6.5" width="11" height="11" rx="2"></rect></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.34-5.66"></path><path d="M20 3v4h-4"></path></>,
  brain: <><circle cx="12" cy="12" r="8.5"></circle><path d="M12 3.5v17M7 6.5c2 1.5 2 3.5 0 5 2 1.5 2 3.5 0 5M17 6.5c-2 1.5-2 3.5 0 5-2 1.5-2 3.5 0 5"></path></>,
  plus: <><path d="M12 5v14M5 12h14"></path></>,
  x: <><path d="M6 6l12 12M18 6L6 18"></path></>,
  check: <><path d="M5 12.5l5 5L19 7"></path></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a1 1 0 0 1 1-1h10"></path></>,
  broadcast: <><circle cx="12" cy="12" r="2.2"></circle><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8"></path></>,
  min: <><path d="M5 12h14"></path></>,
  max: <><rect x="5.5" y="5.5" width="13" height="13" rx="2"></rect></>,
  folder: <><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path></>,
  pencil: <><path d="M4 20h4l10-10-4-4L4 16z"></path><path d="M14 6l4 4"></path></>,
  trash: <><path d="M5 7h14"></path><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"></path><path d="M6.5 7l1 12.2A1.5 1.5 0 0 0 9 20.7h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"></path><path d="M10 11v6M14 11v6"></path></>
}

/* ---------- Agent 徽标（官方图标贴片） ---------- */
export function AgentMark({ id, size = 44, radius = 12 }: { id: string; size?: number; radius?: number }) {
  const m = AGENT_META[id]
  if (!m) return null
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flex: 'none', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: m.tileLight
        ? 'linear-gradient(140deg, rgba(235,239,245,0.88), rgba(210,218,229,0.62))'
        : `linear-gradient(140deg, color-mix(in srgb, ${m.colorRaw} 24%, rgba(255,255,255,0.05)), rgba(255,255,255,0.03))`,
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: `0 4px 14px -4px ${m.colorRaw}55, inset 0 1px 0 rgba(255,255,255,0.18)`
    }}>
      <img src={m.icon} alt={m.name} style={{
        width: m.tileLight ? '92%' : '76%', height: m.tileLight ? '92%' : '76%',
        objectFit: 'contain', display: 'block'
      }} />
    </div>
  )
}

export function StatusDot({ status }: { status: AgentUIStatus }) {
  return <span className={'ah-dot ' + status}></span>
}

/* ---------- 动效组件 ---------- */
/* 入场：挂载后下一帧加 .mo-in，CSS transition 负责动画；off 档由 CSS 覆盖直接显示 */
export function Enter({ delay = 0, className = '', style, children, ...rest }:
  { delay?: number; className?: string; style?: CSSProperties; children?: ReactNode } & Record<string, any>) {
  const [on, setOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOn(true), 20); return () => clearTimeout(t) }, [])
  return (
    <div className={'mo-enter' + (on ? ' mo-in' : '') + (className ? ' ' + className : '')}
      style={{ ...style, transitionDelay: delay ? delay + 'ms' : undefined }} {...rest}>{children}</div>
  )
}

/* 折叠展开：grid-rows 0fr→1fr 过渡 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={'mo-collapse' + (open ? ' open' : '')}>
      <div className="mo-collapse-inner">{children}</div>
    </div>
  )
}

/* ---------- 通用控件 ---------- */
export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <div className={'ah-switch' + (on ? ' on' : '')} style={disabled ? { opacity: 0.35, pointerEvents: 'none' } : undefined}
    onClick={() => onChange(!on)}></div>
}

export interface SegOption { value: string; label: string }

export function Seg({ options, value, onChange, disabledKeys = [] }:
  { options: SegOption[]; value: string; onChange: (v: string) => void; disabledKeys?: string[] }) {
  return (
    <div className="ah-seg">
      {options.map(o => (
        <button key={o.value} className={value === o.value ? 'active' : ''}
          disabled={disabledKeys.includes(o.value)}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
      <h2 style={{ fontSize: 19, fontWeight: 700 }}>{children}</h2>
      {right}
    </div>
  )
}

export function TaskStatusBadge({ status }: { status: TaskUIStatus }) {
  const s = TASK_ST[status]
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color: s.color, flex: 'none',
      border: `1px solid color-mix(in srgb, ${s.color} 40%, transparent)`,
      background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
      borderRadius: 6, padding: '2px 9px'
    }}>{taskStatusLabel(status)}</span>
  )
}
