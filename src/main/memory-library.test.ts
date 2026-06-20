import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { MemoryLibrary } from './memory-library'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-memory-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length) {
    rmSync(roots.pop()!, { recursive: true, force: true })
  }
})

describe('MemoryLibrary', () => {
  it('classifies chat messages and tasks while saving a restorable runtime snapshot', () => {
    const memory = new MemoryLibrary(tempRoot())
    memory.saveRuntimeState({
      messages: [{
        id: 'm1',
        role: 'user',
        text: '整理这个项目的 skill 使用规则',
        mode: 'auto',
        taskId: 'local-1',
        replies: [{ agentId: 'codex', thinking: 'thinking...', text: '已整理关键规则', done: true }]
      }],
      tasks: [{
        id: 'local-1',
        text: '整理这个项目的 skill 使用规则',
        mode: 'auto',
        status: 'completed',
        agents: ['codex'],
        durationMs: 1200,
        createdAt: '10:30',
        results: { codex: '已整理关键规则' }
      }]
    })

    const restored = new MemoryLibrary(memory.root).loadRuntimeState()
    expect(restored.messages).toHaveLength(1)
    expect(restored.messages[0].text).toBe('整理这个项目的 skill 使用规则')
    expect(restored.tasks[0].status).toBe('completed')

    const catalog = memory.getCatalog()
    expect(catalog.counts.conversation).toBe(1)
    expect(catalog.counts.task).toBe(1)
    expect(catalog.entries.some(entry => entry.category === 'conversation' && entry.title.includes('整理这个项目'))).toBe(true)
    expect(catalog.entries.some(entry => entry.category === 'task' && entry.metadata?.status === 'completed')).toBe(true)
  })

  it('supports explicit skill and file memory entries', () => {
    const memory = new MemoryLibrary(tempRoot())

    memory.upsertEntry({
      category: 'skill',
      title: 'browser control',
      summary: '用于验证本地 UI 的浏览器技能',
      source: 'skills/browser/SKILL.md',
      tags: ['skill', 'browser']
    })
    memory.upsertEntry({
      category: 'file',
      title: 'AgentHub 项目交接',
      summary: '项目交接文档',
      source: 'AgentHub项目交接.md',
      tags: ['handoff']
    })

    const catalog = new MemoryLibrary(memory.root).getCatalog()
    expect(catalog.counts.skill).toBe(1)
    expect(catalog.counts.file).toBe(1)
    expect(catalog.entries.find(entry => entry.category === 'skill')?.source).toContain('SKILL.md')
  })

  it('marks unfinished restored work as cancelled so restarts do not show stale running tasks', () => {
    const memory = new MemoryLibrary(tempRoot())
    memory.saveRuntimeState({
      messages: [{
        id: 'm-running',
        role: 'user',
        text: '长任务',
        mode: 'broadcast',
        taskId: 'local-running',
        replies: [{ agentId: 'codex', thinking: '', text: '处理中', done: false }]
      }],
      tasks: [{
        id: 'local-running',
        text: '长任务',
        mode: 'broadcast',
        status: 'running',
        agents: ['codex'],
        durationMs: null,
        createdAt: '11:00'
      }]
    })

    const restored = new MemoryLibrary(memory.root).loadRuntimeState()
    expect(restored.tasks[0].status).toBe('cancelled')
    expect(restored.messages[0].replies[0]).toMatchObject({ done: true, cancelled: true })
  })
})
