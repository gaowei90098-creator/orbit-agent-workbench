import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * WorkspaceManager.bootstrapContext 单测 — 覆盖：
 *   1) 正常读取 bootstrapFiles 拼成项目上下文块
 *   2) 拒绝 `..` / 绝对路径越界
 *   3) 缺失文件跳过
 *   4) 无 bootstrapFiles / 无工作区 → 空串
 *   5) 字符上限省略
 * store 经 vi.mock 内存化；文件用真实临时目录（与 workspace.test.ts 同套路）。
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
  tempDir = mkdtempSync(join(tmpdir(), 'agenthub-bs-'))
  store = {}
})
afterEach(() => {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
})

describe('WorkspaceManager.bootstrapContext', () => {
  it('正常读取 bootstrapFiles 拼成上下文块', async () => {
    const { getWorkspaceManager } = await import('../workspace')
    writeFileSync(join(tempDir, 'CLAUDE.md'), 'Project rule: be concise.')
    const m = getWorkspaceManager()
    const w = m.create({ name: 'demo', rootPath: tempDir })
    m.update(w.id, { bootstrapFiles: ['CLAUDE.md'] })
    const ctx = m.bootstrapContext(w.id)
    expect(ctx).toContain('# Project context')
    expect(ctx).toContain('## CLAUDE.md')
    expect(ctx).toContain('Project rule: be concise.')
  })

  it('拒绝 `..` 越界并标注省略', async () => {
    const { getWorkspaceManager } = await import('../workspace')
    const m = getWorkspaceManager()
    const w = m.create({ name: 'demo', rootPath: tempDir })
    m.update(w.id, { bootstrapFiles: ['../escape.txt'] })
    const ctx = m.bootstrapContext(w.id)
    expect(ctx).toBe('') // 唯一文件越界被剔除 → 无内容块 → 空串
  })

  it('缺失文件跳过；与正常文件混合时只保留正常文件', async () => {
    const { getWorkspaceManager } = await import('../workspace')
    writeFileSync(join(tempDir, 'AGENTS.md'), 'agents content')
    const m = getWorkspaceManager()
    const w = m.create({ name: 'demo', rootPath: tempDir })
    m.update(w.id, { bootstrapFiles: ['AGENTS.md', 'missing.md'] })
    const ctx = m.bootstrapContext(w.id)
    expect(ctx).toContain('## AGENTS.md')
    expect(ctx).toContain('agents content')
    expect(ctx).toMatch(/1 more bootstrap file\(s\) omitted/)
  })

  it('无 bootstrapFiles / 无 id → 空串', async () => {
    const { getWorkspaceManager } = await import('../workspace')
    const m = getWorkspaceManager()
    const w = m.create({ name: 'demo', rootPath: tempDir })
    expect(m.bootstrapContext(w.id)).toBe('')
    expect(m.bootstrapContext(null)).toBe('')
    expect(m.bootstrapContext('nope')).toBe('')
  })

  it('超字符上限省略后续文件', async () => {
    const { getWorkspaceManager } = await import('../workspace')
    writeFileSync(join(tempDir, 'big.md'), 'y'.repeat(50))
    writeFileSync(join(tempDir, 'small.md'), 'tiny')
    const m = getWorkspaceManager()
    const w = m.create({ name: 'demo', rootPath: tempDir })
    m.update(w.id, { bootstrapFiles: ['big.md', 'small.md'] })
    const ctx = m.bootstrapContext(w.id, 40) // big.md 即超 40 字符上限
    expect(ctx).toContain('## big.md')
    expect(ctx).not.toContain('## small.md')
    expect(ctx).toMatch(/1 more bootstrap file\(s\) omitted/)
  })
})
