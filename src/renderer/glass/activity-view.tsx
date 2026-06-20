/* ============================================================
   AgentHub — agentic 活动轨迹（折叠步骤卡）
   Track A/B 共享：stdio stream-json / HTTP act-observe 解析出的 ActivityStep[]
   在 Chat（实时）与 Tasks（历史记录）两处复用同一展示组件。
   ============================================================ */

import React, { useState } from 'react'
import { Icon, IC } from './ui'
import { tr } from './i18n'
import { ActivityStep } from './meta'

/* 按工具名/标题映射到线性图标 */
const STEP_ICON: Array<{ re: RegExp; ic: keyof typeof IC }> = [
  { re: /bash|shell|exec|command|terminal|run|cmd/i, ic: 'terminal' },
  { re: /write|edit|create|update|patch|apply/i, ic: 'pencil' },
  { re: /read|grep|glob|search|find|list|ls|cat|view/i, ic: 'search' },
  { re: /fetch|web|http|browse|url/i, ic: 'link' }
]

function stepIcon(step: ActivityStep): keyof typeof IC {
  if (step.kind === 'thinking') return 'brain'
  if (step.kind === 'note') return 'pulse'
  if (step.kind === 'text') return 'chat'
  const key = `${step.tool || ''} ${step.label || ''}`
  for (const m of STEP_ICON) if (m.re.test(key)) return m.ic
  return 'bolt'
}

function StepStatus({ status }: { status: ActivityStep['status'] }) {
  if (status === 'done') return <Icon d={IC.check} size={13} style={{ color: 'var(--st-idle)' }} />
  if (status === 'error') return <Icon d={IC.x} size={12} style={{ color: 'var(--st-error)' }} />
  return <span className="ah-act-dot ah-act-running-dot" style={{ background: 'var(--st-busy)' }} />
}

function StepRow({ step }: { step: ActivityStep }) {
  const [open, setOpen] = useState(false)
  const expandable = !!(step.detail || step.output)
  return (
    <div className="ah-act-step">
      <div className={`ah-act-row${expandable ? ' clickable' : ''}`} onClick={expandable ? () => setOpen(o => !o) : undefined}>
        <span className="ah-act-ico"><Icon d={IC[stepIcon(step)]} size={13} /></span>
        <span className="ah-act-label" title={step.label}>{step.label}</span>
        {expandable && <Icon d={IC.chev} size={11} style={{ color: 'var(--tx-3)' }} />}
        <span className="ah-act-st"><StepStatus status={step.status} /></span>
      </div>
      {open && step.detail && <div className="ah-act-detail">{step.detail}</div>}
      {open && step.output && <div className="ah-act-detail">{step.output}</div>}
    </div>
  )
}

/** 折叠的活动轨迹卡：默认收起，标题给出"运行中的当前步骤"或"N 步活动"概览；展开列全部步骤。 */
export function ActivityTrail({ steps, running }: { steps: ActivityStep[]; running: boolean }) {
  const [open, setOpen] = useState(false)
  if (!steps.length) return null
  const last = steps[steps.length - 1]
  const headline = running && last
    ? last.label
    : tr(`${steps.length} 步活动`, `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`)
  return (
    <div className="ah-act">
      <div className="ah-act-head" onClick={() => setOpen(o => !o)}>
        <span className={`ah-act-chev${open ? ' open' : ''}`}><Icon d={IC.chev} size={11} /></span>
        {running
          ? <span className="ah-act-dot ah-act-running-dot" style={{ background: 'var(--st-busy)' }} />
          : <Icon d={IC.check} size={12} style={{ color: 'var(--st-idle)' }} />}
        <span className="ah-act-label" title={headline}>{headline}</span>
        {!open && <span style={{ color: 'var(--tx-3)', fontSize: 11 }}>· {steps.length}</span>}
      </div>
      {open && (
        <div className="ah-act-list">
          {steps.map(s => <StepRow key={s.id} step={s} />)}
        </div>
      )}
    </div>
  )
}
