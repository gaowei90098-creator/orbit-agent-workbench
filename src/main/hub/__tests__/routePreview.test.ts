import { describe, expect, it } from "vitest"
import { AgentRegistry } from "../registry"
import { HttpAgentAdapter } from "../adapters/base"
import { routePreview } from "../route-preview"

describe("routePreview", () => {
  it("returns sorted route scores for registered agents", () => {
    const registry = new AgentRegistry()
    registry.register(new HttpAgentAdapter("codex", "Codex"), ["coding"])
    registry.register(new HttpAgentAdapter("claude", "Claude"), ["analysis"])

    expect(routePreview("请分析这个 bug 并修复代码", registry)).toEqual([
      expect.objectContaining({ id: "codex" }),
      expect.objectContaining({ id: "claude" })
    ])
    expect(routePreview("请分析这个 bug 并修复代码", registry)[0].score)
      .toBeGreaterThanOrEqual(routePreview("请分析这个 bug 并修复代码", registry)[1].score)
  })
})
