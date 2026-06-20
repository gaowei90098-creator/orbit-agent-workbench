/**
 * 本地 Agent CLI 二进制探测 — 多候选版
 *
 * 每个 Agent 收集全部可用安装（桌面版内置 CLI / 终端版 npm/cargo/PATH…），
 * 按路径去重（同一文件只出现一次），按优先级排序；
 * locateXxxBinary() 返回首选项（环境变量 > 桌面版/既有优先级 > PATH），
 * locateAgentCandidates() 给 UI 提供完整列表供用户选择。
 */
import { execSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface AgentBinaryCandidate {
  source: 'desktop' | 'terminal'
  label: string
  path: string
}

function fromPath(cmd: string): string | null {
  try {
    const out = execSync(
      (process.platform === 'win32' ? 'where ' : 'which ') + cmd,
      { timeout: 2000, encoding: 'utf-8', windowsHide: true }
    )
    const first = out.trim().split(/\r?\n/)[0]?.trim()
    return first || null
  } catch {
    return null
  }
}

/** 去重（不区分大小写的路径）+ 过滤不存在的文件 */
function dedupe(cands: Array<AgentBinaryCandidate | null>): AgentBinaryCandidate[] {
  const seen = new Set<string>()
  const out: AgentBinaryCandidate[] = []
  for (const c of cands) {
    if (!c || !c.path) continue
    const key = c.path.toLowerCase()
    if (seen.has(key)) continue
    if (!existsSync(c.path)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

function envCandidate(envVar: string): AgentBinaryCandidate | null {
  const p = process.env[envVar]
  return p ? { source: 'terminal', label: '环境变量 ' + envVar, path: p } : null
}

function npmCandidate(name: string): AgentBinaryCandidate | null {
  const p = process.env.APPDATA ? join(process.env.APPDATA, 'npm', name + '.cmd') : ''
  return p ? { source: 'terminal', label: '终端版 (npm)', path: p } : null
}

function pathCandidate(name: string): AgentBinaryCandidate | null {
  const p = fromPath(name)
  return p ? { source: 'terminal', label: '终端版 (PATH)', path: p } : null
}

/* ---------------- Codex ---------------- */

export function codexCandidates(): AgentBinaryCandidate[] {
  const cands: Array<AgentBinaryCandidate | null> = [envCandidate('CODEX_PATH')]

  // 桌面版：config.toml 中写入的 CODEX_CLI_PATH（权威）
  try {
    const toml = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf-8')
    const m = toml.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/)
    if (m) cands.push({ source: 'desktop', label: '桌面版 (OpenAI Codex)', path: m[1] })
  } catch { /* noop */ }

  // 桌面版安装目录扫描（多个 hash 目录取最新）
  try {
    const bin = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin')
    if (existsSync(bin)) {
      const newest = readdirSync(bin)
        .map(d => join(bin, d, 'codex.exe'))
        .filter(p => existsSync(p))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
      if (newest) cands.push({ source: 'desktop', label: '桌面版 (安装目录)', path: newest })
    }
  } catch { /* noop */ }

  cands.push({ source: 'desktop', label: '桌面版 (Codex.app)', path: '/Applications/Codex.app/Contents/Resources/codex' })
  cands.push({ source: 'terminal', label: '终端版 (cargo)', path: join(homedir(), '.cargo', 'bin', 'codex.exe') })
  cands.push({ source: 'terminal', label: '终端版 (cargo)', path: join(homedir(), '.cargo', 'bin', 'codex') })
  cands.push(npmCandidate('codex'))
  cands.push(pathCandidate('codex'))
  return dedupe(cands)
}

export function locateCodexBinary(): string | null {
  return codexCandidates()[0]?.path ?? null
}

/* ---------------- Claude Code ---------------- */

/** 在 ~/.claude 的常见安装子目录里两层扫描 claude*.exe（取最新版本） */
function scanClaudeHome(): string | null {
  const home = join(homedir(), '.claude')
  if (!existsSync(home)) return null
  const hits: string[] = []
  const isClaudeExe = (f: string) => /^claude[\w.-]*\.(exe|cmd)$/i.test(f)
  for (const sub of ['local', 'bin', 'downloads', 'versions', 'dist', 'app', 'cli']) {
    const lvl1 = join(home, sub)
    if (!existsSync(lvl1)) continue
    try {
      for (const e of readdirSync(lvl1, { withFileTypes: true })) {
        const p = join(lvl1, e.name)
        if (e.isFile() && isClaudeExe(e.name)) hits.push(p)
        else if (e.isDirectory()) {
          try {
            for (const f of readdirSync(p)) {
              if (isClaudeExe(f)) hits.push(join(p, f))
            }
          } catch { /* noop */ }
        }
      }
    } catch { /* noop */ }
  }
  if (hits.length === 0) return null
  return hits.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

/**
 * 扫描 Claude Code 桌面版自带 CLI（GUI 客户端会把可用的 `claude.exe` 解到这两处，
 * 按版本号建子目录，自动更新时会多版本共存）：
 *   %APPDATA%\Claude\claude-code\<ver>\claude.exe   （Roaming，通常最新）
 *   %LOCALAPPDATA%\Claude-3p\claude-code\<ver>\claude.exe
 * 多版本按 mtime 取最新在前；返回全部供 UI 选择。
 */
function scanClaudeCodeApp(): AgentBinaryCandidate[] {
  const roots = [
    process.env.APPDATA ? join(process.env.APPDATA, 'Claude', 'claude-code') : '',
    join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Claude-3p', 'claude-code')
  ].filter(Boolean)
  const hits: string[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    try {
      for (const ver of readdirSync(root)) {
        const exe = join(root, ver, 'claude.exe')
        if (existsSync(exe)) hits.push(exe)
      }
    } catch { /* noop */ }
  }
  return hits
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .map((p): AgentBinaryCandidate => ({ source: 'desktop', label: '桌面版 (Claude Code)', path: p }))
}

export function claudeCandidates(): AgentBinaryCandidate[] {
  const local = scanClaudeHome()
  return dedupe([
    envCandidate('CLAUDE_PATH'),
    ...scanClaudeCodeApp(),
    npmCandidate('claude'),
    { source: 'terminal', label: '终端版 (本地安装器)', path: join(homedir(), '.local', 'bin', 'claude.exe') },
    { source: 'terminal', label: '终端版 (本地安装器)', path: join(homedir(), '.local', 'bin', 'claude') },
    local ? { source: 'desktop', label: '本地安装版 (~/.claude)', path: local } : null,
    pathCandidate('claude')
  ])
}

export function locateClaudeBinary(): string | null {
  return claudeCandidates()[0]?.path ?? null
}

/* ---------------- 通用收集器 ---------------- */

function genericCandidates(envVar: string, names: string[], programDirs: string[]): AgentBinaryCandidate[] {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  const cands: Array<AgentBinaryCandidate | null> = [envCandidate(envVar)]
  for (const d of programDirs) {
    for (const n of names) {
      cands.push({ source: 'desktop', label: '桌面版 (' + d + ')', path: join(local, 'Programs', d, n + '.exe') })
      cands.push({ source: 'desktop', label: '桌面版 (' + d + ')', path: join(local, d, n + '.exe') })
      cands.push({ source: 'desktop', label: '桌面版 (' + d + ')', path: join(local, d, 'bin', n + '.exe') })
    }
  }
  for (const n of names) {
    cands.push(npmCandidate(n))
    cands.push({ source: 'terminal', label: '终端版', path: join(homedir(), '.local', 'bin', n + '.exe') })
    cands.push({ source: 'terminal', label: '终端版', path: join(homedir(), '.local', 'bin', n) })
    cands.push({ source: 'terminal', label: '终端版 (cargo)', path: join(homedir(), '.cargo', 'bin', n + '.exe') })
  }
  for (const n of names) {
    cands.push(pathCandidate(n))
  }
  return dedupe(cands)
}

/* ---------------- Hermes / OpenClaw ---------------- */

export function hermesCandidates(): AgentBinaryCandidate[] {
  return genericCandidates('HERMES_PATH', ['hermes'], ['Hermes'])
}

export function locateHermesBinary(): string | null {
  return hermesCandidates()[0]?.path ?? null
}

export function openclawCandidates(): AgentBinaryCandidate[] {
  return genericCandidates('OPENCLAW_PATH', ['openclaw', 'clawd'], ['OpenClaw', 'Clawd on Desk', 'Clawd'])
}

export function locateOpenclawBinary(): string | null {
  return openclawCandidates()[0]?.path ?? null
}

/* ---------------- MiniMax Code ---------------- */

export function minimaxCodeCandidates(): AgentBinaryCandidate[] {
  return dedupe([
    envCandidate('MINIMAX_CODE_PATH'),
    { source: 'desktop', label: '桌面版内置 (opencode)', path: 'D:\\minimax\\MiniMax Code\\resources\\resources\\opencode\\opencode.exe' },
    {
      source: 'desktop', label: '桌面版内置 (opencode)',
      path: join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'MiniMax Code', 'resources', 'resources', 'opencode', 'opencode.exe')
    },
    pathCandidate('opencode')
  ])
}

export function locateMinimaxCodeBinary(): string | null {
  return minimaxCodeCandidates()[0]?.path ?? null
}

/* ---------------- Marvis（暂无 CLI） ---------------- */

export function marvisCandidates(): AgentBinaryCandidate[] {
  // Marvis 桌面版（MarvisAgent.exe）没有公开的非交互 CLI：直接 spawn 只会拉起 GUI、
  // 永不退出，把任务卡到 5 分钟超时。因此不再自动探测/暴露其 GUI 二进制，避免 UI
  // 选择器把用户诱导到“必然卡死”的配置。Marvis 默认走 HTTP 绑定（腾讯混元）。
  // 仅当用户显式设置 MARVIS_PATH（声明自己拥有可用 CLI）时才作为候选；用户也可随时
  // 在 设置→路由→StdIO 手动填写路径与参数直连。
  return dedupe([envCandidate('MARVIS_PATH')])
}

export function locateMarvisBinary(): string | null {
  return marvisCandidates()[0]?.path ?? null
}

/* ---------------- 汇总（agents:locate IPC） ---------------- */

export function locateAgentCandidates(): Record<string, AgentBinaryCandidate[]> {
  return {
    codex: codexCandidates(),
    claude: claudeCandidates(),
    hermes: hermesCandidates(),
    openclaw: openclawCandidates(),
    marvis: marvisCandidates(),
    'minimax-code': minimaxCodeCandidates()
  }
}
