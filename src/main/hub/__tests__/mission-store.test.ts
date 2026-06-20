import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlanArtifact } from '../plan-artifact'
import { MissionStore } from '../mission-store'

let dirs: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agenthub-missions-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('MissionStore', () => {
  it('persists plans, active STM and outcomes', () => {
    const store = new MissionStore(tempRoot())
    const plan = createPlanArtifact({
      missionId: 'mission-1',
      goal: 'fix bug and write docs',
      leadAgentId: 'claude',
      subtasks: [
        { id: 'a', title: 'Fix bug', detail: 'debug code', agent: 'codex' },
        { id: 'b', title: 'Write docs', detail: 'document result', agent: 'claude' }
      ]
    })

    store.upsertPlan(plan)
    store.updateTaskStatus('mission-1', 'a', 'running')
    store.recordOutcome({
      missionId: 'mission-1',
      goal: plan.goal,
      status: 'completed',
      summary: 'Done',
      lessons: ['keep contracts small'],
      verified: true,
      taskCount: 2
    })

    const reopened = new MissionStore(store.root)
    expect(reopened.getActivePlan()?.missionId).toBe('mission-1')
    expect(reopened.listOutcomes()[0]).toMatchObject({ summary: 'Done', verified: true })
    expect(reopened.buildPlannerContext()).toContain('RECENT EPISODIC OUTCOMES')
    expect(reopened.getRouterContext()?.routeContext).toContain('debug code')
  })
})
