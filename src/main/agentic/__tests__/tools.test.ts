import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeTool, ToolContext } from '../tools'

/**
 * 工具集单测 — 路径越界拒绝、读写回环、只读模式拒写/拒执行。
 * 纯文件系统，无 electron / store 依赖。
 */

let root: string
let ctx: ToolContext

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agenthub-tools-'))
  ctx = { root, readOnly: false }
})
afterEach(() => { if (existsSync(root)) rmSync(root, { recursive: true, force: true }) })

describe('executeTool', () => {
  it('fs_write 然后 fs_read 回环', async () => {
    const w = await executeTool('fs_write', { path: 'sub/a.txt', content: 'hello' }, ctx)
    expect(w.ok).toBe(true)
    expect(readFileSync(join(root, 'sub/a.txt'), 'utf-8')).toBe('hello')
    const r = await executeTool('fs_read', { path: 'sub/a.txt' }, ctx)
    expect(r.ok).toBe(true)
    expect(r.output).toContain('hello')
  })

  it('fs_list 列目录', async () => {
    mkdirSync(join(root, 'd'))
    writeFileSync(join(root, 'f.txt'), 'x')
    const r = await executeTool('fs_list', { path: '' }, ctx)
    expect(r.ok).toBe(true)
    expect(r.output).toContain('d/')
    expect(r.output).toContain('f.txt')
  })

  it('拒绝越界路径（绝对路径 / ..）', async () => {
    const abs = await executeTool('fs_read', { path: 'C:/Windows/system.ini' }, ctx)
    expect(abs.ok).toBe(false)
    const up = await executeTool('fs_write', { path: '../escape.txt', content: 'x' }, ctx)
    expect(up.ok).toBe(false)
    expect(existsSync(join(root, '..', 'escape.txt'))).toBe(false)
  })

  it('只读模式拒绝 fs_write 与 exec', async () => {
    const ro: ToolContext = { root, readOnly: true }
    const w = await executeTool('fs_write', { path: 'a.txt', content: 'x' }, ro)
    expect(w.ok).toBe(false)
    const e = await executeTool('exec', { command: 'echo hi' }, ro)
    expect(e.ok).toBe(false)
  })

  it('未知工具返回 ok:false', async () => {
    const r = await executeTool('nope', {}, ctx)
    expect(r.ok).toBe(false)
  })
})
