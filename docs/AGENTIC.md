# AgentHub Agentic 能力路线图

> 起因：用户反馈"接入的 agent 没有 agentic 能力"。本文件是基于一次全路径审计(10-agent workflow + 人工复审)的诊断与改进计划。最后更新 2026-06-15。配套：[DESIGN.md](./DESIGN.md)。

## 0. 实现现状（0.3.0，2026-06-16 更新）

> 下文第 1~5 节是**实现前**的诊断与路线图，保留作历史。截至 0.3.0，多数已落地，且默认姿态已收紧到"全员对齐"。以当前代码为准：

- **HTTP 原生 agentic 回环：已实现且默认开启。** `agentic/executor.ts` 把 读/写/列文件 + 执行命令 做成工具喂给模型，按 `finishReason==='tool_calls'` 执行工具、回灌 `role:'tool'` 结果、循环（默认上限 8 轮），每步发 `activity` 事件复用步骤卡 UI。
- **三种 provider 线全部支持工具：** openai-compatible / anthropic / gemini 的工具下发与 tool_call 累积/回灌均在 `providers/client.ts` 实现（不再只有 OpenAI 兼容线）。
- **默认姿态（`agentic/config.ts` v2）：** `mode='all'`——所有 HTTP agent 默认具备 agentic，与 codex/claude 对齐；可在「设置 → 技能 → 能力矩阵」整体切「按需」或对个别 agent 关闭。**安全兜底：未绑定工作区时工具回环只读**（禁止写/执行；路径限定工作区内，拒绝 `..`/绝对路径逃逸，见 `agentic/tools.ts`）。
- **stdio 原生 agentic：** codex/claude 走各自 CLI（Codex 使用 `codex exec --sandbox danger-full-access -C .` 的非交互可执行模式；Claude 使用 `claude --print --permission-mode acceptEdits`），stream-json 解析为结构化活动步骤；多行提示词在直接 spawn 路径已保真（`stdio-adapter.ts`）。
- **技能注入：** 全 agent、全路径（HTTP 对话 / HTTP agentic / stdio）统一注入已装技能到系统提示（`skills/inject.ts` + `dispatcher.ts`）。
- **工作区 bootstrap 项目上下文：** 工作区 `bootstrapFiles`（如 CLAUDE.md/AGENTS.md）经 `workspace.ts#bootstrapContext` 读取并注入 prompt（全 agent 通用，带字符上限与越界防护）。
- **thinking 对齐：** HTTP 下发 reasoning 参数；stdio 路径开启 thinking 时以 prompt 指令对齐（`dispatcher.ts`）。

**0.4.0 新增（Item K）：**
- **写/执行审批门禁已落地**：per-agent × per-tool 的 `allow / ask / deny` 策略（默认全 `allow`，零回归）。`ask` 在运行时弹窗逐次审批（dispatcher 发 `approval` 流事件 → 渲染层弹窗 → `agentic:resolveApproval` 回传，超时/取消自动拒绝），`deny` 直接挡下并把拒绝信息回灌模型；只读工具（读/列文件）永不门禁。配置在「设置 → 技能 → 审批策略」。见 `agentic/approval.ts`、`agentic/executor.ts`、`hub/dispatcher.ts`、`glass/approval-dialog.tsx`。
- **proxy 的 Anthropic 入站工具透传已补齐**：`/v1/messages`（Claude Code 接管口）解析入站 `tools`/`tool_choice`、保留 `tool_use`/`tool_result` 多轮结构（转 OpenAI 形状经 client 出站到任意上游），并把上游 tool_calls 回写为 anthropic `tool_use` SSE 块（流式增量 + 上游无增量时 done 阶段兜底补发）。协议编解码已单测；端到端正确性需联机 Claude Code + 支持工具的上游验证。见 `routing/proxy.ts`。

**0.5.0 新增：ACP 统一接入。** 发现 hermes / openclaw / minimax-code(opencode) 都支持 **ACP（Agent Client Protocol，JSON-RPC over stdio 标准）**，故以「一个 ACP 客户端适配器」统一接入，取代 0.3.0 设想的「各写文本活动解析器」：结构化活动（工具 / 文件 / 思考 / 正文）开箱即有，不靠脆弱的文本逆向。落地 `adapters/acp-client.ts`（协议核心 + `mapAcpUpdate` 纯函数映射）、`adapters/acp-adapter.ts`、dispatcher `sendToAgentAcp` 路径、`protocol:'acp'` 全链路、设置→路由的 **ACP** 后端选项与能力矩阵展示。端到端 `initialize`+`session/new` 握手已用真实 `opencode acp` 验证；`session/prompt` 完整对话流走同一套 JSON-RPC，需配好 provider 后联机验证。详见 [DESIGN-0.5.0-acp.md](./DESIGN-0.5.0-acp.md)。

**0.5.1 新增：ACP 权限请求接入审批门禁。** `session/request_permission` 现在会规范化 ACP tool call 权限请求，把写入类请求映射为 `write`、命令类请求映射为 `exec`，并复用 0.4.0 的 per-agent 审批策略（`allow / ask / deny`）。未知或只读请求继续按 ACP allow 选项放行，避免破坏只读/非门禁能力。

**0.5.2 新增：ACP client fs handler。** `initialize` 声明 `fs.readTextFile/writeTextFile`，ACP agent 可通过标准 `fs/read_text_file` / `fs/write_text_file` 访问 AgentHub 当前 session 工作区；路径解析保留在 workspace 内并防符号链接逃逸。直接写文件也走 `write` 审批策略，避免绕过 `request_permission`。

**仍待办：** ACP 的 `session/prompt` 完整联机验证、client terminal handler、server 复用 / 会话记忆（见 [DESIGN-0.5.0-acp.md](./DESIGN-0.5.0-acp.md) §4）。

## 1. 现状诊断（按集成路径，附 file:line 证据）

| 路径 | agentic 程度 | 结论 |
|------|------|------|
| HTTP 派发（5/6 agent 默认走这） | **prompt-only** | 只发**一次** chat completion，**不传任何工具**，丢弃 `finishReason/toolCalls`，无 act-observe 回环。`agent-runtime.ts` 只是用 system prompt 叫模型"像 agent 一样"，**没有任何执行**。 |
| stdio 派发（codex/claude 等） | **真 agentic 但默认关 + 不可见** | `codex exec --sandbox danger-full-access -C .` / `claude --print --permission-mode acceptEdits` 在工作区真读写文件、跑命令；但①codex/claude 默认绑 HTTP，需手动切 stdio；②中间步骤被 `curateAgentReply` 删掉，UI 只剩最终文本。 |
| provider 协议层 | partial | 类型层有 `tools`/`tool_calls` 字段；**仅 OpenAI 兼容线**会发 `body.tools` 并能累积 tool_call delta（`client.ts:93-124`）。Anthropic/Gemini 线**完全丢弃工具**。 |
| 本地代理 proxy | partial | 仅为**外部 CLI 接管**转发工具(外部客户端自己跑回环)；对 AgentHub 自身派发是死代码。Anthropic 入站工具未转发。 |
| UI 呈现 | **none** | `ReplyState` 只有 `{agentId,thinking,text,done,cancelled,error}`，无法表达"工具调用/文件改动/命令"。用户看不到 agent 做了什么。 |

**核心判断**：默认路径(HTTP)的 agent 是"会描述行动、不会行动"的多模型聊天聚合器；真正能行动的 stdio 路径默认关闭且过程不可见。用户的反馈成立。

⚠️ **运行时认证坑**：实测以 AgentHub 的确切调用直接跑 `claude --print --permission-mode acceptEdits` → `Not logged in`。**agentic stdio 绑定要求被 spawn 的 CLI 自身已独立登录**（本会话临时认证不传子进程；hermes 因有自己的 .env 凭据可跑）。

## 2. 策略：两条轨道，共享一层 UI（Phase 0 先做）

- **Track A（先做，低风险、见效快）— 让已经能干活的 stdio 把过程"显出来"**
  codex/claude 本就 agentic，缺的只是 AgentHub 看不到/不展示。把 claude 切到 `--output-format stream-json --verbose`，按行解析 JSON 成结构化步骤(Write/Bash/...)；解析失败软回退到今天的纯文本。无需自建工具执行器。
- **Track B（后做，价值更高、工程更重）— 给 HTTP 自有 agent 加 act-observe 回环（MCP 驱动）**
  仅 OpenAI 兼容线、按绑定开关默认关、工作区作用域、迭代上限、**先只读**。复用已存在的 `CallOptions.tools` 转发 + tool_call 累积。

两条轨道喂**同一套** `ReplyState.steps[]` + 新 `tool/activity` 流事件 + Chat 步骤卡 → **Phase 0 先把这层共享 UI/数据模型建好**。

## 3. 阶段与首个切片

- **Phase 0｜共享 UI/数据模型**：`ReplyState.steps[]`、新结构化流事件、`App.onStream` 路由进 steps、Chat 折叠步骤卡、`curateAgentReply` 在有 steps 时不再删轨迹行。
- **Phase 1｜Track A：claude stream-json**（= **推荐首个切片**，~7 文件、几乎全增量、软回退）：stdio-adapter 加 `activityMode`+行缓冲 JSON 解析+`onActivity`；claude args 切 stream-json + parseLine；dispatcher 透传事件；UI 显示步骤卡。验证：绑 claude 为 stdio，在工作区发"建 hello.txt 并列目录"，看到 Write/Bash 步骤 + 最终答案；故意制造解析错误确认干净回退。
- **Phase 2｜Track A：codex `--json`** + 重校 stdio 完成判定心跳。
- **Phase 3｜Track B：HTTP act-observe 回环（MCP 只读）**：加 `@modelcontextprotocol/sdk`，`McpManager`(单例，按 active workspace 起 filesystem MCP)、`tool-registry`(MCP→OpenAI tool 格式)、`sendToAgent` 内有界回环(messages 改累积数组)。
- **Phase 4｜Track B 加固**：写/shell 工具 + 路径沙箱(复用 workspace rootPath) + 逐次审批 + Settings MCP 配置。
- **Phase 5（推迟）**：Anthropic/Gemini HTTP 工具线 + proxy Anthropic 入站透传(需联机验证，惠及人群少)。

## 4. 已决定的默认（自主定向，可被用户推翻）

1. **轨道顺序**：A 与 B 并行、共享 Phase 0；先落 A 的 claude 垂直切片。
2. **HTTP 工具执行**：用 **MCP**（一次集成解锁 filesystem/shell/web/git 生态，且同一 server 列表后续能喂 stdio CLI 的原生 MCP 配置），而非手写工具表。
3. **写/命令权限姿态**：**默认只读；写/shell 按绑定显式开 + 逐次审批**，工作区外硬拒。安全优先。
4. **codex/claude 默认绑定**：保持 HTTP 默认（不改老用户行为），但在 onboarding/Settings 加"一键开启 agentic（检测到 CLI 则切 stdio + 活动呈现）"。

## 5. 协作分工

- **Claude（UI/方向/审查）**：Phase 0 渲染层(`meta.ts` steps、`App.onStream`、`Chat` 步骤卡、`chat-transcript` guard)、Settings 的 agentic 开关/引导、本路线图与审查。
- **Codex（后端/适配器）**：`stdio-adapter` activityMode+JSON 解析、`claude.ts`/`codex.ts` args、`dispatcher` 事件透传、Track B 的 `mcp-manager`/`tool-registry`/回环。
- **前置**：当前工作树里 agentic 基座（workspace + agentic flags + cwd 透传）**已实现未提交**，建议**先提交成干净基线**再在其上做 Track A，避免多方在制品互相缠绕。
