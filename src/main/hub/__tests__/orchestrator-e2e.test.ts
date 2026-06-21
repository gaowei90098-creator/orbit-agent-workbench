/* ============================================================
   编排模式端到端测试（runOrchestrate 控制流）
   用假 ProviderClient 按提示词确定性地模拟真实 LLM：
     分解→产出 JSON 计划 / 子任务→产出答案 / 校验→PASS|FAIL / 汇总→最终答案。
   既验证正常链路，也锁定失败外显契约（见 docs/DESIGN.md §8「失败外显」）。
   ============================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentRegistry } from '../registry'
import { HttpAgentAdapter } from '../adapters/base'
import { ORCHESTRATOR_LEAD_SYSTEM } from '../orchestrator'

type Kind = 'decompose' | 'verify' | 'synthesis' | 'subtask'
type Reply = string | { content?: string; error?: string }

const h = vi.hoisted(() => {
  const state: {
    bindings: Array<{ agentId: string }>
    responder: (c: { agentId: string; kind: Kind; prompt: string; system?: string }) => Reply
    calls: Array<{ agentId: string; kind: Kind; prompt: string; system?: string }>
  } = {
    bindings: [{ agentId: 'orbit' }, { agentId: 'codex' }, { agentId: 'claude' }],
    responder: () => '',
    calls: []
  }
  return { state }
})

vi.mock('../../providers/manager', () => ({
  getProviderManager: () => ({
    getBindings: () => h.state.bindings,
    getBinding: (id: string) =>
      h.state.bindings.find(b => b.agentId === id) ? { agentId: id, providerId: 'openai', modelId: 'gpt-test' } : undefined,
    resolveBinding: (id: string) =>
      h.state.bindings.find(b => b.agentId === id)
        ? {
            provider: { id: 'openai', name: 'OpenAI', kind: 'openai' },
            model: { id: 'gpt-test', supportsThinking: false },
            binding: { agentId: id },
            thinking: { mode: 'off', level: 'medium' }
          }
        : null
  })
}))

vi.mock('../../providers/client', () => ({
  buildProviderClient: (resolved: any) => ({
    stream: (opts: any, cb: any) => {
      const agentId = resolved?.binding?.agentId
      const system: string | undefined = opts.systemPrompt
      const prompt: string = opts.messages?.[opts.messages.length - 1]?.content ?? ''
      let kind: Kind = 'subtask'
      if (system === ORCHESTRATOR_LEAD_SYSTEM) {
        if (prompt.includes('Break the following task')) kind = 'decompose'
        else if (prompt.includes('You are a strict reviewer')) kind = 'verify'
        else if (prompt.includes('Synthesize their outputs')) kind = 'synthesis'
      }
      h.state.calls.push({ agentId, kind, prompt, system })
      const r = h.state.responder({ agentId, kind, prompt, system })
      const out = typeof r === 'string' ? { content: r } : r
      // 同步触发回调（确定性顺序），模拟流式 onContent → onDone / onError
      if (out.error) { cb.onError?.(new Error(out.error)); return }
      if (out.content) cb.onContent?.(out.content)
      cb.onDone?.({ content: out.content ?? '', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    }
  })
}))

// 必须在 vi.mock 之后再 import 被测模块
import { Dispatcher, StreamEvent } from '../dispatcher'

function makeDispatcher() {
  const registry = new AgentRegistry()
  // HTTP 适配器 → sendToAgent 走 HTTP 路径（protocol === 'http'）
  registry.register(new HttpAgentAdapter('codex', 'Codex'), ['coding'])
  registry.register(new HttpAgentAdapter('claude', 'Claude'), ['analysis'])
  const pipeline = { process: async () => {} } as any
  const dispatcher = new Dispatcher(registry, pipeline)
  const events: StreamEvent[] = []
  dispatcher.on('stream', (e: StreamEvent) => events.push(e))
  return { dispatcher, events, registry }
}

const byKind = (events: StreamEvent[], kind: string) => events.filter(e => e.kind === kind)

// 标准两子任务计划：1→codex，2→claude
const PLAN = JSON.stringify({
  subtasks: [
    { id: '1', title: '后端', detail: '写登录 API', agent: 'codex' },
    { id: '2', title: '文档', detail: '写 README', agent: 'claude' }
  ]
})

beforeEach(() => {
  h.state.bindings = [{ agentId: 'orbit' }, { agentId: 'codex' }, { agentId: 'claude' }]
  h.state.calls = []
  h.state.responder = () => ''
})

describe('runOrchestrate 端到端', () => {
  it('正常链路：分解→并行子任务→校验通过→汇总', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind, agentId }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return '最终合成结果'
      return agentId === 'codex' ? '子任务1输出' : '子任务2输出'  // subtask
    }

    const task = await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')

    expect(task.status).toBe('completed')
    // 计划事件：先空 plan 占位，再带 2 个子任务
    const plans = byKind(events, 'orchestrate:plan') as any[]
    expect(plans.length).toBeGreaterThanOrEqual(2)
    const finalPlan = plans[plans.length - 1]
    expect(finalPlan.subtasks.map((s: any) => s.id)).toEqual(['1', '2'])
    expect(finalPlan.subtasks.find((s: any) => s.id === '1').agentId).toBe('codex')
    expect(finalPlan.subtasks.find((s: any) => s.id === '2').agentId).toBe('claude')
    // 两子任务都 running→done
    const subEvents = byKind(events, 'orchestrate:subtask') as any[]
    expect(subEvents.filter(e => e.subtaskId === '1' && e.status === 'done')).toHaveLength(1)
    expect(subEvents.filter(e => e.subtaskId === '2' && e.status === 'done')).toHaveLength(1)
    // 校验通过
    const verdicts = byKind(events, 'orchestrate:verdict') as any[]
    expect(verdicts.every(v => v.pass === true)).toBe(true)
    expect(verdicts).toHaveLength(2)
    // 汇总 + 最终
    expect(byKind(events, 'orchestrate:synthesizing')).toHaveLength(1)
    const final = byKind(events, 'orchestrate:final') as any[]
    expect(final).toHaveLength(1)
    expect(final[0].content).toBe('最终合成结果')
    expect(task.results.get('orchestrate')).toBe('最终合成结果')
  })

  it('计划解析失败 → 回退为单子任务（整任务作为一个子任务）', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind }) => {
      if (kind === 'decompose') return '我无法给出 JSON'  // parsePlan → null
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return 'OK'
      return '兜底子任务输出'
    }
    const task = await dispatcher.dispatch('随便做点什么', 'orchestrate')
    expect(task.status).toBe('completed')
    const finalPlan = (byKind(events, 'orchestrate:plan') as any[]).pop()
    expect(finalPlan.subtasks).toHaveLength(1)
    expect(finalPlan.subtasks[0].agentId).toBeTruthy()  // 必须被指派
  })

  it('校验未过 → 重试一次后通过（有界修复回环）', async () => {
    const { dispatcher, events } = makeDispatcher()
    let verifyCount1 = 0
    h.state.responder = ({ kind, prompt }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'synthesis') return '汇总'
      if (kind === 'verify') {
        // 仅子任务1第一次 FAIL；子任务2 一直 PASS
        if (prompt.includes('后端')) { verifyCount1++; return verifyCount1 === 1 ? 'FAIL: 缺少错误处理' : 'PASS' }
        return 'PASS'
      }
      // subtask：retryPrompt 含 "A previous attempt"
      return prompt.includes('A previous attempt') ? '修复后的输出' : '初版输出'
    }
    const task = await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')
    expect(task.status).toBe('completed')
    const sub1Running = (byKind(events, 'orchestrate:subtask') as any[]).filter(e => e.subtaskId === '1' && e.status === 'running')
    expect(sub1Running.length).toBe(2)  // 两次尝试
    const v1 = (byKind(events, 'orchestrate:verdict') as any[]).filter(e => e.subtaskId === '1')
    expect(v1.map(v => v.pass)).toEqual([false, true])
    expect(v1.map(v => v.attempt)).toEqual([1, 2])
  })

  it('校验两次均未过 → 子任务标记失败原因并仍进入汇总', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind, prompt }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'synthesis') return '尽力汇总'
      if (kind === 'verify') return prompt.includes('后端') ? 'FAIL: 还是不行' : 'PASS'
      return '某输出'
    }
    const task = await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')
    expect(task.status).toBe('completed')
    const v1 = (byKind(events, 'orchestrate:verdict') as any[]).filter(e => e.subtaskId === '1')
    expect(v1).toHaveLength(2)
    expect(v1[1]).toMatchObject({ pass: false, attempt: 2 })
    expect(byKind(events, 'orchestrate:final')).toHaveLength(1)
  })

  // ---- 失败外显契约（docs/DESIGN.md §8）----

  it('子任务 provider 报错 → 必须发 orchestrate:subtask error（不得伪装成 done 空内容）', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind, agentId }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return '汇总'
      // 子任务1（codex）执行时 provider 报错
      if (agentId === 'codex') return { error: 'HTTP 401 Unauthorized' }
      return '子任务2输出'
    }
    await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')
    const sub1 = (byKind(events, 'orchestrate:subtask') as any[]).filter(e => e.subtaskId === '1')
    // 失败外显：子任务1必须出现 error 状态，且不得出现 done（空内容）伪装成功
    expect(sub1.some(e => e.status === 'error')).toBe(true)
    expect(sub1.some(e => e.status === 'done')).toBe(false)
  })

  it('未绑定任何 agent → 必须发 orchestrate:error 且任务失败', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.bindings = []
    const task = await dispatcher.dispatch('做点事', 'orchestrate')
    expect(task.status).toBe('failed')
    expect(byKind(events, 'orchestrate:error')).toHaveLength(1)
  })

  it('汇总阶段 provider 报错 → 不得静默以空内容标记完成', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return { error: 'HTTP 500' }
      return '子任务输出'
    }
    const task = await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')
    // 汇总失败应外显为 error，而非 completed + 空 final
    const finals = byKind(events, 'orchestrate:final') as any[]
    const errs = byKind(events, 'orchestrate:error') as any[]
    expect(errs.length === 1 || (finals.length === 1 && finals[0].content.length > 0)).toBe(true)
    if (errs.length) expect(task.status).toBe('failed')
  })

  it('全部子任务失败 → 最终内容带失败前缀，不得呈现为交付物', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return '我在工作区发现了 index.html，已交付'  // 模拟 lead 仍想报交付物
      return { error: 'boom' }  // 两个子任务都失败
    }
    const task = await dispatcher.dispatch('做个星云页面', 'orchestrate')
    const final = byKind(events, 'orchestrate:final') as any[]
    expect(final).toHaveLength(1)
    expect(final[0].content).toContain('所有子任务均失败')
    expect(task.results.get('orchestrate')).toContain('所有子任务均失败')
  })
})
