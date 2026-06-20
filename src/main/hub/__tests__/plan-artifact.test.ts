import { describe, expect, it } from 'vitest'
import { createPlanArtifact, parsePlanArtifact, setContractStatus } from '../plan-artifact'

describe('PlanArtifact / TaskDAG / TaskContract', () => {
  it('normalizes subtasks into a task DAG with contracts', () => {
    const artifact = createPlanArtifact({
      missionId: 'mission-1',
      goal: 'ship feature',
      leadAgentId: 'claude',
      now: '2026-06-18T00:00:00.000Z',
      subtasks: [
        { id: 'a', title: 'API', detail: 'build api', agent: 'codex', fileScope: ['src/api/**'], doneWhen: 'tests pass' },
        { id: 'b', title: 'Docs', detail: 'write docs', agentId: 'claude', dependsOn: ['a'] }
      ],
      knownAgents: ['codex', 'claude']
    })

    expect(artifact.taskDag.nodes).toHaveLength(2)
    expect(artifact.taskDag.nodes[0]).toMatchObject({
      id: 'a',
      agentId: 'codex',
      fileScope: ['src/api/**'],
      status: 'planned'
    })
    expect(artifact.taskDag.edges).toEqual([{ from: 'a', to: 'b', type: 'blocks' }])
  })

  it('parses preferred taskDag.nodes JSON and legacy subtasks JSON', () => {
    const dag = parsePlanArtifact('{"taskDag":{"nodes":[{"id":"1","title":"One","detail":"Do one"}]}}', {
      missionId: 'm',
      goal: 'g'
    })
    const legacy = parsePlanArtifact('```json\n{"subtasks":[{"id":"2","title":"Two","detail":"Do two"}]}\n```', {
      missionId: 'm',
      goal: 'g'
    })

    expect(dag?.taskDag.nodes[0].title).toBe('One')
    expect(legacy?.taskDag.nodes[0].title).toBe('Two')
  })

  it('rolls up contract status into plan status', () => {
    const artifact = createPlanArtifact({
      missionId: 'mission-2',
      goal: 'goal',
      subtasks: [{ id: '1', title: 'A', detail: 'A' }]
    })

    expect(setContractStatus(artifact, '1', 'done').status).toBe('completed')
    expect(setContractStatus(artifact, '1', 'failed').status).toBe('failed')
  })
})
