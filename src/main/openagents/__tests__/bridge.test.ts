import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkOpenAgentsCompatibility,
  defaultOpenAgentsConfigDir,
  discoverOpenAgentsLaunchers,
  runOpenAgentsLauncher
} from '../bridge'

let dirs: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentforge-openagents-'))
  dirs.push(dir)
  return dir
}

function makeFakeReference(root: string): string {
  const pkgDir = join(root, 'reference_repos', 'collaboration-frameworks', 'openagents', 'packages', 'agent-connector')
  const binDir = join(pkgDir, 'bin')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: '@openagents-org/agent-launcher',
    version: '0.2.143'
  }, null, 2))
  const bin = join(binDir, 'agent-connector.js')
  writeFileSync(bin, `
const args = process.argv.slice(2)
const cmd = args[0]
if (cmd === 'version') {
  console.log('@openagents-org/agent-launcher v0.2.143')
} else if (cmd === 'status') {
  const configIndex = args.indexOf('--config')
  console.log('Daemon is not running')
  console.log('CONFIG=' + (configIndex >= 0 ? args[configIndex + 1] : 'missing'))
  console.log('ENDPOINT=' + (process.env.OPENAGENTS_ENDPOINT || 'missing'))
} else {
  console.log('cmd=' + cmd)
}
`)
  chmodSync(bin, 0o755)
  return bin
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('OpenAgents bridge compatibility', () => {
  it('discovers the categorized local reference launcher before PATH fallback', () => {
    const root = tempRoot()
    const bin = makeFakeReference(root)

    const candidates = discoverOpenAgentsLaunchers({
      projectRoot: root,
      nodeBin: process.execPath,
      env: {}
    })

    expect(candidates[0]).toMatchObject({
      kind: 'local-reference',
      command: process.execPath,
      argsPrefix: [bin],
      packageVersion: '0.2.143'
    })
    expect(candidates.some(candidate => candidate.kind === 'path-command')).toBe(true)
  })

  it('runs launcher commands with isolated config and endpoint env', async () => {
    const root = tempRoot()
    makeFakeReference(root)
    const configDir = defaultOpenAgentsConfigDir(join(root, 'userData'))

    const result = await runOpenAgentsLauncher(['status'], {
      projectRoot: root,
      configDir,
      endpoint: 'http://127.0.0.1:4999',
      nodeBin: process.execPath,
      env: {},
      timeoutMs: 5000
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('CONFIG=' + configDir)
    expect(result.stdout).toContain('ENDPOINT=http://127.0.0.1:4999')
    expect(result.args).toContain('--config')
  })

  it('reports compatibility without using the default ~/.openagents config dir', async () => {
    const root = tempRoot()
    makeFakeReference(root)
    const configDir = defaultOpenAgentsConfigDir(join(root, 'userData'))

    const report = await checkOpenAgentsCompatibility({
      projectRoot: root,
      configDir,
      nodeBin: process.execPath,
      env: {},
      timeoutMs: 5000
    })

    expect(report.compatible).toBe(true)
    expect(report.selected?.kind).toBe('local-reference')
    expect(report.configDir).toBe(configDir)
    expect(report.checks.find(check => check.name === 'config.isolated')?.ok).toBe(true)
    expect(report.supportedCommands).toContain('mcp-server')
  })
})
