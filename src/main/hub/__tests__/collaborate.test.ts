import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentRegistry } from '../registry'
import { HttpAgentAdapter } from '../adapters/base'
import { ORCHESTRATOR_LEAD_SYSTEM } from '../orchestrator'

type Reply = string | { content?: string; error?: string }

const h = vi.hoisted(() => {
  const state: {
    bindings: Array<{ agentId: string }>
    responder: (c: { agentId: string; prompt: string; system?: string }) => Reply
    calls: Array<{ agentId: string; prompt: string; system?: string }>
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
      h.state.calls.push({ agentId, prompt, system })
      const r = h.state.responder({ agentId, prompt, system })
      const out = typeof r === 'string' ? { content: r } : r
      if (out.error) { cb.onError?.(new Error(out.error)); return }
      if (out.content) cb.onContent?.(out.content)
      cb.onDone?.({ content: out.content ?? '', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    }
  })
}))

import { Dispatcher, StreamEvent } from '../dispatcher'

function makeDispatcher() {
  const registry = new AgentRegistry()
  registry.register(new HttpAgentAdapter('codex', 'Codex'), ['coding'])
  registry.register(new HttpAgentAdapter('claude', 'Claude'), ['analysis'])
  registry.register(new HttpAgentAdapter('orbit', 'Orbit'), ['planning'])
  const pipeline = { process: async () => {} } as any
  const dispatcher = new Dispatcher(registry, pipeline)
  const events: StreamEvent[] = []
  dispatcher.on('stream', (e: StreamEvent) => events.push(e))
  return { dispatcher, events }
}

const byKind = (events: StreamEvent[], kind: string) => events.filter(e => e.kind === kind)

beforeEach(() => {
  h.state.bindings = [{ agentId: 'orbit' }, { agentId: 'codex' }, { agentId: 'claude' }]
  h.state.calls = []
  h.state.responder = () => ''
})

describe('collaborate dispatch mode', () => {
  it('runs shared transcript turns and includes peer content from round 2 onward', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ agentId, prompt, system }) => {
      if (system === ORCHESTRATOR_LEAD_SYSTEM && prompt.includes('multi-agent collaboration transcript')) return 'Orbit final synthesis'
      if (agentId === 'codex' && prompt.includes('Round 2')) return prompt.includes('CLAUDE_R1: objection') ? 'CODEX_R2: answers Claude' : { error: 'missing peer turn' }
      if (agentId === 'claude' && prompt.includes('Round 2')) return prompt.includes('CODEX_R2: answers Claude') ? 'CLAUDE_R2: converges' : { error: 'missing latest codex turn' }
      if (agentId === 'codex' && prompt.includes('Round 1')) return 'CODEX_R1: proposal'
      if (agentId === 'claude' && prompt.includes('Round 1')) return 'CLAUDE_R1: objection'
      return { error: 'unexpected prompt' }
    }

    const task = await dispatcher.dispatch('辩论这个技术方案', 'collaborate', undefined, { rounds: 2 })

    expect(task.status).toBe('completed')
    const nonLeadCalls = h.state.calls.filter(call => call.agentId !== 'orbit')
    expect(nonLeadCalls).toHaveLength(4)
    expect(h.state.calls.filter(call => call.agentId === 'orbit')).toHaveLength(1)
    expect(nonLeadCalls.find(call => call.agentId === 'codex' && call.prompt.includes('Round 2'))?.prompt).toContain('CLAUDE_R1: objection')
    expect(nonLeadCalls.find(call => call.agentId === 'claude' && call.prompt.includes('Round 2'))?.prompt).toContain('CODEX_R2: answers Claude')
    expect(byKind(events, 'collaborate:start')).toHaveLength(1)
    expect(byKind(events, 'collaborate:turn').filter((event: any) => event.status === 'done')).toHaveLength(4)
    expect(byKind(events, 'collaborate:synthesizing')).toHaveLength(1)
    expect(byKind(events, 'collaborate:final')).toHaveLength(1)
    expect(task.results.get('collaborate')).toBe('Orbit final synthesis')
  })

  it('surfaces a turn error instead of pretending collaboration completed', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ agentId, system }) => {
      if (system === ORCHESTRATOR_LEAD_SYSTEM) return 'should not synthesize'
      if (agentId === 'codex') return 'codex ok'
      return { error: 'HTTP 401 Unauthorized' }
    }

    const task = await dispatcher.dispatch('协作分析故障', 'collaborate', undefined, { rounds: 1 })

    expect(task.status).toBe('failed')
    const errorTurns = byKind(events, 'collaborate:turn').filter((event: any) => event.status === 'error')
    expect(errorTurns).toHaveLength(1)
    expect((errorTurns[0] as any).error).toContain('HTTP 401')
    expect(byKind(events, 'collaborate:final')).toHaveLength(0)
    expect(byKind(events, 'collaborate:error')).toHaveLength(1)
  })
})
