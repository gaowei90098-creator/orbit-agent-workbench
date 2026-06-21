import { describe, expect, it } from 'vitest'
import { summarizeAgentConnections, firstRunActionForError } from './connection-status'
import type { BindingDef, ProviderDef } from './meta'

const providers: ProviderDef[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    enabled: true,
    builtIn: true,
    models: [{ id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    enabled: true,
    builtIn: true,
    models: [{ id: 'gpt-4o', label: 'gpt-4o' }]
  }
]

const bindings: BindingDef[] = [
  {
    agentId: 'codex',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    thinking: { mode: 'auto', level: 'medium' },
    protocol: 'http'
  },
  {
    agentId: 'claude',
    providerId: 'openai',
    modelId: 'gpt-4o',
    thinking: { mode: 'auto', level: 'medium' },
    protocol: 'http'
  },
  {
    agentId: 'hermes',
    providerId: '',
    modelId: '',
    thinking: { mode: 'auto', level: 'medium' },
    protocol: 'stdio-plain'
  }
]

describe('connection status summary', () => {
  it('separates usable, unconfigured and undetected agents', () => {
    const summary = summarizeAgentConnections({
      agents: {
        codex: { status: 'off' },
        claude: { status: 'idle' },
        hermes: { status: 'idle' }
      },
      bindings,
      providers
    })

    expect(summary.counts).toEqual({
      usable: 2,
      busy: 0,
      error: 0,
      needsProvider: 1,
      needsInstall: 0,
      off: 0
    })
    expect(summary.headlineZh).toContain('2 个可用')
    expect(summary.items.find(item => item.agentId === 'codex')?.state).toBe('needs-provider')
    expect(summary.items.find(item => item.agentId === 'hermes')?.state).toBe('usable')
  })

  it('offers a first-run action for provider and CLI failures', () => {
    expect(firstRunActionForError('新用户未配置 Provider/API Key')?.labelZh).toBe('去配置 Provider')
    expect(firstRunActionForError('No local install detected')?.labelZh).toBe('选择 CLI 路径')
    expect(firstRunActionForError('random timeout')).toBeNull()
  })
})
