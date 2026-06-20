/**
 * 把已装技能拼成可注入的「Installed Skills」块（带字符上限，避免 token 爆炸）。
 * 由 dispatcher 取 SkillManager.installedFor(agentId) 后调用，注入到系统提示。
 * 无技能 → 返回空串（不注入，零回归）。
 */
import { SkillDef } from './types'

/** 注入上限（字符数），与 workspace bootstrap 的上限思路一致。 */
export const SKILL_BLOCK_MAX_CHARS = 16000

export function buildSkillBlock(skills: SkillDef[]): string {
  if (!skills || skills.length === 0) return ''
  const header = [
    '# Installed Skills',
    'You have the following skills installed. Apply the relevant ones to the current task; ignore the rest.'
  ]
  const blocks: string[] = []
  let used = 0
  let omitted = 0
  for (const s of skills) {
    const body = [
      `## ${s.name}`,
      s.description ? `> ${s.description}` : '',
      s.instructions.trim()
    ].filter(Boolean).join('\n')
    if (used + body.length > SKILL_BLOCK_MAX_CHARS && blocks.length > 0) {
      omitted += 1
      continue
    }
    blocks.push(body)
    used += body.length
  }
  if (omitted > 0) blocks.push(`(${omitted} more skill(s) omitted due to length limit.)`)
  return [...header, '', blocks.join('\n\n')].join('\n').trim()
}
