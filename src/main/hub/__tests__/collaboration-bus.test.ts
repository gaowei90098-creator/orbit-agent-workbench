import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CollaborationBus, CollaborationEventRejected, CollaborationPipeline } from '../collaboration-bus'
import { createCollaborationEvent } from '../collaboration-events'

let dirs: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agenthub-collab-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('CollaborationBus', () => {
  it('runs guard, transform and observe mods in canonical order', async () => {
    const order: string[] = []
    const bus = new CollaborationBus(tempRoot(), new CollaborationPipeline([
      {
        name: 'observer',
        mode: 'observe',
        priority: 1,
        process: (event) => {
          order.push(`observe:${event.metadata.transformed}`)
        }
      },
      {
        name: 'guard',
        mode: 'guard',
        priority: 99,
        process: (event) => {
          order.push('guard')
          return event
        }
      },
      {
        name: 'transform',
        mode: 'transform',
        priority: 1,
        process: (event) => {
          order.push('transform')
          return { ...event, metadata: { ...event.metadata, transformed: true } }
        }
      }
    ]))

    const event = await bus.append({
      id: 'event-1',
      type: 'mission.plan.proposed',
      source: 'agent:agenthub',
      target: 'channel/mission-1',
      missionId: 'mission-1',
      timestamp: 100
    })

    expect(order).toEqual(['guard', 'transform', 'observe:true'])
    expect(event.metadata.transformed).toBe(true)
    expect(bus.list({ missionId: 'mission-1' })).toHaveLength(1)
  })

  it('rejects events when a guard returns null', async () => {
    const bus = new CollaborationBus(tempRoot(), new CollaborationPipeline([
      {
        name: 'policy',
        mode: 'guard',
        process: () => null
      }
    ]))

    await expect(bus.append({
      type: 'mission.contract.created',
      source: 'agent:agenthub',
      target: 'channel/mission-1'
    })).rejects.toBeInstanceOf(CollaborationEventRejected)
    expect(bus.list()).toHaveLength(0)
  })

  it('persists events, side effects and mission timelines', async () => {
    const root = tempRoot()
    const bus = new CollaborationBus(root, new CollaborationPipeline([
      {
        name: 'side-effect',
        mode: 'observe',
        intercepts: ['mission.contract.completed'],
        process: (_event, context) => {
          context.emit(createCollaborationEvent({
            id: 'event-side',
            type: 'mission.outcome.recorded',
            source: 'mod/side-effect',
            target: 'channel/mission-1',
            missionId: 'mission-1',
            payload: { summary: 'done' },
            timestamp: 200
          }))
        }
      }
    ]))

    await bus.append({
      id: 'event-main',
      type: 'mission.contract.completed',
      source: 'agent:codex',
      target: 'channel/mission-1',
      missionId: 'mission-1',
      payload: { contractId: 'a', status: 'done', title: 'Fix bug' },
      timestamp: 100
    })

    const reopened = new CollaborationBus(bus.root)
    expect(reopened.list({ missionId: 'mission-1' }).map(event => event.id)).toEqual(['event-side', 'event-main'])
    expect(reopened.list({ typePrefix: 'mission.contract' })).toHaveLength(1)
    expect(reopened.buildMissionTimeline('mission-1')).toContain('mission.contract.completed')
    expect(reopened.buildMissionTimeline('mission-1')).toContain('contractId=a')
  })
})
