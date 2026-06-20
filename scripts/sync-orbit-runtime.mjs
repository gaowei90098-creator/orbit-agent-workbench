import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const source = resolve('src/main/orbit-runtime.cjs')
const destination = resolve('out/main/orbit-runtime.cjs')

const requiredMarkers = [
  'EVOMAP_MCP_ENDPOINT',
  'buildEvoMapPlannerContext',
  'gene:evomap-preplanning',
  'Reactor Runtime',
  'mission.plan.revised',
  'DISABLED_AGENT_IDS',
  'targetAgent === "claude-code"',
  'function buildHandoffCapsule'
]

const runtime = readFileSync(source, 'utf8')
const missing = requiredMarkers.filter((marker) => !runtime.includes(marker))

if (missing.length > 0) {
  throw new Error(`[sync-orbit-runtime] runtime missing required markers: ${missing.join(', ')}`)
}

mkdirSync(dirname(destination), { recursive: true })
copyFileSync(source, destination)

const size = statSync(destination).size
console.log(`[sync-orbit-runtime] copied ${source} -> ${destination} (${size} bytes)`)
