import { describe, expect, it } from "vitest"
import {
  curateAgentReply,
  visibleSequentialReplies,
  orchestrationReplies,
  upsertStep
} from "./chat-transcript"
import type { ActivityStep, ReplyState } from "./meta"
import type { OrchestrateState } from "./orchestrate-view"

const reply = (patch: Partial<ReplyState>): ReplyState => ({
  agentId: "codex",
  thinking: "",
  text: "",
  done: false,
  ...patch
})

describe("chat transcript helpers", () => {
  it("filters startup and thinking noise while keeping useful results", () => {
    const raw = [
      "Starting Codex CLI...",
      "Connecting to provider...",
      "Thinking through the task...",
      "结果：已修复 Chat 消息布局。",
      "- 新增串行显示",
      "- 隐藏思考正文"
    ].join("\n")

    expect(curateAgentReply(raw)).toBe([
      "结果：已修复 Chat 消息布局。",
      "- 新增串行显示",
      "- 隐藏思考正文"
    ].join("\n"))
  })

  it("shows one agent reply at a time until the current one finishes", () => {
    const replies = [
      reply({ agentId: "codex", text: "第一条已完成", done: true }),
      reply({ agentId: "claude", thinking: "分析中", done: false }),
      reply({ agentId: "hermes", text: "不应提前显示", done: false })
    ]

    expect(visibleSequentialReplies(replies).map(r => r.agentId)).toEqual(["codex", "claude"])
  })

  it("reveals the next agent after the previous unfinished reply completes", () => {
    const replies = [
      reply({ agentId: "codex", text: "第一条已完成", done: true }),
      reply({ agentId: "claude", text: "第二条已完成", done: true }),
      reply({ agentId: "hermes", thinking: "处理中", done: false })
    ]

    expect(visibleSequentialReplies(replies).map(r => r.agentId)).toEqual(["codex", "claude", "hermes"])
  })

  it("turns orchestration state into sequential agent replies with only final work output", () => {
    const state: OrchestrateState = {
      phase: "running",
      subtasks: [
        { id: "a", title: "分析", agentId: "claude", status: "done", content: "Thinking...\n结论：采用微信式气泡。" },
        { id: "b", title: "实现", agentId: "codex", status: "running", content: "" },
        { id: "c", title: "复核", agentId: "hermes", status: "pending", content: "不应提前显示" }
      ]
    }

    const turns = orchestrationReplies(state)
    expect(turns.map(t => t.agentId)).toEqual(["claude", "codex"])
    expect(turns[0].text).toBe("结论：采用微信式气泡。")
    expect(turns[1].done).toBe(false)
  })
})

const step = (patch: Partial<ActivityStep> & Pick<ActivityStep, "id">): ActivityStep => ({
  kind: "tool",
  label: patch.id,
  status: "running",
  ...patch
})

describe("upsertStep", () => {
  it("appends a new step preserving arrival order", () => {
    const a = upsertStep(undefined, step({ id: "1", label: "Read foo.ts" }))
    const b = upsertStep(a, step({ id: "2", label: "Write bar.ts" }))
    expect(b.map(s => s.id)).toEqual(["1", "2"])
    expect(b).not.toBe(a) // immutable
  })

  it("merges by id, only overwriting provided fields (running -> done + output)", () => {
    const running = upsertStep(undefined, step({ id: "t1", tool: "Bash", label: "Bash · ls", status: "running" }))
    const done = upsertStep(running, { id: "t1", kind: "tool", label: "Bash · ls", status: "done", output: "a.ts\nb.ts" })
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ id: "t1", tool: "Bash", status: "done", output: "a.ts\nb.ts" })
  })

  it("does not mutate the input array and ignores steps without an id", () => {
    const orig = upsertStep(undefined, step({ id: "x" }))
    const same = upsertStep(orig, undefined as unknown as ActivityStep)
    expect(same).toEqual(orig)
    expect(same).not.toBe(orig)
  })
})
