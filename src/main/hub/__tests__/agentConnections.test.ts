import { describe, expect, it, vi } from "vitest"
import { AgentRegistry } from "../registry"
import { parseStdioArgs, syncRegistryFromBindings } from "../agent-connections"

const thinking = { mode: "auto" as const, level: "medium" as const, collapseInUI: true }

describe("agent connection helpers", () => {
  it("parses stdio args without splitting quoted paths", () => {
    expect(parseStdioArgs('run --cwd "C:\\Users\\Admin\\My Project" --flag {prompt}')).toEqual([
      "run",
      "--cwd",
      "C:\\Users\\Admin\\My Project",
      "--flag",
      "{prompt}"
    ])
  })

  it("syncs routing bindings into registry and removes stale routed agents", () => {
    const registry = new AgentRegistry()
    syncRegistryFromBindings(registry, [{
      agentId: "codex",
      providerId: "openai",
      modelId: "gpt-4o",
      protocol: "http",
      thinkingAllow: ["off", "auto"],
      thinking
    }])

    expect(registry.get("codex")?.protocol).toBe("http")

    syncRegistryFromBindings(registry, [{
      agentId: "codex",
      providerId: "openai",
      modelId: "gpt-4o",
      protocol: "stdio-plain",
      binary: "C:\\Tools\\codex.cmd",
      args: 'exec --cd "C:\\Users\\Admin\\My Project" -',
      thinkingAllow: ["off", "auto"],
      thinking
    }])

    const codex = registry.get("codex")
    expect(codex?.protocol).toBe("stdio-plain")
    expect((codex?.adapter as any).binary).toBe("C:\\Tools\\codex.cmd")
    expect((codex?.adapter as any).execArgs).toEqual([
      "exec",
      "--cd",
      "C:\\Users\\Admin\\My Project",
      "-"
    ])

    const stop = vi.spyOn(codex!.adapter, "stop").mockResolvedValue()
    syncRegistryFromBindings(registry, [])
    expect(stop).toHaveBeenCalled()
    expect(registry.get("codex")).toBeUndefined()
  })
})
