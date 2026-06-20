import { describe, it, expect } from 'vitest'
import { buildSkillBlock, SKILL_BLOCK_MAX_CHARS } from '../inject'
import { SkillDef } from '../types'

/** buildSkillBlock 单测 — 覆盖：空→空串、多技能拼装、字符上限省略计数。 */

function skill(name: string, instructions: string, description = ''): SkillDef {
  return { id: 'id-' + name, name, description, instructions, tags: [], source: 'test', createdAt: 0, updatedAt: 0 }
}

describe('buildSkillBlock', () => {
  it('空列表 → 空串（不注入，零回归）', () => {
    expect(buildSkillBlock([])).toBe('')
    expect(buildSkillBlock(undefined as any)).toBe('')
  })

  it('多技能：含标题、各技能名与指令', () => {
    const out = buildSkillBlock([skill('Code Review', 'Review carefully', 'reviews code'), skill('Translate', 'Translate text')])
    expect(out).toContain('# Installed Skills')
    expect(out).toContain('## Code Review')
    expect(out).toContain('Review carefully')
    expect(out).toContain('> reviews code')
    expect(out).toContain('## Translate')
  })

  it('超字符上限：后续技能被省略并标注计数', () => {
    const big = 'x'.repeat(SKILL_BLOCK_MAX_CHARS) // 第一条即占满
    const out = buildSkillBlock([skill('Big', big), skill('Dropped1', 'a'), skill('Dropped2', 'b')])
    expect(out).toContain('## Big')
    expect(out).not.toContain('## Dropped1')
    expect(out).toMatch(/2 more skill\(s\) omitted/)
  })
})
