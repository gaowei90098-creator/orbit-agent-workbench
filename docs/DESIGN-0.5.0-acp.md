# AgentHub 0.5.0 设计方案 — ACP（Agent Client Protocol）统一接入

> 目标版本：`0.4.0 → 0.5.0`（较大功能版本）。
> 状态：✅ 已实现（本工作树） ｜ ⏳ 后续 ｜ 配套：[AGENTIC.md](./AGENTIC.md)、[DESIGN-0.3.0-capability-parity.md](./DESIGN-0.3.0-capability-parity.md)。

---

## 1. 背景

0.3.0 的 Item K 把「为 openclaw/hermes/minimax-code 各写 stdio 文本活动解析器」列为后续（需各自真实输出样本、盲写易错）。0.5.0 prep 期对三者做运行时探查，发现**三者都支持 ACP（Agent Client Protocol，Zed 推的 JSON-RPC over stdio 标准）**：`hermes acp` / `openclaw acp` / `opencode acp`（minimax-code = opencode）。

ACP 把工具调用、文件改动、思考、正文都表达为**结构化消息**，因此「写一个 ACP 客户端适配器统一接入三者」是比各写文本解析器**更优**的路线：结构化活动开箱即有、一套适配器接三个 agent、不靠脆弱的文本逆向。

## 2. 设计

### 2.1 协议核心 ✅ `adapters/acp-client.ts`
- `AcpClient`：一个 ACP server 子进程的 JSON-RPC 2.0 客户端（NDJSON，按行收发）。
- 生命周期：`start()`=spawn server + `initialize` 握手 → `newSession(cwd)`=`session/new` → `prompt(sessionId, text, handlers)`=`session/prompt`，期间消费 `session/update` 通知，直到响应里的 `stopReason`；`cancel()`=`session/cancel`。
- 收到 `session/request_permission` → 0.5.1 起把 ACP 权限请求桥接到 0.4.0 审批门禁：写入类映射 `write`，命令类映射 `exec`，按 per-agent 策略 `allow / ask / deny` 处理；未知或只读请求保持自动放行。0.5.2 起声明并处理 `fs/read_text_file` / `fs/write_text_file`，由 AgentHub 在工作区内读写；直接写文件同样走 `write` 审批策略。terminal 能力暂不声明。
- `mapAcpUpdate()`（纯函数，单测）：`session/update.update` → AgentHub 活动模型（`agent_message_chunk`=正文 / `agent_thought_chunk`=思考 / `tool_call`+`tool_call_update`=结构化步骤卡），复用既有 ActivityStep 形状。

### 2.2 适配器 ✅ `adapters/acp-adapter.ts`
- `AcpAgentAdapter`：实现 `AgentAdapter` 接口（`protocol:'acp'`），用 `AcpClient` 提供 `runPrompt(text, cwd, handlers)`。
- `acpDefaults(agentId)`：各 agent 的 acp 启动默认（binary 自动探测 + 子命令参数）—— opencode `acp` / hermes `acp --accept-hooks` / openclaw `acp`。
- 第一阶段每轮结束 `stop()` 杀 server（无状态泄漏）；server 复用 + 会话记忆为后续优化。

### 2.3 派发链路 ✅ `hub/dispatcher.ts`
- 新增 `sendToAgentAcp`：与 stdio 路径平级。`protocol==='acp'` 时走它。
- 完成判定靠 `session/prompt` 的 `stopReason`（不像 stdio oneshot 靠进程退出）；`session/update` 经 handlers 透传为 `delta`(content/thinking) + `activity` 步骤事件；取消轮询 `task.status` 发 `session/cancel`。
- prompt 构建与 stdio 一致：技能注入 + 工作区 bootstrap + 用户任务（+ 可选 thinking 指令）；工作区 rootPath → `session/new` 的 cwd。

### 2.4 类型 / 工厂 / 配置 / UI ✅
- `protocol` 联合类型加 `'acp'`（AgentAdapter / AgentInfo / AgentRouteBinding / 渲染层 BindingDef）。
- `createAdapter` 加 acp 分支 → `AcpAgentAdapter`。
- 能力矩阵：acp 展示为 `ACP` 后端 + 全能力（fs/exec/agentic-loop，原生 agentic）。
- 设置 → 路由：后端协议 Seg 新增 **ACP** 选项（仅对 hermes/openclaw/minimax-code 可选），复用「使用版本 / 附加参数」配置区。

## 3. 验证

- 单测：`acp-client.test.ts` 覆盖 `mapAcpUpdate` / `acpBlockText` / `acpToolContent` / ACP permission normalize / client fs helper。
- **端到端握手（已验证）**：真实 `opencode acp` 跑通 `initialize`（protocolVersion=1 + agentCapabilities）+ `session/new`（返回 sessionId）—— 证明 JSON-RPC 编解码与真实 server 互通（不调 LLM、不联网、无费用）。
- 全套：`tsc --noEmit` / `eslint src` / `vitest`（149 passed / 28 files）/ `electron-vite build` 均 exit 0。

## 4. ⏳ 后续（0.5.x / 0.6.0）

| 项 | 说明 |
|----|------|
| `session/prompt` 端到端联机验证 | 需 agent 配好 provider + 真实 LLM 调用；走同一套 JSON-RPC，置信度高但未实跑。 |
| client terminal handler | 声明 terminal capability 并复用 tools.ts / approval 沙箱执行；当前仍依赖 agent 自带能力。 |
| server 复用 + 会话记忆 | 当前每轮 spawn/stop；复用 server + `session/load` 支持多轮记忆。 |
| openclaw .ps1/.cmd spawn 细节 | openclaw 为 npm 脚本，Windows 下 spawn 可能需 shell 包装；opencode/hermes（.exe）已直接可用。 |
| plan / usage_update 等 update 类型 | 当前仅呈现正文/思考/工具；plan、用量可后续接 UI。 |

## 5. ✅ 0.5.1 补充

- `request_permission` 已对接 0.4.0 审批门禁：ACP 客户端规范化权限请求，dispatcher 按 agent 的 `write` / `exec` 策略处理。
- `allow` 直接选择 ACP allow 选项；`deny` 优先选择 ACP deny/reject 选项，否则返回 cancelled；`ask` 复用现有审批弹窗与 `agentic:resolveApproval` 回传。
- 只读或无法识别为写/执行的权限请求默认放行，保持 0.5.0 的兼容性。

## 6. ✅ 0.5.2 补充

- `clientCapabilities.fs.readTextFile/writeTextFile` 已声明为 true，ACP server 可调用标准 `fs/read_text_file` / `fs/write_text_file`。
- 每个 `session/new(cwd)` 会记录 session 工作区根目录；fs 请求必须带有效 `sessionId`，路径可为绝对或相对，但最终真实路径必须留在 workspace 内。
- `fs/read_text_file` 支持 ACP 的 `line`（1-based）与 `limit`；`fs/write_text_file` 创建父目录并写入 UTF-8 文本。
- 直接 `fs/write_text_file` 也会调用 dispatcher 的 `onRequestPermission`，复用 0.4.0 的 `write` 审批策略；没有活跃 prompt 审批上下文时拒绝写入。
