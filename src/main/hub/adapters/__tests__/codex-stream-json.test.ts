import { describe, it, expect } from "vitest"
import { parseCodexStreamJsonLine, codexCommandLabel } from "../codex-stream-json"

describe("parseCodexStreamJsonLine", () => {
  it("ignores empty / lifecycle events", () => {
    expect(parseCodexStreamJsonLine("")).toBeNull()
    expect(parseCodexStreamJsonLine("   ")).toBeNull()
    expect(parseCodexStreamJsonLine(JSON.stringify({ type: "thread.started", thread_id: "t" }))).toBeNull()
    expect(parseCodexStreamJsonLine(JSON.stringify({ type: "turn.started" }))).toBeNull()
    expect(parseCodexStreamJsonLine(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }))).toBeNull()
  })

  it("maps command_execution item.started to a running step", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: {
        id: "item_2",
        type: "command_execution",
        command: "\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command pwd",
        status: "in_progress"
      }
    })
    const step = parseCodexStreamJsonLine(line)!.steps![0]
    expect(step.id).toBe("item_2")
    expect(step.kind).toBe("tool")
    expect(step.tool).toBe("command_execution")
    expect(step.status).toBe("running")
    expect(step.label).toBe("$ powershell.exe -Command pwd")
    expect(step.detail).toContain("-Command pwd")
  })

  it("maps successful command_execution item.completed to done output", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_2",
        type: "command_execution",
        command: "pwd",
        aggregated_output: "C:\\Users\\Admin\\Documents\\安装与卸载\\agenthub\r\n",
        exit_code: 0,
        status: "completed"
      }
    })
    const step = parseCodexStreamJsonLine(line)!.steps![0]
    expect(step.id).toBe("item_2")
    expect(step.status).toBe("done")
    expect(step.output).toContain("agenthub")
    expect(step.label).toBeUndefined()
  })

  it("marks failed command_execution item.completed as error", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_3",
        type: "command_execution",
        command: "exit 1",
        aggregated_output: "boom",
        exit_code: 1,
        status: "completed"
      }
    })
    const step = parseCodexStreamJsonLine(line)!.steps![0]
    expect(step.status).toBe("error")
    expect(step.output).toBe("boom")
  })

  it("extracts final answer from agent_message item.completed", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { id: "item_4", type: "agent_message", text: "Done." }
    })
    expect(parseCodexStreamJsonLine(line)).toEqual({ content: "Done." })
  })

  it("extracts final answer from nested agent_message content shapes", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_4b",
        type: "agent_message",
        content: [{ type: "output_text", text: "Nested " }, { type: "output_text", text: "done." }]
      }
    })
    expect(parseCodexStreamJsonLine(line)).toEqual({ content: "Nested done." })
  })

  it("passes non-JSON lines through as content", () => {
    expect(parseCodexStreamJsonLine("plain text answer")).toEqual({ content: "plain text answer\n" })
  })

  it("truncates long command output", () => {
    const big = "x".repeat(2000)
    const line = JSON.stringify({
      type: "item.completed",
      item: { id: "item_5", type: "command_execution", aggregated_output: big, exit_code: 0 }
    })
    const output = parseCodexStreamJsonLine(line)!.steps![0].output!
    expect(output.length).toBeLessThan(900)
    expect(output.endsWith("…")).toBe(true)
  })
})

describe("codexCommandLabel", () => {
  it("removes common PowerShell executable noise", () => {
    expect(codexCommandLabel("\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command pwd")).toBe("$ powershell.exe -Command pwd")
  })

  it("truncates long commands", () => {
    const label = codexCommandLabel("x".repeat(120))
    expect(label.length).toBeLessThan(80)
    expect(label.endsWith("…")).toBe(true)
  })
})
