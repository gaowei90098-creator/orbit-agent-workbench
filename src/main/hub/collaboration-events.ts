import { randomUUID } from 'node:crypto'

export type CollaborationVisibility = 'public' | 'channel' | 'direct' | 'private'

export type CollaborationEntityType =
  | 'agent'
  | 'openagents'
  | 'human'
  | 'channel'
  | 'mod'
  | 'group'
  | 'resource'
  | 'core'

export interface CollaborationAddress {
  raw: string
  network: string
  entityType: CollaborationEntityType
  name: string
  isLocal: boolean
  isBroadcast: boolean
  isCore: boolean
  isChannel: boolean
  isAgent: boolean
  isHuman: boolean
  isResource: boolean
}

export interface CollaborationEvent<TPayload = unknown> {
  id: string
  type: string
  source: string
  target: string
  payload?: TPayload
  metadata: Record<string, unknown>
  timestamp: number
  network: string
  visibility: CollaborationVisibility
  missionId?: string
  channel?: string
}

export interface CreateCollaborationEventInput<TPayload = unknown> {
  id?: string
  type: string
  source: string
  target: string
  payload?: TPayload
  metadata?: Record<string, unknown>
  timestamp?: number
  network?: string
  visibility?: CollaborationVisibility
  missionId?: string
  channel?: string
}

const COLON_PREFIXES = ['agent:', 'openagents:', 'human:'] as const
const SLASH_PREFIXES = ['channel/', 'mod/', 'group/', 'resource/'] as const

export const CollaborationEventTypes = {
  MissionStarted: 'mission.started',
  MissionPlanProposed: 'mission.plan.proposed',
  MissionPlanApprovalRequested: 'mission.plan.approval_requested',
  MissionPlanApproved: 'mission.plan.approved',
  MissionPlanRejected: 'mission.plan.rejected',
  MissionStatusChanged: 'mission.status.changed',
  ContractCreated: 'mission.contract.created',
  ContractClaimed: 'mission.contract.claimed',
  ContractStatusChanged: 'mission.contract.status_changed',
  ContractCompleted: 'mission.contract.completed',
  ContractFailed: 'mission.contract.failed',
  VerificationResult: 'mission.contract.verification_result',
  SupervisorDecision: 'mission.supervisor.decision',
  SynthesisStarted: 'mission.synthesis.started',
  SynthesisCompleted: 'mission.synthesis.completed',
  OutcomeRecorded: 'mission.outcome.recorded',
  UserNotificationRequested: 'user.notification.requested'
} as const

export function parseCollaborationAddress(raw: string): CollaborationAddress {
  if (!raw || !raw.trim()) throw new Error('Address cannot be empty')
  const scoped = raw.includes('::')
  const [network, entity] = scoped ? splitNetwork(raw) : ['local', raw]
  if (!network) throw new Error(`Invalid address: empty network in '${raw}'`)

  if (entity === 'core') return decorateAddress({ raw, network, entityType: 'core', name: '' })

  for (const prefix of SLASH_PREFIXES) {
    if (entity.startsWith(prefix)) {
      return decorateAddress({
        raw,
        network,
        entityType: prefix.slice(0, -1) as CollaborationEntityType,
        name: entity.slice(prefix.length)
      })
    }
  }

  for (const prefix of COLON_PREFIXES) {
    if (entity.startsWith(prefix)) {
      return decorateAddress({
        raw,
        network,
        entityType: prefix.slice(0, -1) as CollaborationEntityType,
        name: entity.slice(prefix.length)
      })
    }
  }

  return decorateAddress({ raw, network, entityType: 'agent', name: entity })
}

export function formatCollaborationAddress(address: Pick<CollaborationAddress, 'network' | 'entityType' | 'name'>): string {
  let base: string
  if (address.entityType === 'core') base = 'core'
  else if (address.entityType === 'agent' || address.entityType === 'openagents' || address.entityType === 'human') {
    base = `${address.entityType}:${address.name}`
  } else {
    base = `${address.entityType}/${address.name}`
  }
  return address.network && address.network !== 'local' ? `${address.network}::${base}` : base
}

export function agentAddress(name: string, globalAgent = false): string {
  return `${globalAgent ? 'openagents' : 'agent'}:${name}`
}

export function humanAddress(identifier: string): string {
  return `human:${identifier}`
}

export function channelAddress(name: string): string {
  return `channel/${name}`
}

export function resourceAddress(resourceType: string, name: string): string {
  return `resource/${resourceType}/${name}`
}

export function createCollaborationEvent<TPayload = unknown>(
  input: CreateCollaborationEventInput<TPayload>
): CollaborationEvent<TPayload> {
  validateEventInput(input)
  return {
    id: input.id || randomUUID(),
    type: input.type,
    source: input.source,
    target: input.target,
    payload: input.payload,
    metadata: input.metadata || {},
    timestamp: input.timestamp || Date.now(),
    network: input.network || 'local',
    visibility: input.visibility || 'channel',
    missionId: input.missionId,
    channel: input.channel
  }
}

export function asCollaborationReply<TPayload = unknown>(
  event: CollaborationEvent,
  input: Omit<CreateCollaborationEventInput<TPayload>, 'source' | 'target' | 'metadata' | 'network'> & {
    metadata?: Record<string, unknown>
  }
): CollaborationEvent<TPayload> {
  return createCollaborationEvent({
    ...input,
    source: event.target,
    target: event.source,
    network: event.network,
    metadata: { ...(input.metadata || {}), in_reply_to: event.id }
  })
}

function splitNetwork(raw: string): [string, string] {
  const idx = raw.indexOf('::')
  return [raw.slice(0, idx), raw.slice(idx + 2)]
}

function decorateAddress(input: Pick<CollaborationAddress, 'raw' | 'network' | 'entityType' | 'name'>): CollaborationAddress {
  return {
    ...input,
    isLocal: input.network === 'local',
    isBroadcast: input.entityType === 'agent' && input.name === 'broadcast',
    isCore: input.entityType === 'core',
    isChannel: input.entityType === 'channel',
    isAgent: input.entityType === 'agent' || input.entityType === 'openagents',
    isHuman: input.entityType === 'human',
    isResource: input.entityType === 'resource'
  }
}

function validateEventInput(input: CreateCollaborationEventInput): void {
  if (!input.type || !input.type.trim()) throw new Error('Event type cannot be empty')
  parseCollaborationAddress(input.source)
  parseCollaborationAddress(input.target)
}
