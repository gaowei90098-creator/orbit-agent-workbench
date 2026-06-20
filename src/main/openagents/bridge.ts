import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export interface OpenAgentsBridgeOptions {
  projectRoot?: string
  configDir?: string
  endpoint?: string
  launcherBin?: string
  nodeBin?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export interface OpenAgentsLauncherCandidate {
  kind: 'configured-js' | 'configured-command' | 'local-reference' | 'path-command'
  command: string
  argsPrefix: string[]
  label: string
  packagePath?: string
  packageVersion?: string
  cwd?: string
}

export interface OpenAgentsCommandResult {
  command: string
  args: string[]
  exitCode: number
  stdout: string
  stderr: string
}

export interface OpenAgentsCompatibilityReport {
  compatible: boolean
  selected?: OpenAgentsLauncherCandidate
  candidates: OpenAgentsLauncherCandidate[]
  checks: Array<{ name: string; ok: boolean; detail: string }>
  warnings: string[]
  configDir: string
  endpoint: string
  supportedCommands: string[]
}

const REFERENCE_LAUNCHER_RELATIVE = join(
  'reference_repos',
  'collaboration-frameworks',
  'openagents',
  'packages',
  'agent-connector',
  'bin',
  'agent-connector.js'
)

const SUPPORTED_COMMANDS = [
  'help',
  'version',
  'status',
  'list',
  'runtimes',
  'search',
  'workspace',
  'create',
  'remove',
  'start',
  'stop',
  'up',
  'down',
  'connect',
  'disconnect',
  'env',
  'skills',
  'tool-mode',
  'logs',
  'mcp-server'
]

export function defaultOpenAgentsConfigDir(userDataRoot: string): string {
  return join(userDataRoot, 'openagents')
}

export function discoverOpenAgentsLaunchers(options: OpenAgentsBridgeOptions = {}): OpenAgentsLauncherCandidate[] {
  const env = options.env || process.env
  const nodeBin = options.nodeBin || env.OPENAGENTS_NODE_BIN || 'node'
  const candidates: OpenAgentsLauncherCandidate[] = []
  const configured = options.launcherBin || env.OPENAGENTS_LAUNCHER_BIN

  if (configured) {
    const resolved = resolve(configured)
    if (configured.endsWith('.js')) {
      candidates.push({
        kind: 'configured-js',
        command: nodeBin,
        argsPrefix: [resolved],
        label: `configured js launcher (${resolved})`,
        packagePath: findNearestPackageJson(resolved),
        packageVersion: packageVersion(findNearestPackageJson(resolved)),
        cwd: dirname(resolved)
      })
    } else {
      candidates.push({
        kind: 'configured-command',
        command: existsSync(resolved) ? resolved : configured,
        argsPrefix: [],
        label: `configured command (${configured})`
      })
    }
  }

  const reference = findReferenceLauncher(options.projectRoot, env)
  if (reference) {
    candidates.push({
      kind: 'local-reference',
      command: nodeBin,
      argsPrefix: [reference],
      label: `local reference (${reference})`,
      packagePath: findNearestPackageJson(reference),
      packageVersion: packageVersion(findNearestPackageJson(reference)),
      cwd: dirname(reference)
    })
  }

  candidates.push({
    kind: 'path-command',
    command: 'agn',
    argsPrefix: [],
    label: 'agn from PATH'
  })

  return dedupeCandidates(candidates)
}

export function selectOpenAgentsLauncher(options: OpenAgentsBridgeOptions = {}): OpenAgentsLauncherCandidate | null {
  return discoverOpenAgentsLaunchers(options)[0] || null
}

export async function runOpenAgentsLauncher(
  args: string[],
  options: OpenAgentsBridgeOptions = {}
): Promise<OpenAgentsCommandResult> {
  const selected = selectOpenAgentsLauncher(options)
  if (!selected) throw new Error('No OpenAgents launcher candidate found')
  const configDir = options.configDir || defaultOpenAgentsConfigDir(join(homedir(), 'Library', 'Application Support', 'agenthub'))
  const fullArgs = [...selected.argsPrefix, ...args]
  if (!hasFlag(fullArgs, '--config')) fullArgs.push('--config', configDir)

  const env = {
    ...process.env,
    ...(options.env || {}),
    OPENAGENTS_SKIP_UPDATE_CHECK: '1'
  }
  if (options.endpoint) env.OPENAGENTS_ENDPOINT = options.endpoint

  const result = await execFileText(selected.command, fullArgs, {
    cwd: selected.cwd,
    env,
    timeout: options.timeoutMs || 10_000
  })
  return {
    command: selected.command,
    args: fullArgs,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

export async function checkOpenAgentsCompatibility(options: OpenAgentsBridgeOptions = {}): Promise<OpenAgentsCompatibilityReport> {
  const env = options.env || process.env
  const configDir = options.configDir || defaultOpenAgentsConfigDir(join(homedir(), 'Library', 'Application Support', 'agenthub'))
  const endpoint = options.endpoint || env.OPENAGENTS_ENDPOINT || 'https://workspace-endpoint.openagents.org'
  const candidates = discoverOpenAgentsLaunchers({ ...options, env })
  const selected = candidates[0]
  const checks: OpenAgentsCompatibilityReport['checks'] = []
  const warnings: string[] = []

  const nodeCheck = await checkNode(options.nodeBin || env.OPENAGENTS_NODE_BIN || 'node', env)
  checks.push(nodeCheck)

  checks.push({
    name: 'launcher.discovered',
    ok: !!selected,
    detail: selected ? selected.label : 'No OpenAgents launcher was found'
  })

  checks.push({
    name: 'config.isolated',
    ok: normalizePath(configDir) !== normalizePath(join(homedir(), '.openagents')),
    detail: configDir
  })

  if (selected?.kind === 'path-command') {
    warnings.push('Using agn from PATH. This is compatible, but not pinned to the cloned OpenAgents commit.')
  }
  if (selected?.packageVersion) {
    checks.push({
      name: 'launcher.version.package',
      ok: true,
      detail: selected.packageVersion
    })
  }

  let commandCheck: { ok: boolean; detail: string } = { ok: false, detail: 'not run' }
  if (selected) {
    try {
      const version = await runOpenAgentsLauncher(['version'], {
        ...options,
        env,
        configDir,
        endpoint,
        timeoutMs: options.timeoutMs || 10_000
      })
      commandCheck = {
        ok: version.exitCode === 0 && /openagents|agent-launcher|@openagents-org/i.test(version.stdout),
        detail: (version.stdout || version.stderr).trim() || `exit ${version.exitCode}`
      }
    } catch (e: any) {
      commandCheck = { ok: false, detail: e?.message || String(e) }
    }
  }
  checks.push({ name: 'launcher.responds', ...commandCheck })

  const compatible = checks.every(check => check.ok)
  return {
    compatible,
    selected: compatible ? selected : selected,
    candidates,
    checks,
    warnings,
    configDir,
    endpoint,
    supportedCommands: SUPPORTED_COMMANDS.slice()
  }
}

function findReferenceLauncher(projectRoot?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const starts = [
    projectRoot,
    env.AGENTFORGE_PROJECT_ROOT,
    process.cwd(),
    __dirname
  ].filter((value): value is string => !!value)

  for (const start of starts) {
    for (const root of walkUp(resolve(start), 8)) {
      const candidate = join(root, REFERENCE_LAUNCHER_RELATIVE)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function walkUp(start: string, limit: number): string[] {
  const out: string[] = []
  let current = start
  for (let i = 0; i < limit; i++) {
    out.push(current)
    const next = dirname(current)
    if (next === current) break
    current = next
  }
  return out
}

function findNearestPackageJson(filePath: string): string | undefined {
  for (const root of walkUp(dirname(filePath), 8)) {
    const candidate = join(root, 'package.json')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function packageVersion(packagePath?: string): string | undefined {
  if (!packagePath) return undefined
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8'))
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

function dedupeCandidates(candidates: OpenAgentsLauncherCandidate[]): OpenAgentsLauncherCandidate[] {
  const seen = new Set<string>()
  return candidates.filter(candidate => {
    const key = [candidate.command, ...candidate.argsPrefix].join('\0')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag) || args.some(arg => arg.startsWith(flag + '='))
}

function normalizePath(input: string): string {
  return resolve(input).replace(/\/+$/, '')
}

async function checkNode(command: string, env: NodeJS.ProcessEnv): Promise<{ name: string; ok: boolean; detail: string }> {
  try {
    const result = await execFileText(command, ['--version'], { env, timeout: 5_000 })
    const version = (result.stdout || result.stderr).trim().replace(/^v/, '')
    const major = Number(version.split('.')[0])
    return {
      name: 'node.version',
      ok: Number.isFinite(major) && major >= 18,
      detail: version || `exit ${result.exitCode}`
    }
  } catch (e: any) {
    return { name: 'node.version', ok: false, detail: e?.message || String(e) }
  }
}

function execFileText(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      windowsHide: true
    }, (error: any, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === 'number' ? error.code : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || error?.message || '')
      })
    })
  })
}
