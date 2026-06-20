import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * AgenticConfig v2 单测 — 覆盖：默认 mode='all'（全员对齐）、all 模式下显式停用、
 * selected 模式语义、v1→v2 迁移。store 经 vi.mock 换成内存对象（与其它管理器同套路）。
 */

let store: Record<string, any>

vi.mock('../../store', () => ({
  store: {
    get: (k: string) => store[k],
    set: (k: string, v: any) => { store[k] = v }
  }
}))

beforeEach(() => { store = {} })

describe('AgenticConfig v2', () => {
  it('默认 mode=all：所有 manifest agent 启用', async () => {
    const { getAgenticConfig } = await import('../config')
    const { AGENTS } = await import('../../hub/agents')
    const cfg = getAgenticConfig()
    expect(cfg.getMode()).toBe('all')
    for (const a of AGENTS) expect(cfg.isEnabled(a.id)).toBe(true)
    expect(cfg.getEnabled().sort()).toEqual(AGENTS.map(a => a.id).sort())
  })

  it('all 模式下 setEnabled(false) = 加入停用名单，仅影响该 agent', async () => {
    const { getAgenticConfig } = await import('../config')
    const cfg = getAgenticConfig()
    cfg.setEnabled('codex', false)
    expect(cfg.isEnabled('codex')).toBe(false)
    expect(cfg.isEnabled('claude')).toBe(true)
    cfg.setEnabled('codex', true)
    expect(cfg.isEnabled('codex')).toBe(true)
  })

  it('selected 模式：仅名单内启用', async () => {
    const { getAgenticConfig } = await import('../config')
    const cfg = getAgenticConfig()
    cfg.setMode('selected')
    expect(cfg.isEnabled('codex')).toBe(false)
    cfg.setEnabled('codex', true)
    expect(cfg.isEnabled('codex')).toBe(true)
    expect(cfg.isEnabled('claude')).toBe(false)
    expect(cfg.getEnabled()).toEqual(['codex'])
  })

  it('v1 迁移：{version:1, httpEnabled} → selected 模式，尊重旧显式选择', async () => {
    store['agentic.v1'] = { version: 1, httpEnabled: ['claude'] }
    const { getAgenticConfig } = await import('../config')
    const cfg = getAgenticConfig()
    expect(cfg.getMode()).toBe('selected')
    expect(cfg.isEnabled('claude')).toBe(true)
    expect(cfg.isEnabled('codex')).toBe(false)
  })
})
