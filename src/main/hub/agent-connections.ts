import { AgentRouteBinding } from "../providers/types"
import { AgentRegistry } from "./registry"
import { createAdapter } from "./adapters/base"
import { agentCaps, agentName } from "./agents"

const ROUTING_MANAGED = "__agentHubRoutingManaged"
const ROUTING_SIG = "__agentHubRoutingSig"

export function parseStdioArgs(argsStr?: string): string[] | undefined {
  const input = (argsStr || "").trim()
  if (!input) return undefined

  const args: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaping = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (escaping) {
      current += ch
      escaping = false
      continue
    }
    if (ch === "\\" && quote === '"') {
      const next = input[i + 1]
      if (next === '"' || next === "\\") {
        escaping = true
        continue
      }
    }
    if ((ch === "'" || ch === '"') && !quote) {
      quote = ch
      continue
    }
    if (quote === ch) {
      quote = null
      continue
    }
    if (!quote && /\s/.test(ch)) {
      if (current) {
        args.push(current)
        current = ""
      }
      continue
    }
    current += ch
  }

  if (escaping) current += "\\"
  if (current) args.push(current)
  return args
}

function signature(binding: AgentRouteBinding): string {
  return [
    binding.protocol || "http",
    (binding.binary || "").trim(),
    (binding.args || "").trim()
  ].join("|")
}

export function syncRegistryFromBindings(registry: AgentRegistry, bindings: AgentRouteBinding[]): void {
  const desired = new Set(bindings.map(b => b.agentId))

  for (const info of registry.getAll()) {
    if ((info.adapter as any)[ROUTING_MANAGED] && !desired.has(info.id)) {
      info.adapter.stop().catch(() => {})
      registry.unregister(info.id)
    }
  }

  for (const binding of bindings) {
    const existing = registry.get(binding.agentId)
    const sig = signature(binding)

    if (existing && (
      (existing.adapter as any).protocol !== (binding.protocol || "http") ||
      (existing.adapter as any)[ROUTING_SIG] !== sig
    )) {
      existing.adapter.stop().catch(() => {})
      registry.unregister(binding.agentId)
    }

    const fresh = registry.get(binding.agentId)
    if (!fresh) {
      const adapter = createAdapter(
        binding.agentId,
        agentName(binding.agentId),
        binding.protocol as any,
        binding.binary,
        parseStdioArgs(binding.args)
      )
      ;(adapter as any)[ROUTING_MANAGED] = true
      ;(adapter as any)[ROUTING_SIG] = sig
      registry.register(adapter, agentCaps(binding.agentId), binding.providerId, binding.modelId)
    } else {
      fresh.providerId = binding.providerId
      fresh.modelId = binding.modelId
    }
  }
}
