import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'

export type MemoryCategory =
  | 'conversation'
  | 'task'
  | 'skill'
  | 'file'
  | 'system'
  | 'episodic'
  | 'semantic'
  | 'procedure'
  | 'decision'

export interface MemoryEntryInput {
  id?: string
  category: MemoryCategory
  title: string
  summary?: string
  content?: string
  source?: string
  tags?: string[]
  metadata?: Record<string, any>
}

export interface MemoryEntry extends MemoryEntryInput {
  id: string
  category: MemoryCategory
  summary: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface RuntimeMemoryState {
  messages: any[]
  tasks: any[]
  conversations?: RuntimeConversationState[]
  activeConversationId?: string | null
  activeWorkspaceId?: string | null
}

export interface RuntimeConversationState {
  id: string
  workspaceId: string | null
  title: string
  createdAt: number
  updatedAt: number
  messages: any[]
  tasks: any[]
}

export interface MemoryCatalog {
  version: 1
  root: string
  entries: MemoryEntry[]
  counts: Record<MemoryCategory, number>
  runtimeUpdatedAt?: string
}

interface MemoryIndex {
  version: 1
  entries: MemoryEntry[]
  runtimeUpdatedAt?: string
}

const CATEGORIES: MemoryCategory[] = [
  'conversation',
  'task',
  'skill',
  'file',
  'system',
  'episodic',
  'semantic',
  'procedure',
  'decision'
]
const DEFAULT_INDEX: MemoryIndex = { version: 1, entries: [] }

export class MemoryLibrary {
  readonly root: string
  private readonly indexPath: string
  private readonly historyDir: string
  private readonly latestPath: string

  constructor(root: string) {
    this.root = basename(normalize(root)) === 'memory' ? root : join(root, 'memory')
    this.indexPath = join(this.root, 'index.json')
    this.historyDir = join(this.root, 'history')
    this.latestPath = join(this.historyDir, 'session-latest.json')
    this.ensureDirs()
  }

  getCatalog(): MemoryCatalog {
    const index = this.readIndex()
    return {
      version: 1,
      root: this.root,
      entries: index.entries.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      counts: countEntries(index.entries),
      runtimeUpdatedAt: index.runtimeUpdatedAt
    }
  }

  listEntries(category?: MemoryCategory): MemoryEntry[] {
    const entries = this.getCatalog().entries
    return category ? entries.filter(entry => entry.category === category) : entries
  }

  upsertEntry(input: MemoryEntryInput): MemoryEntry {
    const index = this.readIndex()
    const now = new Date().toISOString()
    const id = input.id || makeEntryId(input.category, input.source || input.title)
    const existing = index.entries.find(entry => entry.id === id)
    const entry: MemoryEntry = {
      id,
      category: input.category,
      title: cleanTitle(input.title),
      summary: input.summary || '',
      content: input.content,
      source: input.source,
      tags: input.tags || [],
      metadata: input.metadata || {},
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    index.entries = [entry, ...index.entries.filter(item => item.id !== id)]
    this.writeIndex(index)
    return entry
  }

  saveRuntimeState(state: RuntimeMemoryState): RuntimeMemoryState {
    const normalized = normalizeRuntimeState(state)
    this.writeJson(this.latestPath, normalized)
    this.writeJson(join(this.historyDir, todayName()), normalized)

    const index = this.readIndex()
    const now = new Date().toISOString()
    const dailyHistory = todayName()
    const tasksForEntries = normalized.conversations.length > 0
      ? normalized.conversations.flatMap(conv => conv.tasks.map(task => ({ ...task, conversationId: conv.id, workspaceId: conv.workspaceId })))
      : normalized.tasks
    const runtimeEntries = [
      ...(normalized.conversations.length > 0
        ? normalized.conversations.map(conversationToEntry)
        : normalized.messages.map(messageToEntry)),
      ...tasksForEntries.map(taskToEntry),
      historyFileToEntry('history/session-latest.json', 'Latest session snapshot'),
      historyFileToEntry(`history/${dailyHistory}`, 'Daily session snapshot')
    ].map(entry => ({
      ...entry,
      createdAt: index.entries.find(old => old.id === entry.id)?.createdAt || now,
      updatedAt: now
    }))
    const runtimeIds = new Set(runtimeEntries.map(entry => entry.id))
    index.entries = [
      ...runtimeEntries,
      ...index.entries.filter(entry => !runtimeIds.has(entry.id))
    ]
    index.runtimeUpdatedAt = now
    this.writeIndex(index)
    return normalized
  }

  loadRuntimeState(): RuntimeMemoryState {
    if (!existsSync(this.latestPath)) return normalizeRuntimeState({})
    try {
      return normalizeRuntimeState(JSON.parse(readFileSync(this.latestPath, 'utf-8')))
    } catch {
      return normalizeRuntimeState({})
    }
  }

  private ensureDirs(): void {
    mkdirSync(this.historyDir, { recursive: true })
  }

  private readIndex(): MemoryIndex {
    if (!existsSync(this.indexPath)) return { ...DEFAULT_INDEX, entries: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf-8'))
      return {
        version: 1,
        entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isMemoryEntry) : [],
        runtimeUpdatedAt: typeof parsed.runtimeUpdatedAt === 'string' ? parsed.runtimeUpdatedAt : undefined
      }
    } catch {
      return { ...DEFAULT_INDEX, entries: [] }
    }
  }

  private writeIndex(index: MemoryIndex): void {
    this.writeJson(this.indexPath, index)
  }

  private writeJson(path: string, value: any): void {
    this.ensureDirs()
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8')
  }
}

function normalizeRuntimeState(input: any): RuntimeMemoryState {
  const activeWorkspaceId = typeof input?.activeWorkspaceId === 'string' ? input.activeWorkspaceId : null
  let conversations: RuntimeConversationState[] = Array.isArray(input?.conversations)
    ? input.conversations.filter((conv: any) => conv && typeof conv.id === 'string').map(normalizeConversation)
    : []
  const legacyMessages = Array.isArray(input?.messages) ? input.messages.map(normalizeMessage) : []
  const legacyTasks = Array.isArray(input?.tasks) ? input.tasks.map(normalizeTask) : []
  if (conversations.length === 0 && (legacyMessages.length > 0 || legacyTasks.length > 0)) {
    const now = Date.now()
    conversations = [{
      id: `conv-${now.toString(36)}-legacy`,
      workspaceId: activeWorkspaceId,
      title: cleanTitle(legacyMessages[0]?.text || 'Migrated conversation'),
      createdAt: now,
      updatedAt: now,
      messages: legacyMessages,
      tasks: legacyTasks
    }]
  }
  conversations = conversations.sort((a, b) => b.updatedAt - a.updatedAt)
  const activeConversationId = typeof input?.activeConversationId === 'string' && conversations.some(conv => conv.id === input.activeConversationId)
    ? input.activeConversationId
    : conversations[0]?.id ?? null
  const active = conversations.find(conv => conv.id === activeConversationId)
  const messages = active ? active.messages : legacyMessages
  const tasks = active ? active.tasks : legacyTasks
  return { messages, tasks, conversations, activeConversationId, activeWorkspaceId }
}

function normalizeConversation(conv: any): RuntimeConversationState {
  const now = Date.now()
  return {
    id: conv.id,
    workspaceId: typeof conv.workspaceId === 'string' ? conv.workspaceId : null,
    title: cleanTitle(conv.title || conv.messages?.[0]?.text || 'New conversation'),
    createdAt: typeof conv.createdAt === 'number' ? conv.createdAt : now,
    updatedAt: typeof conv.updatedAt === 'number' ? conv.updatedAt : now,
    messages: Array.isArray(conv.messages) ? conv.messages.map(normalizeMessage) : [],
    tasks: Array.isArray(conv.tasks) ? conv.tasks.map(normalizeTask) : []
  }
}

function normalizeMessage(message: any): any {
  const replies = Array.isArray(message?.replies) ? message.replies.map((reply: any) => {
    if (reply?.done) return reply
    return { ...reply, done: true, cancelled: true }
  }) : []
  return { ...message, replies }
}

function normalizeTask(task: any): any {
  return task?.status === 'running' ? { ...task, status: 'cancelled' } : task
}

function messageToEntry(message: any): MemoryEntry {
  const agentIds = Array.isArray(message.replies) ? message.replies.map((reply: any) => reply.agentId).filter(Boolean) : []
  const errors = Array.isArray(message.replies) ? message.replies.map((reply: any) => reply.error).filter(Boolean) : []
  const resultCount = Array.isArray(message.replies) ? message.replies.filter((reply: any) => reply.text).length : 0
  return {
    id: makeEntryId('conversation', message.id || message.taskId || message.text),
    category: 'conversation',
    title: cleanTitle(message.text || 'Conversation'),
    summary: errors.length ? `包含 ${errors.length} 条错误` : `包含 ${resultCount} 条 Agent 回复`,
    content: JSON.stringify(message, null, 2),
    tags: ['chat', message.mode].filter(Boolean),
    metadata: {
      messageId: message.id,
      taskId: message.taskId,
      mode: message.mode,
      agentIds
    },
    createdAt: '',
    updatedAt: ''
  }
}

function taskToEntry(task: any): MemoryEntry {
  return {
    id: makeEntryId('task', task.id || task.text),
    category: 'task',
    title: cleanTitle(task.text || 'Task'),
    summary: `${task.status || 'unknown'} · ${(task.agents || []).join(', ') || 'no agent'}`,
    content: JSON.stringify(task, null, 2),
    tags: ['task', task.mode, task.status].filter(Boolean),
    metadata: {
      taskId: task.id,
      mode: task.mode,
      status: task.status,
      agents: task.agents || [],
      durationMs: task.durationMs
    },
    createdAt: '',
    updatedAt: ''
  }
}

function conversationToEntry(conversation: RuntimeConversationState): MemoryEntry {
  const failedTasks = conversation.tasks.filter((task: any) => task?.status === 'failed').length
  const doneTasks = conversation.tasks.filter((task: any) => task?.status === 'completed').length
  return {
    id: makeEntryId('conversation', conversation.id),
    category: 'conversation',
    title: cleanTitle(conversation.title || 'Conversation'),
    summary: `${conversation.messages.length} message(s) · ${doneTasks} completed · ${failedTasks} failed`,
    content: JSON.stringify(conversation, null, 2),
    tags: ['conversation', conversation.workspaceId ? 'workspace' : 'no-workspace'].filter(Boolean),
    metadata: {
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      messageCount: conversation.messages.length,
      taskCount: conversation.tasks.length
    },
    createdAt: '',
    updatedAt: ''
  }
}

function historyFileToEntry(source: string, title: string): MemoryEntry {
  return {
    id: makeEntryId('file', source),
    category: 'file',
    title,
    summary: 'AgentHub runtime memory snapshot',
    source,
    tags: ['history', 'snapshot'],
    metadata: { kind: 'runtime-snapshot' },
    createdAt: '',
    updatedAt: ''
  }
}

function countEntries(entries: MemoryEntry[]): Record<MemoryCategory, number> {
  return CATEGORIES.reduce((counts, category) => {
    counts[category] = entries.filter(entry => entry.category === category).length
    return counts
  }, {} as Record<MemoryCategory, number>)
}

function cleanTitle(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 96) || 'Untitled'
}

function makeEntryId(category: MemoryCategory, seed: string): string {
  return `${category}:${encodeURIComponent(String(seed || 'untitled')).slice(0, 120)}`
}

function todayName(): string {
  return new Date().toISOString().slice(0, 10) + '.json'
}

function isMemoryEntry(value: any): value is MemoryEntry {
  return !!value && CATEGORIES.includes(value.category) && typeof value.id === 'string' && typeof value.title === 'string'
}
