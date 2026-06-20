import { describe, expect, it } from 'vitest'
import {
  asCollaborationReply,
  channelAddress,
  createCollaborationEvent,
  formatCollaborationAddress,
  parseCollaborationAddress,
  resourceAddress
} from '../collaboration-events'

describe('collaboration events and addresses', () => {
  it('parses ONM-style local, scoped, channel, resource, core and bare agent addresses', () => {
    expect(parseCollaborationAddress('agent:codex')).toMatchObject({
      network: 'local',
      entityType: 'agent',
      name: 'codex',
      isAgent: true
    })
    expect(parseCollaborationAddress('agent:broadcast').isBroadcast).toBe(true)
    expect(parseCollaborationAddress('core').isCore).toBe(true)
    expect(parseCollaborationAddress('channel/mission-1')).toMatchObject({ entityType: 'channel', name: 'mission-1', isChannel: true })
    expect(parseCollaborationAddress('resource/context/project-brief')).toMatchObject({ entityType: 'resource', name: 'context/project-brief' })
    expect(parseCollaborationAddress('net-a::human:gao')).toMatchObject({ network: 'net-a', entityType: 'human', name: 'gao', isHuman: true })
    expect(parseCollaborationAddress('claude')).toMatchObject({ entityType: 'agent', name: 'claude' })
  })

  it('formats helper addresses and rejects invalid event envelopes', () => {
    expect(channelAddress('mission-1')).toBe('channel/mission-1')
    expect(resourceAddress('tool', 'search')).toBe('resource/tool/search')
    expect(formatCollaborationAddress({ network: 'remote', entityType: 'agent', name: 'codex' })).toBe('remote::agent:codex')

    expect(() => createCollaborationEvent({
      type: '',
      source: 'agent:codex',
      target: 'channel/general'
    })).toThrow(/Event type/)
    expect(() => parseCollaborationAddress('')).toThrow(/empty/)
  })

  it('creates events with defaults and replies by swapping source/target', () => {
    const event = createCollaborationEvent({
      id: 'event-1',
      type: 'mission.plan.proposed',
      source: 'agent:agenthub',
      target: 'channel/mission-1',
      missionId: 'mission-1',
      payload: { ok: true },
      timestamp: 123
    })

    expect(event).toMatchObject({
      id: 'event-1',
      network: 'local',
      visibility: 'channel',
      missionId: 'mission-1',
      timestamp: 123
    })

    const reply = asCollaborationReply(event, {
      id: 'event-2',
      type: 'mission.plan.approved',
      payload: { approved: true },
      timestamp: 456
    })
    expect(reply).toMatchObject({
      id: 'event-2',
      source: 'channel/mission-1',
      target: 'agent:agenthub',
      metadata: { in_reply_to: 'event-1' }
    })
  })
})
