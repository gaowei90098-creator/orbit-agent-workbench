/* ============================================================
   Claude Code `--output-format stream-json --verbose` NDJSON 解析器
   把每行 JSON 事件解析成 AgentHub 的「活动步骤 / 最终内容」。
   纯函数、无 I/O，便于单测；stdio-adapter 按行喂入。

   契约（与渲染层 ActivityStep + dispatcher activity 事件对齐）：
   - 返回 { steps }  → 工具调用/结果，UI 按 step.id upsert（先 running 后补 done+output）
   - 返回 { content }→ 最终答案文本（写入 chat 气泡）；非 JSON 行原样透传（兼容自定义非 stream-json 参数，零回归）
   - 返回 null       → 该行无需呈现（system/init 等）
   ============================================================ */

export interface ActivityStepLike {
  id: string
  kind?: 'tool' | 'thinking' | 'text' | 'note'
  tool?: string
  label?: string
  detail?: string
  output?: string
  status: 'running' | 'done' | 'error'
}

export interface ParsedActivity {
  steps?: ActivityStepLike[]
  content?: string
}

function basename(p: string): string {
  if (!p) return ''
  const parts = String(p).split(/[\\/]/)
  return parts[parts.length - 1] || String(p)
}

function oneLine(s: unknown, max: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function truncate(s: unknown, max: number): string {
  const t = String(s ?? '')
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** tool_result.content 可能是 string 或 [{type:'text',text}] 数组 */
function stringifyToolResult(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(x => (typeof x === 'string' ? x : ((x as any)?.text ?? ''))).join('\n').trim()
  if (c == null) return ''
  try { return JSON.stringify(c) } catch { return String(c) }
}

/** 工具调用一行标题：工具名 + 最关键的目标（文件名/命令/查询） */
export function claudeToolLabel(name: string, input: any): string {
  const n = name || 'tool'
  const i = input && typeof input === 'object' ? input : {}
  switch (n) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `${n} · ${basename(i.file_path || i.path || i.notebook_path || '')}`.trim()
    case 'Read':
      return `Read · ${basename(i.file_path || i.path || '')}`.trim()
    case 'Bash':
      return `$ ${oneLine(i.command, 64)}`
    case 'Grep':
      return `Grep · ${oneLine(i.pattern, 44)}`
    case 'Glob':
      return `Glob · ${oneLine(i.pattern, 44)}`
    case 'WebFetch':
      return `WebFetch · ${oneLine(i.url, 52)}`
    case 'WebSearch':
      return `WebSearch · ${oneLine(i.query, 52)}`
    case 'Task':
      return `Task · ${oneLine(i.description || i.subagent_type, 44)}`
    default: {
      const firstStr = Object.values(i).find(v => typeof v === 'string') as string | undefined
      return firstStr ? `${n} · ${oneLine(firstStr, 52)}` : n
    }
  }
}

/** 工具调用展开后的明细：命令全文 / 写入内容预览 / edit diff / 路径等 */
export function claudeToolDetail(name: string, input: any): string | undefined {
  const i = input && typeof input === 'object' ? input : {}
  switch (name) {
    case 'Bash':
      return i.command ? truncate(i.command, 400) : undefined
    case 'Write':
      return typeof i.content === 'string' ? truncate(i.content, 360) : undefined
    case 'Edit':
    case 'MultiEdit':
      return (i.old_string || i.new_string)
        ? truncate(`- ${i.old_string ?? ''}\n+ ${i.new_string ?? ''}`, 360)
        : undefined
    default: {
      const v = i.file_path || i.path || i.pattern || i.url || i.query
      return v ? String(v) : undefined
    }
  }
}

export function parseClaudeStreamJsonLine(line: string): ParsedActivity | null {
  const trimmed = (line ?? '').trim()
  if (!trimmed) return null

  let obj: any
  try {
    obj = JSON.parse(trimmed)
  } catch {
    // 非 JSON 行：自定义了非 stream-json 参数时，原样作为内容透传（保留换行）
    return { content: line.endsWith('\n') ? line : line + '\n' }
  }
  if (!obj || typeof obj !== 'object') return { content: line + '\n' }

  switch (obj.type) {
    case 'system':
      return null // init / 工具清单等，无需呈现

    case 'assistant': {
      const blocks = obj.message?.content
      if (!Array.isArray(blocks)) return null
      const steps: ActivityStepLike[] = []
      for (const b of blocks) {
        if (b?.type === 'tool_use' && b.id) {
          steps.push({
            id: String(b.id),
            kind: 'tool',
            tool: b.name,
            label: claudeToolLabel(b.name, b.input),
            detail: claudeToolDetail(b.name, b.input),
            status: 'running'
          })
        }
      }
      return steps.length ? { steps } : null
    }

    case 'user': {
      const blocks = obj.message?.content
      if (!Array.isArray(blocks)) return null
      const steps: ActivityStepLike[] = []
      for (const b of blocks) {
        if (b?.type === 'tool_result' && b.tool_use_id) {
          // 仅补 status/output（不带 label/tool）→ upsert 合并保留 running 时的标题
          steps.push({
            id: String(b.tool_use_id),
            status: b.is_error ? 'error' : 'done',
            output: truncate(stringifyToolResult(b.content), 800) || undefined
          })
        }
      }
      return steps.length ? { steps } : null
    }

    case 'result': {
      const text = typeof obj.result === 'string'
        ? obj.result
        : (typeof obj.error === 'string' ? obj.error : '')
      return { content: text }
    }

    default:
      return null
  }
}
