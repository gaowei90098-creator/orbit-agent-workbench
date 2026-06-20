import { agentCaps, agentName, agentSystemPrompt } from './agents'

export interface RuntimeMemoryEntry {
  category?: string
  title?: string
  summary?: string
  tags?: string[]
  source?: string
  metadata?: Record<string, any>
}

export function buildAgentRuntimeSystemPrompt(
  agentId: string,
  basePrompt: string = agentSystemPrompt(agentId),
  memories: RuntimeMemoryEntry[] = [],
  taskText = '',
  /** 已装技能注入块（由调用方从 SkillManager 取，buildSkillBlock 拼好）；空则不注入 */
  skillsBlock = ''
): string {
  const name = agentName(agentId)
  const caps = agentCaps(agentId)
  const memoryBlock = formatMemories(selectRelevantMemories(memories, taskText, 6))

  return [
    basePrompt.trim(),
    '',
    'AgentHub agent runtime:',
    `- Agent: ${name} (${agentId})`,
    `- Capabilities: ${caps.length ? caps.join(', ') : 'general assistance'}`,
    '- Work as an autonomous agent, not a passive chatbot.',
    '- Plan: infer the concrete goal, constraints, missing context, and the next useful action.',
    '- Act: produce the best actionable result for this agent capability. If execution is impossible, explain the exact blocker and the next fix.',
    '- Check: verify your own answer for correctness, edge cases, and whether it satisfies the user request.',
    '- Report: keep the final response concise. Lead with completed work, findings, decisions, or what the user must handle.',
    '- Do not reveal hidden reasoning. Do not include startup banners, tool chatter, or generic capability disclaimers.',
    memoryBlock,
    skillsBlock
  ].filter(Boolean).join('\n')
}

export function buildAgentTaskPrompt(agentId: string, userTask: string, memories: RuntimeMemoryEntry[] = [], skillsBlock = ''): string {
  return [
    buildAgentRuntimeSystemPrompt(agentId, agentSystemPrompt(agentId), memories, userTask, skillsBlock),
    '',
    'User task:',
    userTask
  ].join('\n')
}

export function selectRelevantMemories(memories: RuntimeMemoryEntry[], taskText = '', limit = 6): RuntimeMemoryEntry[] {
  const terms = tokenize(taskText)
  return memories
    .map((memory, index) => ({ memory, index, score: scoreMemory(memory, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map(item => item.memory)
}

function formatMemories(memories: RuntimeMemoryEntry[]): string {
  if (memories.length === 0) return ''
  return [
    'Relevant AgentHub memory:',
    ...memories.map((memory, index) => {
      const category = memory.category || 'memory'
      const title = clean(memory.title || memory.source || 'Untitled')
      const summary = clean(memory.summary || '')
      return `${index + 1}. [${category}] ${title}${summary ? ' - ' + summary : ''}`
    })
  ].join('\n')
}

function scoreMemory(memory: RuntimeMemoryEntry, terms: string[]): number {
  const haystack = [
    memory.category,
    memory.title,
    memory.summary,
    memory.source,
    ...(memory.tags || [])
  ].join(' ').toLowerCase()
  let score = 0
  for (const term of terms) {
    if (term && haystack.includes(term)) score += term.length > 1 ? 2 : 1
  }
  if (memory.category === 'semantic' || memory.category === 'procedure') score += 2
  if (memory.category === 'episodic' || memory.category === 'decision') score += 1.8
  if (memory.category === 'conversation') score += 1.5
  if (memory.category === 'task') score += 1
  if (memory.category === 'skill') score += 0.8
  return score
}

function tokenize(text: string): string[] {
  const ascii = text.toLowerCase().match(/[a-z0-9_-]{2,}/g) || []
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) || []
  return Array.from(new Set([...ascii, ...cjk]))
}

function clean(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 220)
}
