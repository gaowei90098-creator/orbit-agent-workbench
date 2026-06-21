import { describe, expect, it } from 'vitest'
import {
  anthropicMessagesUrl,
  openAIChatCompletionsUrl,
  openAIModelsUrl,
  openAIResponsesUrl
} from '../endpoints'

describe('provider endpoint URL helpers', () => {
  it('appends chat completions to an OpenAI-compatible base URL', () => {
    expect(openAIChatCompletionsUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions')
  })

  it('keeps a full chat completions endpoint unchanged', () => {
    expect(openAIChatCompletionsUrl('https://api.evomap.ai/v1/chat/completions')).toBe('https://api.evomap.ai/v1/chat/completions')
  })

  it('builds sibling OpenAI endpoints from a full chat completions URL', () => {
    const full = 'https://api.evomap.ai/v1/chat/completions'
    expect(openAIModelsUrl(full)).toBe('https://api.evomap.ai/v1/models')
    expect(openAIResponsesUrl(full)).toBe('https://api.evomap.ai/v1/responses')
  })

  it('keeps a full Anthropic messages endpoint unchanged', () => {
    expect(anthropicMessagesUrl('https://api.example.com/v1/messages/')).toBe('https://api.example.com/v1/messages')
  })
})
