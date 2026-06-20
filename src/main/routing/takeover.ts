/**
 * 桌面版 Agent 供应商实时接管（对标 CC Switch「应用级接管」）
 *
 * 原理：把 CLI/桌面应用的 live 配置改写为指向 AgentHub 本地代理，
 * 模型用 "provider/model" 引用 —— 之后在 AgentHub 里换绑定/换厂商即「实时」生效，
 * 无需再碰应用配置（代理侧按模型引用路由 + 故障转移）。
 *
 *   Codex（桌面版/CLI 共用 ~/.codex/config.toml）：
 *     model_provider = "agenthub" / model = "<ref>" + [model_providers.agenthub] 指向代理
 *   Claude Code（~/.claude/settings.json）：
 *     env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL / ANTHROPIC_SMALL_FAST_MODEL
 *
 * 安全措施：
 *   - 首次接管前把原文件备份为 <file>.agenthub-bak
 *   - 原值存入 electron store（takeover.<app>.stash），恢复时精确还原（含"原本不存在"的键）
 *   - 临时文件 + rename 原子写入
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { store, encryptSecret, decryptSecret } from '../store'

const SECTION = '[model_providers.agenthub]'

export interface TakeoverState {
  supported: boolean
  configPath: string
  configExists: boolean
  takenOver: boolean
  /** 当前生效模型（接管时为 provider/model 引用） */
  model: string | null
  /** 未接管时当前的供应商描述 */
  current: string | null
}

function codexConfigPath(): string { return join(homedir(), '.codex', 'config.toml') }
function claudeSettingsPath(): string { return join(homedir(), '.claude', 'settings.json') }
function hermesConfigPath(): string { return join(homedir(), '.hermes', 'config.yaml') }
function openclawConfigPath(): string { return join(homedir(), '.openclaw', 'openclaw.json') }

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.agenthub-tmp'
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, path)
}

function backupOnce(path: string): void {
  if (existsSync(path) && !existsSync(path + '.agenthub-bak')) {
    try { copyFileSync(path, path + '.agenthub-bak') } catch { /* noop */ }
  }
}

/* ---------------- TOML 顶层键与 agenthub 节的外科手术式编辑 ---------------- */

/** 返回 [prelude(首个 section 之前), rest] */
function splitPrelude(toml: string): [string, string] {
  const m = toml.match(/^\s*\[/m)
  if (!m || m.index === undefined) return [toml, '']
  return [toml.slice(0, m.index), toml.slice(m.index)]
}

function getTopKey(toml: string, key: string): string | null {
  const [prelude] = splitPrelude(toml)
  const m = prelude.match(new RegExp('^\\s*' + key + '\\s*=\\s*(.+)$', 'm'))
  if (!m) return null
  return m[1].trim().replace(/^["']|["']$/g, '')
}

/** value 为 null 时删除该键 */
function setTopKey(toml: string, key: string, value: string | null): string {
  let [prelude, rest] = splitPrelude(toml)
  const re = new RegExp('^\\s*' + key + '\\s*=.*\\r?\\n?', 'm')
  if (value === null) {
    prelude = prelude.replace(re, '')
  } else {
    const line = key + ' = "' + value + '"'
    if (re.test(prelude)) prelude = prelude.replace(re, line + '\n')
    else prelude = line + '\n' + prelude
  }
  return prelude + rest
}

function removeAgenthubSection(toml: string): string {
  const lines = toml.split(/\r?\n/)
  const start = lines.findIndex(l => l.trim() === SECTION)
  if (start < 0) return toml
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) { end = i; break }
  }
  lines.splice(start, end - start)
  return lines.join('\n')
}

function agenthubSection(proxyOpenAIUrl: string): string {
  return [
    SECTION,
    'name = "AgentHub Proxy"',
    'base_url = "' + proxyOpenAIUrl + '"',
    'wire_api = "chat"',
    ''
  ].join('\n')
}

/* ---------------- Codex ---------------- */

export function codexStatus(): TakeoverState {
  const path = codexConfigPath()
  const exists = existsSync(path)
  let takenOver = false
  let model: string | null = null
  let current: string | null = null
  if (exists) {
    try {
      const toml = readFileSync(path, 'utf-8')
      const mp = getTopKey(toml, 'model_provider')
      model = getTopKey(toml, 'model')
      takenOver = mp === 'agenthub'
      current = mp
    } catch { /* noop */ }
  }
  return { supported: true, configPath: path, configExists: exists, takenOver, model, current }
}

export function codexApply(modelRef: string, proxyOpenAIUrl: string): TakeoverState {
  const path = codexConfigPath()
  let toml = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  backupOnce(path)
  // 首次接管：暂存原值
  if (getTopKey(toml, 'model_provider') !== 'agenthub' && !store.get('takeover.codex.stash')) {
    store.set('takeover.codex.stash', {
      model_provider: getTopKey(toml, 'model_provider'),
      model: getTopKey(toml, 'model')
    })
  }
  toml = removeAgenthubSection(toml)
  toml = setTopKey(toml, 'model_provider', 'agenthub')
  toml = setTopKey(toml, 'model', modelRef)
  if (!toml.endsWith('\n')) toml += '\n'
  toml += '\n' + agenthubSection(proxyOpenAIUrl)
  atomicWrite(path, toml)
  return codexStatus()
}

export function codexRestore(): TakeoverState {
  const path = codexConfigPath()
  if (existsSync(path)) {
    let toml = readFileSync(path, 'utf-8')
    const stash = (store.get('takeover.codex.stash') || {}) as { model_provider?: string | null; model?: string | null }
    toml = removeAgenthubSection(toml)
    toml = setTopKey(toml, 'model_provider', stash.model_provider ?? null)
    toml = setTopKey(toml, 'model', stash.model ?? null)
    atomicWrite(path, toml)
  }
  store.set('takeover.codex.stash', null)
  return codexStatus()
}

/* ---------------- Claude Code ---------------- */

const CLAUDE_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL'] as const

export function claudeStatus(): TakeoverState {
  const path = claudeSettingsPath()
  const exists = existsSync(path)
  let takenOver = false
  let model: string | null = null
  let current: string | null = null
  if (exists) {
    try {
      const j = JSON.parse(readFileSync(path, 'utf-8'))
      const env = j?.env || {}
      takenOver = typeof env.ANTHROPIC_BASE_URL === 'string' && env.ANTHROPIC_BASE_URL.includes('127.0.0.1')
      model = env.ANTHROPIC_MODEL || null
      current = env.ANTHROPIC_BASE_URL || '官方登录'
    } catch { /* noop */ }
  } else {
    current = '官方登录'
  }
  return { supported: true, configPath: path, configExists: exists, takenOver, model, current }
}

export function claudeApply(modelRef: string, proxyOrigin: string): TakeoverState {
  const path = claudeSettingsPath()
  let j: any = {}
  if (existsSync(path)) {
    try { j = JSON.parse(readFileSync(path, 'utf-8')) } catch { j = {} }
  }
  backupOnce(path)
  const env = j.env || {}
  if (env.ANTHROPIC_BASE_URL !== proxyOrigin && !store.get('takeover.claude.stash')) {
    const stash: Record<string, string | null> = {}
    for (const k of CLAUDE_KEYS) stash[k] = typeof env[k] === 'string' ? env[k] : null
    // 原 ANTHROPIC_AUTH_TOKEN 是用户密钥，加密后再存入 electron store
    if (typeof stash.ANTHROPIC_AUTH_TOKEN === 'string') stash.ANTHROPIC_AUTH_TOKEN = encryptSecret(stash.ANTHROPIC_AUTH_TOKEN)
    store.set('takeover.claude.stash', stash)
  }
  j.env = {
    ...env,
    ANTHROPIC_BASE_URL: proxyOrigin,
    ANTHROPIC_AUTH_TOKEN: 'agenthub',
    ANTHROPIC_MODEL: modelRef,
    ANTHROPIC_SMALL_FAST_MODEL: modelRef
  }
  atomicWrite(path, JSON.stringify(j, null, 2) + '\n')
  return claudeStatus()
}

export function claudeRestore(): TakeoverState {
  const path = claudeSettingsPath()
  if (existsSync(path)) {
    let j: any = {}
    try { j = JSON.parse(readFileSync(path, 'utf-8')) } catch { j = {} }
    const env = j.env || {}
    const stash = (store.get('takeover.claude.stash') || {}) as Record<string, string | null>
    for (const k of CLAUDE_KEYS) {
      let orig = stash[k]
      // AUTH_TOKEN 落盘时已加密，还原前解密（旧明文 stash 经 decryptSecret 原样返回，兼容）
      if (k === 'ANTHROPIC_AUTH_TOKEN' && typeof orig === 'string') orig = decryptSecret(orig)
      if (orig == null) delete env[k]
      else env[k] = orig
    }
    if (Object.keys(env).length === 0) delete j.env
    else j.env = env
    atomicWrite(path, JSON.stringify(j, null, 2) + '\n')
  }
  store.set('takeover.claude.stash', null)
  return claudeStatus()
}

/* ---------------- OpenClaw（~/.openclaw/openclaw.json） ----------------
 * models.providers.<key> = { baseUrl, apiKey, api, models[] }
 * agents.defaults.model.primary = "<providerKey>/<modelId>"
 * 模型 id 中的 "/" 用 ":" 代替（代理侧接受 provider:model 别名）。 */

export function openclawStatus(): TakeoverState {
  const path = openclawConfigPath()
  const exists = existsSync(path)
  let takenOver = false
  let model: string | null = null
  let current: string | null = null
  if (exists) {
    try {
      const j = JSON.parse(readFileSync(path, 'utf-8'))
      const primary = j?.agents?.defaults?.model?.primary
      current = primary || null
      if (typeof primary === 'string' && primary.startsWith('agenthub/')) {
        takenOver = true
        model = primary.slice('agenthub/'.length).replace(':', '/')
      }
    } catch { /* noop */ }
  }
  return { supported: true, configPath: path, configExists: exists, takenOver, model, current }
}

export function openclawApply(modelRef: string, proxyOpenAIUrl: string): TakeoverState {
  const path = openclawConfigPath()
  let j: any = {}
  if (existsSync(path)) {
    try { j = JSON.parse(readFileSync(path, 'utf-8')) } catch { j = {} }
  }
  backupOnce(path)
  const aliasId = modelRef.replace('/', ':')
  j.models = j.models || {}
  j.models.providers = j.models.providers || {}
  j.models.providers.agenthub = {
    baseUrl: proxyOpenAIUrl,
    apiKey: 'agenthub',
    api: 'openai-completions',
    models: [{ id: aliasId, name: 'AgentHub ' + modelRef }]
  }
  j.agents = j.agents || {}
  j.agents.defaults = j.agents.defaults || {}
  j.agents.defaults.model = j.agents.defaults.model || {}
  const primary = j.agents.defaults.model.primary
  if ((typeof primary !== 'string' || !primary.startsWith('agenthub/')) && !store.get('takeover.openclaw.stash')) {
    store.set('takeover.openclaw.stash', { primary: typeof primary === 'string' ? primary : null })
  }
  j.agents.defaults.model.primary = 'agenthub/' + aliasId
  atomicWrite(path, JSON.stringify(j, null, 2) + '\n')
  return openclawStatus()
}

export function openclawRestore(): TakeoverState {
  const path = openclawConfigPath()
  if (existsSync(path)) {
    let j: any = {}
    try { j = JSON.parse(readFileSync(path, 'utf-8')) } catch { j = {} }
    if (j?.models?.providers?.agenthub) delete j.models.providers.agenthub
    const stash = (store.get('takeover.openclaw.stash') || {}) as { primary?: string | null }
    if (j?.agents?.defaults?.model) {
      if (stash.primary) j.agents.defaults.model.primary = stash.primary
      else delete j.agents.defaults.model.primary
    }
    atomicWrite(path, JSON.stringify(j, null, 2) + '\n')
  }
  store.set('takeover.openclaw.stash', null)
  return openclawStatus()
}

/* ---------------- Hermes（~/.hermes/config.yaml） ----------------
 * custom_providers: 列表（- name: xxx / base_url / api_key / api_mode / models / model）
 * 顶层 model: { default, provider }
 * 用行级外科手术编辑，不依赖 YAML 库，保持文件其余部分原样。 */

function hermesFindBlockEnd(lines: string[], startIdx: number): number {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() !== '' && !/^[ \t-]/.test(l)) return i
  }
  return lines.length
}

/** 删除 custom_providers 里的 agenthub 项（若有） */
function hermesRemoveAgenthub(text: string): string {
  const lines = text.split(/\r?\n/)
  const cp = lines.findIndex(l => /^custom_providers:\s*$/.test(l))
  if (cp < 0) return text
  const end = hermesFindBlockEnd(lines, cp)
  let s = -1
  for (let i = cp + 1; i < end; i++) {
    if (/^-\s+name:\s*['"]?agenthub['"]?\s*$/.test(lines[i])) { s = i; break }
  }
  if (s < 0) return text
  let e = end
  for (let i = s + 1; i < end; i++) {
    if (/^-\s/.test(lines[i])) { e = i; break }
  }
  lines.splice(s, e - s)
  return lines.join('\n')
}

/** 顶层 model 既可能是块形式（model:\n  default: …）也可能是单行（model: xxx / model: {…}） */
function hermesModelSpan(lines: string[]): { start: number; end: number } | null {
  const m = lines.findIndex(l => /^model:(\s|$)/.test(l))
  if (m < 0) return null
  const inline = /^model:\s*\S/.test(lines[m])
  return { start: m, end: inline ? m + 1 : hermesFindBlockEnd(lines, m) }
}

function hermesGetModelBlock(text: string): string | null {
  const lines = text.split(/\r?\n/)
  const span = hermesModelSpan(lines)
  if (!span) return null
  return lines.slice(span.start, span.end).join('\n')
}

function hermesSetModelBlock(text: string, block: string | null): string {
  const lines = text.split(/\r?\n/)
  const span = hermesModelSpan(lines)
  const blockLines = block ? block.split('\n') : []
  if (span) {
    lines.splice(span.start, span.end - span.start, ...blockLines)
  } else if (block) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push(...blockLines)
  }
  let out = lines.join('\n')
  if (!out.endsWith('\n')) out += '\n'
  return out
}

function hermesProviderItem(modelRef: string, proxyOpenAIUrl: string): string {
  return [
    '- name: agenthub',
    '  base_url: ' + proxyOpenAIUrl,
    '  api_key: agenthub',
    '  api_mode: chat_completions',
    '  models:',
    '    ' + modelRef + ':',
    '      name: "AgentHub ' + modelRef + '"',
    '  model: ' + modelRef
  ].join('\n')
}

export function hermesStatus(): TakeoverState {
  const path = hermesConfigPath()
  const exists = existsSync(path)
  let takenOver = false
  let model: string | null = null
  let current: string | null = null
  if (exists) {
    try {
      const block = hermesGetModelBlock(readFileSync(path, 'utf-8'))
      if (block) {
        const prov = block.match(/^\s+provider:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1] ?? null
        model = block.match(/^\s+default:\s*['"]?(\S+)['"]?\s*$/m)?.[1] ?? null
        takenOver = prov === 'agenthub'
        current = prov
      }
    } catch { /* noop */ }
  }
  return { supported: true, configPath: path, configExists: exists, takenOver, model, current }
}

export function hermesApply(modelRef: string, proxyOpenAIUrl: string): TakeoverState {
  const path = hermesConfigPath()
  let text = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  backupOnce(path)
  // 首次接管：暂存原顶层 model 块
  const st = hermesStatus()
  if (!st.takenOver && !store.get('takeover.hermes.stash')) {
    store.set('takeover.hermes.stash', { modelBlock: hermesGetModelBlock(text) })
  }
  text = hermesRemoveAgenthub(text)
  const lines = text.split(/\r?\n/)
  const cp = lines.findIndex(l => /^custom_providers:\s*$/.test(l))
  const item = hermesProviderItem(modelRef, proxyOpenAIUrl)
  if (cp >= 0) {
    lines.splice(cp + 1, 0, ...item.split('\n'))
  } else {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push('custom_providers:', ...item.split('\n'))
  }
  text = hermesSetModelBlock(lines.join('\n'), 'model:\n  default: ' + modelRef + '\n  provider: agenthub')
  atomicWrite(path, text)
  return hermesStatus()
}

export function hermesRestore(): TakeoverState {
  const path = hermesConfigPath()
  if (existsSync(path)) {
    let text = readFileSync(path, 'utf-8')
    text = hermesRemoveAgenthub(text)
    const stash = (store.get('takeover.hermes.stash') || {}) as { modelBlock?: string | null }
    text = hermesSetModelBlock(text, stash.modelBlock ?? null)
    atomicWrite(path, text)
  }
  store.set('takeover.hermes.stash', null)
  return hermesStatus()
}

/* ---------------- 汇总 ---------------- */

export function takeoverStatus(): Record<string, TakeoverState> {
  return { codex: codexStatus(), claude: claudeStatus(), hermes: hermesStatus(), openclaw: openclawStatus() }
}

export function takeoverApply(app: string, modelRef: string, proxyOpenAIUrl: string, proxyOrigin: string): TakeoverState {
  if (app === 'codex') return codexApply(modelRef, proxyOpenAIUrl)
  if (app === 'claude') return claudeApply(modelRef, proxyOrigin)
  if (app === 'hermes') return hermesApply(modelRef, proxyOpenAIUrl)
  if (app === 'openclaw') return openclawApply(modelRef, proxyOpenAIUrl)
  throw new Error('takeover not supported for ' + app)
}

export function takeoverRestore(app: string): TakeoverState {
  if (app === 'codex') return codexRestore()
  if (app === 'claude') return claudeRestore()
  if (app === 'hermes') return hermesRestore()
  if (app === 'openclaw') return openclawRestore()
  throw new Error('takeover not supported for ' + app)
}
