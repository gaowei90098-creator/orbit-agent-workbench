/**
 * 技能(Skill)类型定义
 *
 * 技能 = 一段 SKILL.md 风格的指令包，按 agent 安装；派发时把目标 agent 已装技能
 * 拼成「Installed Skills」块注入系统提示（HTTP 与 stdio 两条路径都注入）。
 */

export interface SkillDef {
  id: string
  name: string
  /** 一行描述（也用于触发判断的语义提示） */
  description: string
  /** SKILL.md 风格的指令正文，注入到系统提示 */
  instructions: string
  tags: string[]
  /** 来源标注：builtin / paste / 文件路径 */
  source: string
  createdAt: number
  updatedAt: number
}

/** agentId -> 已装 skillId 列表 */
export type SkillInstalls = Record<string, string[]>

export interface SkillInstallState {
  installs: SkillInstalls
}

/** 新建/导入技能的入参（id/时间戳由 manager 生成） */
export interface SkillInput {
  name: string
  description?: string
  instructions: string
  tags?: string[]
  source?: string
}

/** 内置技能模板（首次使用时可一键添加；纯文本，无副作用） */
export const BUILTIN_SKILLS: SkillInput[] = [
  {
    name: 'Code Reviewer',
    description: '审查代码改动：找正确性 bug 与可简化/复用点',
    tags: ['builtin', 'review', 'coding'],
    source: 'builtin',
    instructions: [
      'When reviewing code, focus on:',
      '1. Correctness bugs: off-by-one, null/undefined, race conditions, error handling, edge cases.',
      '2. Reuse & simplification: duplicated logic, existing utilities that should be used, dead code.',
      '3. Security: injection, path traversal, secret leakage, unsafe deserialization.',
      'Report findings as a short prioritized list. Cite file:line. Be concrete, no vague praise.'
    ].join('\n')
  },
  {
    name: 'Test Writer',
    description: '为改动补单元测试，覆盖正常/边界/失败路径',
    tags: ['builtin', 'testing', 'coding'],
    source: 'builtin',
    instructions: [
      'When asked to add tests:',
      '1. Match the project\'s existing test framework and file conventions.',
      '2. Cover the happy path, boundary values, and at least one failure/error path.',
      '3. Keep each test focused and independent; avoid shared mutable state.',
      '4. Prefer asserting behavior/outputs over implementation details.'
    ].join('\n')
  },
  {
    name: 'Concise Writer',
    description: '中英技术写作：信息密度高、无套话',
    tags: ['builtin', 'writing'],
    source: 'builtin',
    instructions: [
      'When writing prose or docs:',
      '- Lead with the conclusion, then support it.',
      '- Cut filler, hedging, and generic disclaimers.',
      '- Prefer concrete nouns/verbs and short sentences.',
      '- Keep the user\'s language (zh/en) consistent with their request.'
    ].join('\n')
  }
]
