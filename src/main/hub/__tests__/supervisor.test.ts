import { describe, expect, it } from 'vitest'
import { parseSupervisorDecision, Supervisor } from '../supervisor'

const contract = {
  id: 'a',
  title: 'Implement API',
  detail: 'Build endpoint',
  agentId: 'codex',
  dependsOn: [],
  doneWhen: 'tests pass',
  verifyCommand: 'npm test',
  interfaceRef: 'GET /api/items'
}

describe('Supervisor', () => {
  it('rules verification failures as rework', async () => {
    const sup = new Supervisor()
    const decision = await sup.assess({
      missionId: 'm',
      contract,
      kind: 'verification_failed',
      verifierNote: 'missing tests'
    })

    expect(decision).toMatchObject({ state: 'needs-rework', action: 'retry', source: 'rule' })
  })

  it('calls lightweight LLM for ambiguous stalls', async () => {
    const sup = new Supervisor()
    const decision = await sup.assess({
      missionId: 'm',
      contract,
      kind: 'stall',
      idleMs: 120_000
    }, async () => '{"state":"waiting","action":"wait","reason":"waiting for dependency","confidence":0.8}')

    expect(decision).toMatchObject({ state: 'waiting', action: 'wait', source: 'llm' })
  })

  it('parses bounded JSON decisions', () => {
    expect(parseSupervisorDecision('```json\n{"state":"failed","action":"fail","reason":"bad","confidence":2}\n```'))
      .toMatchObject({ state: 'failed', action: 'fail', confidence: 1 })
    expect(parseSupervisorDecision('no json')).toBeNull()
  })
})
