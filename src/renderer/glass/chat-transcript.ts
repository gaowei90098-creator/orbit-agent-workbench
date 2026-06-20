import type { ActivityStep, ReplyState } from "./meta"
import type { OrchestrateState, OrchestrateSubtask } from "./orchestrate-view"

export type TranscriptReply = Pick<ReplyState, "agentId" | "thinking" | "text" | "done" | "cancelled" | "error" | "steps">

/** 纯函数：把一条 ActivityStep 按 id 合并进已有 steps（不可变）。
    已存在则浅合并（仅覆盖传入的非 undefined 字段，便于先 running 后补 done+output）；
    不存在则追加，保持到达顺序。 */
export function upsertStep(steps: ActivityStep[] | undefined, step: ActivityStep | undefined): ActivityStep[] {
  const list = steps ? steps.slice() : []
  if (!step || !step.id) return list
  const idx = list.findIndex(s => s.id === step.id)
  if (idx < 0) {
    list.push({ ...step })
    return list
  }
  const merged = { ...list[idx] }
  for (const k of Object.keys(step) as Array<keyof ActivityStep>) {
    const v = step[k]
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v
  }
  list[idx] = merged
  return list
}

const NOISE_LINE_RE =
  /^(starting|started|connecting|connected|loading|initializing|initialized|thinking|reasoning|processing|running|dispatching|routing|calling|using tool|tool call|准备|启动|连接|正在思考|思考中|分析中|处理中|执行中|开始执行|路由|调用工具|分解任务|汇总中)(\b|[：:.\s])/i

export function curateAgentReply(text: string): string {
  const withoutThinkingBlocks = String(text || "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")

  const lines = withoutThinkingBlocks
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)

  const useful = lines.filter(line => !NOISE_LINE_RE.test(line.trim()))
  return (useful.length ? useful : lines).join("\n").trim()
}

export function visibleSequentialReplies<T extends TranscriptReply>(replies: T[]): T[] {
  const visible: T[] = []
  for (const reply of replies) {
    visible.push(reply)
    if (!reply.done) break
  }
  return visible
}

function subtaskReply(subtask: OrchestrateSubtask): TranscriptReply {
  return {
    agentId: subtask.agentId || "orchestrate",
    thinking: subtask.status === "running" || subtask.status === "pending" ? subtask.detail || subtask.title : "",
    text: subtask.status === "error"
      ? subtask.verdict?.note || subtask.content || subtask.title
      : curateAgentReply(subtask.content || ""),
    done: subtask.status === "done" || subtask.status === "error",
    error: subtask.status === "error" ? (subtask.verdict?.note || subtask.content || subtask.title) : undefined
  }
}

export function orchestrationReplies(state: OrchestrateState): TranscriptReply[] {
  if (state.error) {
    return [{ agentId: state.leadAgentId || "orchestrate", thinking: "", text: "", done: true, error: state.error }]
  }

  const subtasks = visibleSequentialReplies(state.subtasks.map(subtaskReply))

  if (state.final) {
    return [
      ...subtasks,
      {
        agentId: state.leadAgentId || "orchestrate",
        thinking: "",
        text: curateAgentReply(state.final),
        done: true
      }
    ]
  }

  if (subtasks.length > 0) return subtasks

  return [{
    agentId: state.leadAgentId || "orchestrate",
    thinking: state.phase === "synthesizing" ? "synthesizing" : "planning",
    text: "",
    done: false
  }]
}
