/**
 * AgentHub 工作区（Workspace）— 独立实体
 *
 * 与 AgentRouteBinding 解耦：工作区是项目级别（一个项目可被多个 agent 共享），
 * 而非 agent 级别。spawn 本地 CLI 时按目标 agent 对应的"当前工作区"取 cwd。
 *
 * 不变量（Codex 接手时勿破坏）：
 *   - 落盘 key: `workspaces.v1`，形状 { version: 1, workspaces: Workspace[], activeId: string | null }
 *   - 路径校验：create/update 时 resolveSync + statSync，必须存在且是目录，否则抛 WorkspacePathInvalidError
 *   - 单例：getInstance()
 *   - 删/重命名/路径改动时不动 activeId；若被删的是 active，主动让 UI 重新选择（getActive 返回 null）
 */
import { statSync, readFileSync } from 'fs'
import { resolve as resolvePath, join as joinPath, relative as relativePath, isAbsolute } from 'path'
import { store } from '../store'

/** bootstrap 项目上下文注入上限（字符数），与 skills inject 的上限思路一致，防 token 爆炸。 */
export const BOOTSTRAP_CONTEXT_MAX_CHARS = 16000

export interface Workspace {
  id: string
  name: string
  /** 绝对路径；CLI spawn 时的 cwd */
  rootPath: string
  /** 任务级注入：相对 rootPath 的文件列表，拼到 prompt 前作为项目级上下文（CLAUDE.md / AGENTS.md 等） */
  bootstrapFiles?: string[]
  createdAt: number
  updatedAt: number
}

interface PersistedShape {
  version: 1
  workspaces: Workspace[]
  activeId: string | null
}

const STORAGE_KEY = 'workspaces.v1'

export class WorkspaceNotFoundError extends Error {
  readonly code = 'WORKSPACE_NOT_FOUND'
  constructor(id: string) { super(`Workspace not found: ${id}`); this.name = 'WorkspaceNotFoundError' }
}

export class WorkspacePathInvalidError extends Error {
  readonly code = 'WORKSPACE_PATH_INVALID'
  constructor(rootPath: string, reason: string) { super(`Invalid workspace path "${rootPath}": ${reason}`); this.name = 'WorkspacePathInvalidError' }
}

function load(): PersistedShape {
  try {
    const raw = store.get(STORAGE_KEY)
    if (raw && typeof raw === 'object' && Array.isArray((raw as any).workspaces)) {
      return {
        version: 1,
        workspaces: (raw as any).workspaces.filter((w: any) => w && typeof w.id === 'string' && typeof w.rootPath === 'string'),
        activeId: typeof (raw as any).activeId === 'string' ? (raw as any).activeId : null
      }
    }
  } catch { /* fall through to default */ }
  return { version: 1, workspaces: [], activeId: null }
}

function validateRootPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') throw new WorkspacePathInvalidError(String(rawPath), '路径为空')
  const abs = resolvePath(rawPath)
  let st
  try { st = statSync(abs) } catch { throw new WorkspacePathInvalidError(abs, '路径不存在或不可访问') }
  if (!st.isDirectory()) throw new WorkspacePathInvalidError(abs, '不是目录')
  return abs
}

class WorkspaceManager {
  // 懒加载：模块 import 时不读 store；首次访问才读。
  // 避免 `import getWorkspaceManager` 触发 `store.init()` 早于 `app.whenReady`。
  private _state: PersistedShape | null = null
  private get state(): PersistedShape {
    if (!this._state) this._state = load()
    return this._state
  }
  private save(): void {
    try { store.set(STORAGE_KEY, this._state) } catch (e) {
      // 落盘失败（如磁盘满、权限拒绝）不阻断 UX：内存态已生效，下次 store 写时会覆盖。
      // 注意：进程退出时未落盘的更改会丢失，但能避免一次写失败导致整个 dispatch 链路炸掉。
      console.warn('[WorkspaceManager] save failed:', e)
    }
  }

  list(): Workspace[] { return [...this.state.workspaces].sort((a, b) => b.updatedAt - a.updatedAt) }

  getById(id: string): Workspace | undefined { return this.state.workspaces.find(w => w.id === id) }

  create(input: { name: string; rootPath: string }): Workspace {
    const name = (input.name || '').trim()
    if (!name) throw new Error('工作区名称不能为空')
    const rootPath = validateRootPath(input.rootPath)
    const now = Date.now()
    const ws: Workspace = { id: 'ws-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6), name, rootPath, bootstrapFiles: [], createdAt: now, updatedAt: now }
    this.state.workspaces.push(ws)
    // 第一个工作区自动设为活动
    if (!this.state.activeId) this.state.activeId = ws.id
    this.save()
    return ws
  }

  update(id: string, patch: { name?: string; rootPath?: string; bootstrapFiles?: string[] }): Workspace {
    const ws = this.state.workspaces.find(w => w.id === id)
    if (!ws) throw new WorkspaceNotFoundError(id)
    if (patch.name !== undefined) {
      const n = (patch.name || '').trim()
      if (!n) throw new Error('工作区名称不能为空')
      ws.name = n
    }
    if (patch.rootPath !== undefined) ws.rootPath = validateRootPath(patch.rootPath)
    if (patch.bootstrapFiles !== undefined) ws.bootstrapFiles = patch.bootstrapFiles
    ws.updatedAt = Date.now()
    this.save()
    return ws
  }

  remove(id: string): boolean {
    const before = this.state.workspaces.length
    this.state.workspaces = this.state.workspaces.filter(w => w.id !== id)
    if (before === this.state.workspaces.length) return false
    if (this.state.activeId === id) {
      // 删了活动工作区 → 自动选最新的另一个，避免 UI 突然无活动
      this.state.activeId = this.state.workspaces.length > 0 ? this.state.workspaces[0].id : null
    }
    this.save()
    return true
  }

  /**
   * 读取工作区的 bootstrapFiles，拼成可注入 prompt 的「项目上下文」块。
   * - 路径限定在 rootPath 内（拒绝绝对路径 / `..` 逃逸），逐个 readFileSync(utf-8)；
   * - 总字符超 maxChars 即停止并标注省略数；缺失/不可读的文件跳过并标注。
   * - 无工作区 / 无 bootstrapFiles / 全部读取失败 → 返回空串（不注入，零回归）。
   */
  bootstrapContext(id: string | null | undefined, maxChars = BOOTSTRAP_CONTEXT_MAX_CHARS): string {
    if (!id) return ''
    const ws = this.getById(id)
    if (!ws || !Array.isArray(ws.bootstrapFiles) || ws.bootstrapFiles.length === 0) return ''
    const root = resolvePath(ws.rootPath)
    const blocks: string[] = []
    let used = 0
    let omitted = 0
    for (const rel of ws.bootstrapFiles) {
      if (typeof rel !== 'string' || !rel.trim()) continue
      if (isAbsolute(rel)) { omitted++; continue }
      const abs = resolvePath(joinPath(root, rel))
      const within = abs === root || abs.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))
      if (!within) { omitted++; continue }            // 拒绝 `..` 逃逸
      let text: string
      try { text = readFileSync(abs, 'utf-8') } catch { omitted++; continue }
      const relLabel = relativePath(root, abs).replace(/\\/g, '/')
      const body = `## ${relLabel}\n${text.trim()}`
      if (used + body.length > maxChars && blocks.length > 0) { omitted++; continue }
      blocks.push(body)
      used += body.length
    }
    if (blocks.length === 0) return ''
    if (omitted > 0) blocks.push(`(${omitted} more bootstrap file(s) omitted: missing, out-of-root, or over length limit.)`)
    return [
      '# Project context (workspace bootstrap files)',
      'These files come from the active workspace. Follow their conventions and instructions.',
      '',
      blocks.join('\n\n')
    ].join('\n').trim()
  }

  getActive(): string | null { return this.state.activeId }
  setActive(id: string | null): void {
    if (id !== null && !this.state.workspaces.find(w => w.id === id)) throw new WorkspaceNotFoundError(id)
    this.state.activeId = id
    this.save()
  }
}

let _instance: WorkspaceManager | null = null
export function getWorkspaceManager(): WorkspaceManager {
  if (!_instance) _instance = new WorkspaceManager()
  return _instance
}
