import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * ApprovalConfig 单测 — 覆盖：默认全 allow（零回归）、setDefault、per-agent 覆盖优先 +
 * null 清除回落、guardedToolFor 只读工具不门禁、坏数据兜底。store 以内存对象替身。
 */

let store: Record<string, any>

vi.mock('../../store', () => ({
  store: {
    get: (k: string) => store[k],
    set: (k: string, v: any) => { store[k] = v }
  }
}))

beforeEach(() => { store = {} })

describe('ApprovalConfig', () => {
  it('默认全 allow（与 0.3.0 行为一致）', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    expect(cfg.policyFor('claude', 'write')).toBe('allow')
    expect(cfg.policyFor('codex', 'exec')).toBe('allow')
    expect(cfg.getConfig().default).toEqual({ write: 'allow', exec: 'allow' })
    expect(cfg.getConfig().overrides).toEqual({})
  })

  it('setDefault 改全局默认（不影响另一工具）', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    cfg.setDefault('exec', 'ask')
    expect(cfg.policyFor('anyone', 'exec')).toBe('ask')
    expect(cfg.policyFor('anyone', 'write')).toBe('allow')
  })

  it('per-agent 覆盖优先；null 清除后回落默认', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    cfg.setDefault('write', 'ask')
    cfg.setOverride('claude', 'write', 'deny')
    expect(cfg.policyFor('claude', 'write')).toBe('deny')  // 覆盖生效
    expect(cfg.policyFor('codex', 'write')).toBe('ask')    // 他者回落默认
    cfg.setOverride('claude', 'write', null)
    expect(cfg.policyFor('claude', 'write')).toBe('ask')   // 清除后回落
    expect(cfg.getConfig().overrides.claude).toBeUndefined() // 空覆盖条目被删除
  })

  it('guardedToolFor：只读工具（fs_read/fs_list）不门禁', async () => {
    const { guardedToolFor } = await import('../approval')
    expect(guardedToolFor('fs_write')).toBe('write')
    expect(guardedToolFor('exec')).toBe('exec')
    expect(guardedToolFor('fs_read')).toBeNull()
    expect(guardedToolFor('fs_list')).toBeNull()
    expect(guardedToolFor('unknown')).toBeNull()
  })

  it('坏数据兜底为默认 allow', async () => {
    store['agentic.approval.v1'] = { default: { write: 'nonsense' }, overrides: { x: 'bad' } }
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    expect(cfg.policyFor('x', 'write')).toBe('allow')
    expect(cfg.policyFor('x', 'exec')).toBe('allow')
  })
})
