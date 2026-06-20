/* ============================================================
   AgentHub — 本次会话预算（前端持久化，advisory + 软上限）
   支持两种计量口径：tokens（确定）或 cost（按估算费用 USD）。
   两种口径各自保存上限，切换不互相覆盖。limit = 0 表示未设。
   ============================================================ */

import { useSyncExternalStore } from 'react'

export type BudgetMode = 'tokens' | 'cost'

const read = (k: string): number => {
  try { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : 0 } catch { return 0 }
}

let mode: BudgetMode = (() => {
  try { return localStorage.getItem('ah-budget-mode') === 'cost' ? 'cost' : 'tokens' } catch { return 'tokens' }
})()
let tokenLimit = read('ah-budget-tokens')   // tokens
let costLimit = read('ah-budget-cost')       // USD

const listeners = new Set<() => void>()
const notify = () => listeners.forEach(f => f())
const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb) }

export function getBudgetMode(): BudgetMode { return mode }
export function setBudgetMode(m: BudgetMode): void {
  mode = m === 'cost' ? 'cost' : 'tokens'
  try { localStorage.setItem('ah-budget-mode', mode) } catch { /* noop */ }
  notify()
}

/** 当前口径下的上限（tokens 或 USD） */
export function getBudget(): number { return mode === 'cost' ? costLimit : tokenLimit }

export function setBudget(n: number): void {
  const v = Number.isFinite(n) && n > 0 ? (mode === 'cost' ? n : Math.floor(n)) : 0
  if (mode === 'cost') { costLimit = v; try { localStorage.setItem('ah-budget-cost', String(v)) } catch { /* noop */ } }
  else { tokenLimit = v; try { localStorage.setItem('ah-budget-tokens', String(v)) } catch { /* noop */ } }
  notify()
}

/** 当前口径下的上限（基元快照，避免对象快照导致的重渲染循环） */
export function useBudget(): number {
  return useSyncExternalStore(subscribe, getBudget)
}
export function useBudgetMode(): BudgetMode {
  return useSyncExternalStore(subscribe, getBudgetMode)
}

/** 告警阈值：用量达预算的此比例即进入 warn */
export const ALERT_PCT = 0.8

/** 预算状态：none(未设) / ok / warn(≥80%) / over(≥100%) */
export function budgetLevel(used: number, lim: number): 'none' | 'ok' | 'warn' | 'over' {
  if (!lim || lim <= 0) return 'none'
  const r = used / lim
  if (r >= 1) return 'over'
  if (r >= ALERT_PCT) return 'warn'
  return 'ok'
}
