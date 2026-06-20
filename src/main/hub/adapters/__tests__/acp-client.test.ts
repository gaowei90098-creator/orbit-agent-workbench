import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  mapAcpUpdate,
  acpBlockText,
  acpToolContent,
  acpPermissionRequest,
  acpReadTextFile,
  acpWriteTextFile,
  acpResolveWorkspacePath
} from '../acp-client'

/**
 * ACP 协议核心单测 —— session/update → AgentHub 活动模型的纯函数映射。
 * IO 层（spawn + JSON-RPC 收发）需真实 ACP server，归入端到端联机验证。
 */

describe('acpBlockText', () => {
  it('text 块 / string / 数组', () => {
    expect(acpBlockText({ type: 'text', text: 'hi' })).toBe('hi')
    expect(acpBlockText('plain')).toBe('plain')
    expect(acpBlockText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(acpBlockText({ type: 'image' })).toBe('')
    expect(acpBlockText(null)).toBe('')
  })
})

describe('acpToolContent', () => {
  it('content 块取文本，diff 块取路径+新内容', () => {
    const out = acpToolContent([
      { type: 'content', content: { type: 'text', text: 'found 3 files' } },
      { type: 'diff', path: '/p/config.json', oldText: 'a', newText: '{"debug":true}' }
    ])
    expect(out).toContain('found 3 files')
    expect(out).toContain('/p/config.json')
    expect(out).toContain('{"debug":true}')
  })
  it('非数组 → 空串', () => {
    expect(acpToolContent(undefined)).toBe('')
  })
})

describe('mapAcpUpdate', () => {
  it('agent_message_chunk → content', () => {
    expect(mapAcpUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Paris' } }))
      .toEqual({ content: 'Paris' })
  })

  it('agent_thought_chunk → thinking', () => {
    expect(mapAcpUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }))
      .toEqual({ thinking: 'hmm' })
  })

  it('tool_call → running 步骤，含 tool/label/detail', () => {
    const m = mapAcpUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Read config', kind: 'read', status: 'pending', rawInput: { filepath: '/x' } })
    expect(m?.steps?.[0]).toMatchObject({ id: 'c1', kind: 'tool', tool: 'read', label: 'Read config', status: 'running' })
    expect(m?.steps?.[0].detail).toContain('/x')
  })

  it('tool_call_update → 状态映射 + 输出', () => {
    const done = mapAcpUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'ok' } }] })
    expect(done?.steps?.[0]).toMatchObject({ id: 'c1', status: 'done', output: 'ok' })
    const failed = mapAcpUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed' })
    expect(failed?.steps?.[0].status).toBe('error')
    const running = mapAcpUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress' })
    expect(running?.steps?.[0].status).toBe('running')
  })

  it('缺 toolCallId / 未知类型 / 非对象 → null', () => {
    expect(mapAcpUpdate({ sessionUpdate: 'tool_call' })).toBeNull()
    expect(mapAcpUpdate({ sessionUpdate: 'plan', entries: [] })).toBeNull()
    expect(mapAcpUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'x' } })).toBeNull()
    expect(mapAcpUpdate(null)).toBeNull()
  })
})

describe('acpPermissionRequest', () => {
  it('maps shell/command permission requests to exec', () => {
    const req = acpPermissionRequest({
      sessionId: 's1',
      toolCall: { kind: 'terminal', title: 'Run tests', rawInput: { command: 'npm test' } }
    })

    expect(req.tool).toBe('exec')
    expect(req.toolName).toBe('terminal')
    expect(req.label).toBe('Run tests')
    expect(req.detail).toBe('npm test')
  })

  it('maps edit/write permission requests to write', () => {
    const req = acpPermissionRequest({
      toolCall: { name: 'edit_file', title: 'Edit config', input: { path: 'config.json', newText: '{}' } }
    })

    expect(req.tool).toBe('write')
    expect(req.toolName).toBe('edit_file')
    expect(req.detail).toBe('config.json')
  })

  it('leaves read-only permission requests unguarded', () => {
    const req = acpPermissionRequest({
      toolCall: { kind: 'read', title: 'Read README', input: { path: 'README.md' } }
    })

    expect(req.tool).toBeNull()
    expect(req.toolName).toBe('read')
  })
})

describe('ACP client fs helpers', () => {
  it('reads text files with 1-based line and limit support', () => {
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const file = join(root, 'notes.txt')
      writeFileSync(file, 'one\ntwo\nthree\nfour', 'utf-8')

      const res = acpReadTextFile(root, { path: file, line: 2, limit: 2 })

      expect(res.ok).toBe(true)
      expect(res.content).toBe('two\nthree')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes text files inside the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const res = acpWriteTextFile(root, { path: 'sub/out.txt', content: 'hello' })

      expect(res.ok).toBe(true)
      expect(readFileSync(join(root, 'sub', 'out.txt'), 'utf-8')).toBe('hello')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects paths outside the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const res = acpResolveWorkspacePath(root, '../escape.txt')

      expect(res.ok).toBe(false)
      expect(res.error).toContain('escapes')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
