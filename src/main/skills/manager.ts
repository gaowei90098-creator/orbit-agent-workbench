/**
 * SkillManager —— 技能注册 + 按 agent 的安装状态（单例，落盘 store key `skills.v1`）。
 * 形态镜像 WorkspaceManager（src/main/hub/workspace.ts）。
 *
 * 不变量：
 *   - 落盘形状 { version: 1, skills: SkillDef[], installs: Record<agentId, skillId[]> }
 *   - remove(skillId) 同时从所有 agent 的 installs 中清除该 skill
 *   - install/uninstall 的 agentId 传 '*' = 对所有 manifest 已知 agent 批量操作（集体安装）
 */
import { store } from '../store'
import { AGENTS } from '../hub/agents'
import { SkillDef, SkillInput, SkillInstalls } from './types'

const STORAGE_KEY = 'skills.v1'

interface PersistedShape {
  version: 1
  skills: SkillDef[]
  installs: SkillInstalls
}

function emptyState(): PersistedShape {
  return { version: 1, skills: [], installs: {} }
}

let counter = 0
function genId(): string {
  counter += 1
  return 'skill-' + Date.now().toString(36) + '-' + counter.toString(36)
}

function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

export class SkillManager {
  private read(): PersistedShape {
    const raw = store.get(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return emptyState()
    const skills = Array.isArray(raw.skills) ? raw.skills.filter((s: any) => s && typeof s.id === 'string') : []
    const installs = (raw.installs && typeof raw.installs === 'object') ? raw.installs : {}
    return { version: 1, skills, installs }
  }

  private write(s: PersistedShape): void {
    store.set(STORAGE_KEY, s)
  }

  list(): SkillDef[] {
    return this.read().skills
  }

  get(id: string): SkillDef | undefined {
    return this.read().skills.find(s => s.id === id)
  }

  add(input: SkillInput): SkillDef {
    const s = this.read()
    const now = Date.now()
    const skill: SkillDef = {
      id: genId(),
      name: clampStr(input.name, 120).trim() || 'Untitled skill',
      description: clampStr(input.description, 400).trim(),
      instructions: clampStr(input.instructions, 40000),
      tags: Array.isArray(input.tags) ? input.tags.map(t => clampStr(t, 40)).filter(Boolean).slice(0, 12) : [],
      source: clampStr(input.source, 400) || 'paste',
      createdAt: now,
      updatedAt: now
    }
    s.skills.push(skill)
    this.write(s)
    return skill
  }

  update(id: string, patch: Partial<SkillInput>): SkillDef | undefined {
    const s = this.read()
    const skill = s.skills.find(x => x.id === id)
    if (!skill) return undefined
    if (patch.name !== undefined) skill.name = clampStr(patch.name, 120).trim() || skill.name
    if (patch.description !== undefined) skill.description = clampStr(patch.description, 400).trim()
    if (patch.instructions !== undefined) skill.instructions = clampStr(patch.instructions, 40000)
    if (patch.tags !== undefined) skill.tags = patch.tags.map(t => clampStr(t, 40)).filter(Boolean).slice(0, 12)
    if (patch.source !== undefined) skill.source = clampStr(patch.source, 400)
    skill.updatedAt = Date.now()
    this.write(s)
    return skill
  }

  remove(id: string): boolean {
    const s = this.read()
    const before = s.skills.length
    s.skills = s.skills.filter(x => x.id !== id)
    if (s.skills.length === before) return false
    // 从所有 agent 的安装表中清除
    for (const agentId of Object.keys(s.installs)) {
      s.installs[agentId] = (s.installs[agentId] || []).filter(sid => sid !== id)
    }
    this.write(s)
    return true
  }

  getInstalls(): SkillInstalls {
    return this.read().installs
  }

  isInstalled(agentId: string, skillId: string): boolean {
    return (this.read().installs[agentId] || []).includes(skillId)
  }

  /** agentId 传 '*' = 对所有 manifest 已知 agent 安装（集体安装）。 */
  install(agentId: string, skillId: string): SkillInstalls {
    const s = this.read()
    if (!s.skills.some(x => x.id === skillId)) return s.installs // 未知技能，no-op
    const targets = agentId === '*' ? AGENTS.map(a => a.id) : [agentId]
    for (const t of targets) {
      const cur = s.installs[t] || []
      if (!cur.includes(skillId)) cur.push(skillId)
      s.installs[t] = cur
    }
    this.write(s)
    return s.installs
  }

  /** agentId 传 '*' = 对所有 agent 卸载（集体卸载）。 */
  uninstall(agentId: string, skillId: string): SkillInstalls {
    const s = this.read()
    const targets = agentId === '*' ? Object.keys(s.installs) : [agentId]
    for (const t of targets) {
      s.installs[t] = (s.installs[t] || []).filter(sid => sid !== skillId)
    }
    this.write(s)
    return s.installs
  }

  /** 目标 agent 已安装的技能（按注册顺序）。 */
  installedFor(agentId: string): SkillDef[] {
    const s = this.read()
    const ids = new Set(s.installs[agentId] || [])
    return s.skills.filter(x => ids.has(x.id))
  }
}

let instance: SkillManager | null = null

export function getSkillManager(): SkillManager {
  if (!instance) instance = new SkillManager()
  return instance
}
