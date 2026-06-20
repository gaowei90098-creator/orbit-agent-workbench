import { describe, it, expect } from "vitest"
import { parseClaudeStreamJsonLine, claudeToolLabel, claudeToolDetail } from "../claude-stream-json"

describe("parseClaudeStreamJsonLine", () => {
  it("ignores empty / system(init) lines", () => {
    expect(parseClaudeStreamJsonLine("")).toBeNull()
    expect(parseClaudeStreamJsonLine("   ")).toBeNull()
    expect(parseClaudeStreamJsonLine(JSON.stringify({ type: "system", subtype: "init", tools: ["Bash"] }))).toBeNull()
  })

  it("maps assistant tool_use → running step with label + detail", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: "/proj/src/hello.txt", content: "hi there" } }] }
    })
    const r = parseClaudeStreamJsonLine(line)
    expect(r?.steps).toHaveLength(1)
    const s = r!.steps![0]
    expect(s.id).toBe("toolu_1")
    expect(s.kind).toBe("tool")
    expect(s.tool).toBe("Write")
    expect(s.status).toBe("running")
    expect(s.label).toBe("Write · hello.txt")
    expect(s.detail).toBe("hi there")
  })

  it("emits one step per tool_use in a multi-tool assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll do two things." },
          { type: "tool_use", id: "a", name: "Read", input: { file_path: "x.ts" } },
          { type: "tool_use", id: "b", name: "Bash", input: { command: "npm test" } }
        ]
      }
    })
    const r = parseClaudeStreamJsonLine(line)
    expect(r?.steps?.map(s => s.id)).toEqual(["a", "b"])
    expect(r?.steps?.[1].label).toBe("$ npm test")
  })

  it("ignores assistant messages with only text (no tools)", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "just talking" }] } })
    expect(parseClaudeStreamJsonLine(line)).toBeNull()
  })

  it("maps user tool_result → done step with output, no label (so merge keeps title)", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "File written", is_error: false }] }
    })
    const r = parseClaudeStreamJsonLine(line)
    expect(r?.steps).toHaveLength(1)
    const s = r!.steps![0]
    expect(s.id).toBe("toolu_1")
    expect(s.status).toBe("done")
    expect(s.output).toBe("File written")
    expect(s.label).toBeUndefined()
    expect(s.tool).toBeUndefined()
  })

  it("marks tool_result error and stringifies array content", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: [{ type: "text", text: "boom" }] }] }
    })
    const s = parseClaudeStreamJsonLine(line)!.steps![0]
    expect(s.status).toBe("error")
    expect(s.output).toBe("boom")
  })

  it("extracts final answer text from result event", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Done. Created hello.txt." })
    expect(parseClaudeStreamJsonLine(line)).toEqual({ content: "Done. Created hello.txt." })
  })

  it("falls back to error text on is_error result without result text", () => {
    const line = JSON.stringify({ type: "result", subtype: "error", is_error: true, error: "max turns reached" })
    expect(parseClaudeStreamJsonLine(line)).toEqual({ content: "max turns reached" })
  })

  it("passes non-JSON lines through as content (custom non-stream-json args, zero regression)", () => {
    expect(parseClaudeStreamJsonLine("plain text answer")).toEqual({ content: "plain text answer\n" })
  })

  it("truncates long tool output", () => {
    const big = "x".repeat(2000)
    const line = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: big }] } })
    const out = parseClaudeStreamJsonLine(line)!.steps![0].output!
    expect(out.length).toBeLessThan(900)
    expect(out.endsWith("…")).toBe(true)
  })
})

describe("claudeToolLabel / claudeToolDetail", () => {
  it("labels common tools by their salient target", () => {
    expect(claudeToolLabel("Read", { file_path: "/a/b/c.ts" })).toBe("Read · c.ts")
    expect(claudeToolLabel("Grep", { pattern: "TODO" })).toBe("Grep · TODO")
    expect(claudeToolLabel("WebSearch", { query: "claude api" })).toBe("WebSearch · claude api")
  })

  it("falls back to tool name + first string arg for unknown tools", () => {
    expect(claudeToolLabel("CustomTool", { foo: "bar" })).toBe("CustomTool · bar")
    expect(claudeToolLabel("Empty", {})).toBe("Empty")
  })

  it("detail returns full command for Bash and diff for Edit", () => {
    expect(claudeToolDetail("Bash", { command: "ls -la" })).toBe("ls -la")
    expect(claudeToolDetail("Edit", { old_string: "a", new_string: "b" })).toBe("- a\n+ b")
  })
})
