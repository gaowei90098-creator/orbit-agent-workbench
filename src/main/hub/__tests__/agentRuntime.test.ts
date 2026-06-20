import { describe, expect, it } from 'vitest'
import { buildAgentRuntimeSystemPrompt, buildAgentTaskPrompt, selectRelevantMemories } from '../agent-runtime'

const memories = [
  { category: 'conversation', title: 'AgentHub 记忆库', summary: '用户要求重启后恢复对话和任务历史', tags: ['chat', 'memory'] },
  { category: 'skill', title: 'browser skill', summary: '用于本地 UI 验证', tags: ['browser', 'ui'] },
  { category: 'task', title: '无关任务', summary: '别的事情', tags: ['misc'] }
]

describe('agent runtime capability injection', () => {
  it('builds an agentic system prompt with role, capabilities, working protocol, and memory', () => {
    const prompt = buildAgentRuntimeSystemPrompt('codex', 'Base coding prompt.', memories, '修复记忆库恢复问题')

    expect(prompt).toContain('Base coding prompt.')
    expect(prompt).toContain('AgentHub agent runtime')
    expect(prompt).toContain('Codex CLI')
    expect(prompt).toContain('coding')
    expect(prompt).toContain('debug')
    expect(prompt).toContain('Plan')
    expect(prompt).toContain('Act')
    expect(prompt).toContain('Check')
    expect(prompt).toContain('Report')
    expect(prompt).toContain('用户要求重启后恢复对话和任务历史')
  })

  it('wraps stdio prompts so local CLIs receive the same agent capabilities', () => {
    const prompt = buildAgentTaskPrompt('hermes', '检查本机 CLI 配置', memories)

    expect(prompt).toContain('AgentHub agent runtime')
    expect(prompt).toContain('Hermes')
    expect(prompt).toContain('notify')
    expect(prompt).toContain('remote-control')
    expect(prompt).toContain('User task')
    expect(prompt).toContain('检查本机 CLI 配置')
  })

  it('selects relevant memories before generic ones', () => {
    const selected = selectRelevantMemories(memories, '恢复记忆库对话历史', 2)

    expect(selected).toHaveLength(2)
    expect(selected[0].title).toBe('AgentHub 记忆库')
  })
})
