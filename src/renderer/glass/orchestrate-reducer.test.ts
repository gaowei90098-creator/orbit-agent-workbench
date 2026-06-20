import { describe, it, expect } from 'vitest'
import { applyOrchestrateEvent, initialOrchestrateState } from './orchestrate-reducer'

describe('orchestrate reducer', () => {
  it('plan 事件建立子任务并进入 running', () => {
    const s = applyOrchestrateEvent(undefined, {
      kind: 'orchestrate:plan',
      leadAgentId: 'claude',
      subtasks: [
        { id: 'a', title: '写后端', agentId: 'codex' },
        { id: 'b', title: '写文档', agentId: 'claude' }
      ]
    })
    expect(s.phase).toBe('running')
    expect(s.leadAgentId).toBe('claude')
    expect(s.subtasks.map(t => t.id)).toEqual(['a', 'b'])
    expect(s.subtasks.every(t => t.status === 'pending')).toBe(true)
  })

  it('approval 事件让计划先停在待确认阶段', () => {
    let s = applyOrchestrateEvent(undefined, {
      kind: 'orchestrate:plan',
      taskId: 'task-1',
      missionId: 'mission-task-1',
      planArtifact: { status: 'awaiting-approval' },
      subtasks: [{ id: 'a', title: '写后端', fileScope: ['src/**'], dependsOn: [] }]
    })
    expect(s.phase).toBe('awaiting-approval')
    expect(s.taskId).toBe('task-1')
    expect(s.subtasks[0].fileScope).toEqual(['src/**'])
    s = applyOrchestrateEvent(s, { kind: 'orchestrate:approval', taskId: 'task-1', status: 'approved' })
    expect(s.phase).toBe('running')
  })

  it('subtask 事件更新状态/agent/内容(支持增量拼接)', () => {
    let s = initialOrchestrateState()
    s = applyOrchestrateEvent(s, { kind: 'orchestrate:plan', subtasks: [{ id: 'a', title: 'A' }] })
    s = applyOrchestrateEvent(s, { kind: 'orchestrate:subtask', subtaskId: 'a', agentId: 'codex', status: 'running' })
    s = applyOrchestrateEvent(s, { kind: 'orchestrate:subtask', subtaskId: 'a', contentDelta: 'Hello ' })
    s = applyOrchestrateEvent(s, { kind: 'orchestrate:subtask', subtaskId: 'a', contentDelta: 'World', status: 'done' })
    const a = s.subtasks.find(t => t.id === 'a')!
    expect(a.agentId).toBe('codex')
    expect(a.status).toBe('done')
    expect(a.content).toBe('Hello World')
  })

  it('未知 subtaskId 的事件会补建子任务', () => {
    const s = applyOrchestrateEvent(initialOrchestrateState(), {
      kind: 'orchestrate:subtask', subtaskId: 'x', status: 'running'
    })
    expect(s.subtasks.find(t => t.id === 'x')?.status).toBe('running')
  })

  it('verdict 事件写入子任务校验结论', () => {
    let s = applyOrchestrateEvent(undefined, { kind: 'orchestrate:plan', subtasks: [{ id: 'a', title: 'A' }] })
    s = applyOrchestrateEvent(s, { kind: 'orchestrate:verdict', subtaskId: 'a', pass: false, note: '缺测试', attempt: 1 })
    expect(s.subtasks.find(t => t.id === 'a')?.verdict).toEqual({ pass: false, note: '缺测试' })
    s = applyOrchestrateEvent(s, { kind: 'orchestrate:verdict', subtaskId: 'a', pass: true, attempt: 2 })
    expect(s.subtasks.find(t => t.id === 'a')?.verdict?.pass).toBe(true)
  })

  it('final 事件进入 done 并记录合成结果', () => {
    const s = applyOrchestrateEvent(initialOrchestrateState(), { kind: 'orchestrate:final', content: '汇总完成' })
    expect(s.phase).toBe('done')
    expect(s.final).toBe('汇总完成')
  })

  it('error 事件进入 error', () => {
    const s = applyOrchestrateEvent(initialOrchestrateState(), { kind: 'orchestrate:error', error: '炸了' })
    expect(s.phase).toBe('error')
    expect(s.error).toBe('炸了')
  })

  it('未知事件原样返回', () => {
    const base = applyOrchestrateEvent(undefined, { kind: 'orchestrate:plan', subtasks: [{ id: 'a', title: 'A' }] })
    const after = applyOrchestrateEvent(base, { kind: 'delta', text: 'x' })
    expect(after).toEqual(base)
  })
})
