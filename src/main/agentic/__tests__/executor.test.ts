import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * runAgenticHttp 回环单测 — mock provider client + tools，断言：
 *   首轮 finishReason='tool_calls' → 执行工具 → 回灌 → 次轮收尾；内容累积；activity 步骤；取消即停。
 */

const h = vi.hoisted(() => ({
  streamCalls: 0,
  script: [] as Array<(cb: any) => void>,
  toolCalls: 0
}))

vi.mock('../../providers/client', () => ({
  buildProviderClient: () => ({
    stream: (_req: any, cb: any) => { const step = h.script[h.streamCalls]; h.streamCalls++; step?.(cb) }
  })
}))

vi.mock('../tools', () => ({
  AGENTIC_TOOLS: [],
  executeTool: async () => { h.toolCalls++; return { ok: true, output: 'TOOL_OUTPUT' } }
}))

beforeEach(() => { h.streamCalls = 0; h.script = []; h.toolCalls = 0 })

describe('runAgenticHttp', () => {
  it('tool_calls → 执行工具 → 回灌 → 次轮收尾', async () => {
    const { runAgenticHttp } = await import('../executor')
    h.script = [
      (cb) => { cb.onContent('A'); cb.onDone({ finishReason: 'tool_calls', toolCalls: [{ id: 't1', function: { name: 'fs_read', arguments: '{"path":"a.txt"}' } }], usage: { total_tokens: 3 } }) },
      (cb) => { cb.onContent('B'); cb.onDone({ finishReason: 'stop', usage: { total_tokens: 5 } }) }
    ]
    const activities: any[] = []
    let content = ''
    const res = await runAgenticHttp({
      userText: 'do it', systemPrompt: 'sys', resolved: {} as any, thinking: {} as any, root: null,
      isCancelled: () => false,
      emit: { delta: (_c, t) => { content += t }, activity: (s) => activities.push(s) }
    })
    expect(h.streamCalls).toBe(2)        // 进入了第二轮
    expect(h.toolCalls).toBe(1)          // 工具被执行一次
    expect(res.content).toBe('AB')       // 两轮内容累积
    expect(content).toBe('AB')           // delta 累积一致
    expect(activities.map(a => a.status)).toEqual(['running', 'done'])
    expect(activities[1].output).toBe('TOOL_OUTPUT')
  })

  it('开始即取消 → 不发起任何请求', async () => {
    const { runAgenticHttp } = await import('../executor')
    h.script = [(cb) => { cb.onContent('X'); cb.onDone({ finishReason: 'stop' }) }]
    const res = await runAgenticHttp({
      userText: 'x', systemPrompt: 's', resolved: {} as any, thinking: {} as any, root: null,
      isCancelled: () => true,
      emit: { delta: () => {}, activity: () => {} }
    })
    expect(h.streamCalls).toBe(0)
    expect(res.content).toBe('')
  })

  it('模型不调用工具 → 第一轮即收尾（等价纯聊天）', async () => {
    const { runAgenticHttp } = await import('../executor')
    h.script = [(cb) => { cb.onContent('hello'); cb.onDone({ finishReason: 'stop' }) }]
    const res = await runAgenticHttp({
      userText: 'hi', systemPrompt: 's', resolved: {} as any, thinking: {} as any, root: null,
      isCancelled: () => false,
      emit: { delta: () => {}, activity: () => {} }
    })
    expect(h.streamCalls).toBe(1)
    expect(h.toolCalls).toBe(0)
    expect(res.content).toBe('hello')
  })

  it('审批 deny：受管工具不执行，回灌拒绝信息并 error，次轮收尾', async () => {
    const { runAgenticHttp } = await import('../executor')
    h.script = [
      (cb) => { cb.onDone({ finishReason: 'tool_calls', toolCalls: [{ id: 'w1', function: { name: 'fs_write', arguments: '{"path":"a.txt","content":"x"}' } }] }) },
      (cb) => { cb.onContent('done'); cb.onDone({ finishReason: 'stop' }) }
    ]
    const activities: any[] = []
    const res = await runAgenticHttp({
      userText: 'write', systemPrompt: 's', resolved: {} as any, thinking: {} as any, root: '/ws',
      policyFor: () => 'deny',
      isCancelled: () => false,
      emit: { delta: () => {}, activity: (s) => activities.push(s) }
    })
    expect(h.toolCalls).toBe(0)                                  // 工具未执行
    expect(activities.some(a => a.status === 'error')).toBe(true) // 发了拒绝态
    expect(res.content).toBe('done')                            // 次轮正常收尾
  })

  it('审批 ask：批准→执行；拒绝→不执行', async () => {
    const { runAgenticHttp } = await import('../executor')
    const base = {
      userText: 'run', systemPrompt: 's', resolved: {} as any, thinking: {} as any, root: '/ws',
      policyFor: () => 'ask' as const, isCancelled: () => false,
      emit: { delta: () => {}, activity: () => {} }
    }
    h.script = [
      (cb) => { cb.onDone({ finishReason: 'tool_calls', toolCalls: [{ id: 'e1', function: { name: 'exec', arguments: '{"command":"ls"}' } }] }) },
      (cb) => { cb.onContent('ok'); cb.onDone({ finishReason: 'stop' }) }
    ]
    await runAgenticHttp({ ...base, requestApproval: async () => true })
    expect(h.toolCalls).toBe(1)                                  // 批准 → 执行

    h.streamCalls = 0; h.toolCalls = 0
    h.script = [
      (cb) => { cb.onDone({ finishReason: 'tool_calls', toolCalls: [{ id: 'e2', function: { name: 'exec', arguments: '{"command":"ls"}' } }] }) },
      (cb) => { cb.onContent('blocked'); cb.onDone({ finishReason: 'stop' }) }
    ]
    await runAgenticHttp({ ...base, requestApproval: async () => false })
    expect(h.toolCalls).toBe(0)                                  // 拒绝 → 不执行
  })

  it('缺省 policyFor：受管工具按 allow 正常执行（零回归）', async () => {
    const { runAgenticHttp } = await import('../executor')
    h.script = [
      (cb) => { cb.onDone({ finishReason: 'tool_calls', toolCalls: [{ id: 'w1', function: { name: 'fs_write', arguments: '{"path":"a.txt","content":"x"}' } }] }) },
      (cb) => { cb.onContent('ok'); cb.onDone({ finishReason: 'stop' }) }
    ]
    await runAgenticHttp({
      userText: 'w', systemPrompt: 's', resolved: {} as any, thinking: {} as any, root: '/ws',
      isCancelled: () => false,
      emit: { delta: () => {}, activity: () => {} }
    })
    expect(h.toolCalls).toBe(1)
  })
})
