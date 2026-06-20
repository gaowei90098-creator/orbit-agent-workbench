import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * WorkspaceManager 单测 — 覆盖：
 *   1) list/getById 读写一致
 *   2) create 路径校验（不存在 / 不是目录）
 *   3) update 改名校验
 *   4) remove 真的删了
 *   5) setActive / getActive + 删除活动时清空
 *   6) 空 store 落盘后重新实例化仍能恢复
 */

let tempDir: string
let store: Record<string, any>

vi.mock('../../store', () => ({
  store: {
    get: (k: string) => store[k],
    set: (k: string, v: any) => { store[k] = v }
  }
}))

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'agenthub-ws-'))
  store = {}
})

afterEach(() => {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
})

describe('WorkspaceManager', () => {
  it('list/getById 读写一致', async () => {
    const { getWorkspaceManager } = await import('../workspace')
    const m = getWorkspaceManager()
    const w = m.create({ name: 'demo', rootPath: tempDir })
    expect(m.list()).toHaveLength(1)
    expect(m.getById(w.id)?.name).toBe('demo')
    expect(m.getById(w.id)?.rootPath).toBe(tempDir)
  })

  it('create 校验路径：不存在抛 WorkspacePathInvalidError', async () => {
    const { getWorkspaceManager, WorkspacePathInvalidError } = await import('../workspace')
    const m = getWorkspaceManager()
    expect(() => m.create({ name: 'bad', rootPath: join(tempDir, 'nope') })).toThrow(WorkspacePathInvalidError)
  })

  it('create 校验路径：不是目录（文件）抛错', async () => {
    const filePath = join(tempDir, 'a.txt')
    require('fs').writeFileSync(filePath, 'x')
    const { getWorkspaceManager, WorkspacePathInvalidError } = await import('../workspace')
    const m = getWorkspaceManager()
    expect(() => m.create({ name: 'bad', rootPath: filePath })).toThrow(WorkspacePathInvalidError)
  })

  it('update 改名可成；空名抛错；不存在 id 抛 WorkspaceNotFoundError', async () => {
    const { getWorkspaceManager, WorkspaceNotFoundError } = await import('../workspace')
    const m = getWorkspaceManager()
    const w = m.create({ name: 'demo', rootPath: tempDir })
    const renamed = m.update(w.id, { name: 'demo2' })
    expect(renamed.name).toBe('demo2')
    expect(() => m.update(w.id, { name: '  ' })).toThrow()
    expect(() => m.update('nope', { name: 'x' })).toThrow(WorkspaceNotFoundError)
  })

  it('remove 真的删了；删除不存在的 id 返回 false', async () => {
    const { getWorkspaceManager } = await import('../workspace')
    const m = getWorkspaceManager()
    const w = m.create({ name: 'demo', rootPath: tempDir })
    expect(m.remove(w.id)).toBe(true)
    expect(m.getById(w.id)).toBeUndefined()
    expect(m.remove('nope')).toBe(false)
  })

  it('setActive / getActive：删活动工作区时自动 fallback 到另一个', async () => {
    // 隔离：清掉前个测试残留的 store 与单例
    vi.resetModules()
    store = {} // 强制 lazy reload 时读空 store
    const { getWorkspaceManager: getWs2 } = await import('../workspace')
    const m = getWs2()
    const w1 = m.create({ name: 'a', rootPath: tempDir })
    const sub = join(tempDir, 'sub'); mkdirSync(sub)
    const w2 = m.create({ name: 'b', rootPath: sub })
    m.setActive(w1.id)
    expect(m.getActive()).toBe(w1.id)
    expect(() => m.setActive('nope')).toThrow(/WORKSPACE_NOT_FOUND|Workspace not found/)
    m.setActive(null)
    expect(m.getActive()).toBeNull()
    m.setActive(w2.id)
    m.remove(w2.id)
    // 删了活动工作区 → 自动 fallback 到列表里另一个（按 state 顺序的第一个，即 w1）
    expect(m.getActive()).toBe(w1.id)
  })

  it('落盘后重新实例化仍能恢复（持久化）', async () => {
    const mod1 = await import('../workspace')
    const m1 = mod1.getWorkspaceManager()
    const w = m1.create({ name: 'persist', rootPath: tempDir })
    m1.setActive(w.id)
    // 重新 import 模拟下次启动
    vi.resetModules()
    const mod2 = await import('../workspace')
    const m2 = mod2.getWorkspaceManager()
    expect(m2.getById(w.id)?.name).toBe('persist')
    expect(m2.getActive()).toBe(w.id)
  })
})
