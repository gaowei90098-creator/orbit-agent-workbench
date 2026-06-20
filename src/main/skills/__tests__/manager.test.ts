import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * SkillManager 单测 — 覆盖：add/list、单独安装/卸载、'*' 集体安装、remove 级联清除安装表。
 * 经 vi.mock 把 store 换成内存对象（与 workspace.test.ts 同套路），与 electron 解耦。
 */

let store: Record<string, any>

vi.mock('../../store', () => ({
  store: {
    get: (k: string) => store[k],
    set: (k: string, v: any) => { store[k] = v }
  }
}))

beforeEach(() => { store = {} })

describe('SkillManager', () => {
  it('add/list 读写一致', async () => {
    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    const s = m.add({ name: 'A', instructions: 'do A', tags: ['x'] })
    expect(s.id).toBeTruthy()
    expect(m.list().map(x => x.name)).toContain('A')
    expect(m.get(s.id)?.instructions).toBe('do A')
  })

  it('单独安装/卸载 只影响目标 agent', async () => {
    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    const s = m.add({ name: 'A', instructions: 'x' })
    m.install('codex', s.id)
    expect(m.isInstalled('codex', s.id)).toBe(true)
    expect(m.isInstalled('claude', s.id)).toBe(false)
    expect(m.installedFor('codex').map(x => x.id)).toEqual([s.id])
    m.uninstall('codex', s.id)
    expect(m.isInstalled('codex', s.id)).toBe(false)
  })

  it("'*' 集体安装覆盖所有 manifest agent", async () => {
    const { getSkillManager } = await import('../manager')
    const { AGENTS } = await import('../../hub/agents')
    const m = getSkillManager()
    const s = m.add({ name: 'A', instructions: 'x' })
    m.install('*', s.id)
    for (const a of AGENTS) expect(m.isInstalled(a.id, s.id)).toBe(true)
  })

  it('install 未知技能为 no-op；不重复安装', async () => {
    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    m.install('codex', 'nope')
    expect(m.getInstalls().codex || []).not.toContain('nope')
    const s = m.add({ name: 'A', instructions: 'x' })
    m.install('codex', s.id)
    m.install('codex', s.id)
    expect((m.getInstalls().codex || []).filter(id => id === s.id)).toHaveLength(1)
  })

  it('remove 级联从安装表清除', async () => {
    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    const s = m.add({ name: 'A', instructions: 'x' })
    m.install('*', s.id)
    expect(m.remove(s.id)).toBe(true)
    expect(m.list()).toHaveLength(0)
    expect(m.installedFor('codex')).toHaveLength(0)
  })
})
