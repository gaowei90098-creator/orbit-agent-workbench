const OPENAI_ENDPOINTS = ['chat/completions', 'responses', 'models']
const ANTHROPIC_ENDPOINTS = ['messages', 'models']

function cleanEndpoint(endpoint: string): string {
  return endpoint.replace(/^\/+|\/+$/g, '')
}

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/g, '')
}

function endsWithEndpoint(url: string, endpoint: string): boolean {
  return url.toLowerCase().endsWith('/' + cleanEndpoint(endpoint).toLowerCase())
}

function stripEndpoint(url: string, endpoint: string): string {
  const clean = cleanEndpoint(endpoint)
  return endsWithEndpoint(url, clean)
    ? url.slice(0, -(clean.length + 1)).replace(/\/+$/g, '')
    : url
}

export function endpointUrl(baseUrl: string, endpoint: string, knownSiblings: string[] = []): string {
  const base = cleanBaseUrl(baseUrl)
  const target = cleanEndpoint(endpoint)
  const known = [target, ...knownSiblings.map(cleanEndpoint)]
  for (const candidate of known) {
    if (endsWithEndpoint(base, candidate)) {
      const parent = stripEndpoint(base, candidate)
      return candidate === target ? base : `${parent}/${target}`
    }
  }
  return `${base}/${target}`
}

export function openAIChatCompletionsUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, 'chat/completions', OPENAI_ENDPOINTS)
}

export function openAIResponsesUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, 'responses', OPENAI_ENDPOINTS)
}

export function openAIModelsUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, 'models', OPENAI_ENDPOINTS)
}

export function anthropicMessagesUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, 'messages', ANTHROPIC_ENDPOINTS)
}

export function anthropicModelsUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, 'models', ANTHROPIC_ENDPOINTS)
}
