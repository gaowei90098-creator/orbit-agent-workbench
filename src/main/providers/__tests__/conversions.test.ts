import { describe, it, expect } from 'vitest'
import { openaiToolsToAnthropic, openaiToolsToGemini, openaiMessagesToAnthropic, openaiMessagesToGemini } from '../client'
import type { ChatCompletionMessage } from '../types'

/**
 * 跨协议工具/消息转换单测（纯函数）。client.ts 经 ./presets 间接 import electron，
 * 但 vitest.config 已把 electron 别名到 stub，故可直接 import。
 */

const TOOLS = [
  { type: 'function', function: { name: 'fs_read', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }
]

describe('tool schema 转换', () => {
  it('OpenAI → Anthropic', () => {
    const a = openaiToolsToAnthropic(TOOLS)
    expect(a[0]).toMatchObject({ name: 'fs_read', input_schema: { type: 'object' } })
    expect(a[0].input_schema.properties.path.type).toBe('string')
  })
  it('OpenAI → Gemini', () => {
    const g = openaiToolsToGemini(TOOLS)
    expect(g[0]).toMatchObject({ name: 'fs_read', parameters: { type: 'object' } })
  })
})

describe('消息转换', () => {
  const convo: ChatCompletionMessage[] = [
    { role: 'user', content: 'do it' },
    { role: 'assistant', content: 'calling', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'fs_write', arguments: '{"path":"a.txt","content":"x"}' } },
      { id: 'c2', type: 'function', function: { name: 'fs_read', arguments: '{"path":"a.txt"}' } }
    ] },
    { role: 'tool', tool_call_id: 'c1', content: 'wrote' },
    { role: 'tool', tool_call_id: 'c2', content: 'x' }
  ]

  it('Anthropic：assistant tool_use + 连续 tool_result 合并到一个 user 消息', () => {
    const out = openaiMessagesToAnthropic(convo)
    // user, assistant(blocks), user(tool_result x2)
    expect(out).toHaveLength(3)
    const asst = out[1]
    expect(asst.role).toBe('assistant')
    expect(asst.content.filter((b: any) => b.type === 'tool_use')).toHaveLength(2)
    const toolMsg = out[2]
    expect(toolMsg.role).toBe('user')
    expect(toolMsg.content).toHaveLength(2)
    expect(toolMsg.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'c1' })
    expect(toolMsg._toolGroup).toBeUndefined() // 内部标记已剥离
  })

  it('Gemini：functionCall(model) + functionResponse 按 id→name 匹配', () => {
    const out = openaiMessagesToGemini(convo)
    expect(out).toHaveLength(3)
    expect(out[1].role).toBe('model')
    expect(out[1].parts.filter((p: any) => p.functionCall)).toHaveLength(2)
    const fnResp = out[2]
    expect(fnResp.role).toBe('user')
    expect(fnResp.parts[0].functionResponse.name).toBe('fs_write')
    expect(fnResp.parts[1].functionResponse.name).toBe('fs_read')
    expect(fnResp._fnGroup).toBeUndefined()
  })
})
