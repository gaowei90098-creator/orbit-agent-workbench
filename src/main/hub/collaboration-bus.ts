import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import {
  CollaborationEvent,
  CreateCollaborationEventInput,
  createCollaborationEvent,
  parseCollaborationAddress
} from './collaboration-events'

export type CollaborationModMode = 'guard' | 'transform' | 'observe'

export interface CollaborationPipelineContext {
  networkId: string
  agentAddress?: string
  sideEffects: CollaborationEvent[]
  extra: Record<string, unknown>
  emit(event: CollaborationEvent): void
}

export interface CollaborationMod {
  name: string
  mode: CollaborationModMode
  priority?: number
  intercepts?: string[]
  process(event: CollaborationEvent, context: CollaborationPipelineContext): Promise<CollaborationEvent | null | void> | CollaborationEvent | null | void
}

export interface CollaborationEventFilter {
  missionId?: string
  channel?: string
  source?: string
  target?: string
  type?: string
  typePrefix?: string
  limit?: number
}

interface CollaborationState {
  version: 1
  events: CollaborationEvent[]
}

const DEFAULT_STATE: CollaborationState = {
  version: 1,
  events: []
}

const MODE_ORDER: Record<CollaborationModMode, number> = {
  guard: 0,
  transform: 1,
  observe: 2
}

const MAX_EVENTS = 2000
const MAX_SIDE_EFFECT_DEPTH = 4

export class CollaborationEventRejected extends Error {
  constructor(readonly modName: string, readonly reason: string) {
    super(`Event rejected by mod/${modName}: ${reason}`)
  }
}

export class CollaborationPipeline {
  private mods: CollaborationMod[] = []

  constructor(mods: CollaborationMod[] = []) {
    for (const mod of mods) this.add(mod)
  }

  add(mod: CollaborationMod): void {
    this.mods.push(mod)
    this.sort()
  }

  remove(name: string): void {
    this.mods = this.mods.filter(mod => mod.name !== name)
  }

  list(): CollaborationMod[] {
    return this.mods.slice()
  }

  async process(event: CollaborationEvent, context: CollaborationPipelineContext): Promise<CollaborationEvent> {
    let current = event
    for (const mod of this.mods) {
      if (!matchesAny(current.type, mod.intercepts || [])) continue
      if (mod.mode === 'guard') {
        const result = await mod.process(current, context)
        if (result === null) throw new CollaborationEventRejected(mod.name, 'rejected by guard')
        if (result) current = result
      } else if (mod.mode === 'transform') {
        const result = await mod.process(current, context)
        if (result) current = result
      } else {
        await mod.process(current, context)
      }
    }
    return current
  }

  private sort(): void {
    this.mods.sort((a, b) =>
      (MODE_ORDER[a.mode] - MODE_ORDER[b.mode]) || ((a.priority || 50) - (b.priority || 50)))
  }
}

export class CollaborationBus {
  readonly root: string
  readonly eventsPath: string
  readonly pipeline: CollaborationPipeline

  constructor(root: string, pipeline: CollaborationPipeline = new CollaborationPipeline()) {
    this.root = basename(normalize(root)) === 'collaboration' ? root : join(root, 'collaboration')
    this.eventsPath = join(this.root, 'events.json')
    this.pipeline = pipeline
    mkdirSync(this.root, { recursive: true })
  }

  register(mod: CollaborationMod): void {
    this.pipeline.add(mod)
  }

  async append(input: CreateCollaborationEventInput | CollaborationEvent): Promise<CollaborationEvent> {
    const event = isCollaborationEvent(input) ? input : createCollaborationEvent(input)
    return this.appendEvent(event, 0)
  }

  list(filter: CollaborationEventFilter = {}): CollaborationEvent[] {
    let events = this.read().events.slice()
    if (filter.missionId) events = events.filter(event => event.missionId === filter.missionId)
    if (filter.channel) events = events.filter(event => event.channel === filter.channel)
    if (filter.source) events = events.filter(event => event.source === filter.source)
    if (filter.target) events = events.filter(event => event.target === filter.target)
    if (filter.type) events = events.filter(event => event.type === filter.type)
    if (filter.typePrefix) events = events.filter(event => event.type.startsWith(filter.typePrefix!))
    events = events.sort((a, b) => b.timestamp - a.timestamp)
    return typeof filter.limit === 'number' ? events.slice(0, Math.max(0, filter.limit)) : events
  }

  buildMissionTimeline(missionId: string, limit = 50): string {
    return this.list({ missionId, limit })
      .slice()
      .reverse()
      .map(event => {
        const payload = event.payload && typeof event.payload === 'object'
          ? summarizePayload(event.payload as Record<string, unknown>)
          : String(event.payload || '')
        return `${new Date(event.timestamp).toISOString()} ${event.type} ${event.source} -> ${event.target}${payload ? ` | ${payload}` : ''}`
      })
      .join('\n')
      .slice(0, 6000)
  }

  private async appendEvent(event: CollaborationEvent, depth: number): Promise<CollaborationEvent> {
    if (depth > MAX_SIDE_EFFECT_DEPTH) throw new Error('Collaboration side-effect depth exceeded')
    parseCollaborationAddress(event.source)
    parseCollaborationAddress(event.target)
    const context = makeContext(event.network, event.source)
    const processed = await this.pipeline.process(event, context)
    this.persist(processed)
    for (const sideEffect of context.sideEffects) {
      await this.appendEvent(sideEffect, depth + 1)
    }
    return processed
  }

  private persist(event: CollaborationEvent): void {
    const state = this.read()
    state.events = [event, ...state.events.filter(item => item.id !== event.id)].slice(0, MAX_EVENTS)
    this.write(state)
  }

  private read(): CollaborationState {
    if (!existsSync(this.eventsPath)) return cloneState(DEFAULT_STATE)
    try {
      const parsed = JSON.parse(readFileSync(this.eventsPath, 'utf-8'))
      return {
        version: 1,
        events: Array.isArray(parsed.events) ? parsed.events.filter(isCollaborationEvent) : []
      }
    } catch {
      return cloneState(DEFAULT_STATE)
    }
  }

  private write(state: CollaborationState): void {
    mkdirSync(this.root, { recursive: true })
    writeFileSync(this.eventsPath, JSON.stringify(state, null, 2), 'utf-8')
  }
}

function makeContext(networkId: string, agentAddress: string): CollaborationPipelineContext {
  const context: CollaborationPipelineContext = {
    networkId,
    agentAddress,
    sideEffects: [],
    extra: {},
    emit(event) {
      context.sideEffects.push(event)
    }
  }
  return context
}

function matchesAny(eventType: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true
  return patterns.some(pattern => wildcardMatch(eventType, pattern))
}

function wildcardMatch(value: string, pattern: string): boolean {
  if (pattern === '*') return true
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
}

function isCollaborationEvent(input: any): input is CollaborationEvent {
  return !!input
    && typeof input.id === 'string'
    && typeof input.type === 'string'
    && typeof input.source === 'string'
    && typeof input.target === 'string'
    && typeof input.timestamp === 'number'
    && typeof input.network === 'string'
    && typeof input.visibility === 'string'
    && input.metadata
    && typeof input.metadata === 'object'
}

function cloneState(state: CollaborationState): CollaborationState {
  return {
    version: 1,
    events: state.events.slice()
  }
}

function summarizePayload(payload: Record<string, unknown>): string {
  const pieces: string[] = []
  for (const key of ['missionId', 'contractId', 'status', 'agentId', 'decision', 'summary', 'error', 'title']) {
    const value = payload[key]
    if (typeof value === 'string' && value) pieces.push(`${key}=${value.slice(0, 120)}`)
  }
  return pieces.join(' ')
}
