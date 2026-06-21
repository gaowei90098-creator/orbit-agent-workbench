# Orbit 版本文件（共享）

> 本文件是多个 Claude / Codex 并行协作时的共享版本空间。任何 Agent 计划发版、升版、打 tag、提交发布说明前，先读取并更新本文件；不要各自维护私有版本口径。

## 当前版本

- 当前代码版本：`0.5.3`
- 当前发布状态：`0.5.3` 已完成本地验证，推送到 GitHub（tag `v0.5.3`，Codex CLI StdIO 非交互权限修复）
- 版本来源：以 `package.json` 的 `version` 与 `build.buildVersion` 为准；两者必须同步

## 升版规则

- 补丁/小修复：按补丁位递增，例如 `0.2.0` -> `0.2.1`
- 同一功能线的较小增强：继续按补丁位递增，例如 `0.2.1` -> `0.2.2`
- 较大功能版本：按 minor 位递增，例如 `0.3.0` -> `0.4.0`
- 不允许只改 `package.json.version` 而不改 `build.buildVersion`
- 不允许未完成验证就登记为已发布版本

## 公开版发布规则

- 开发仓库：`gaowei90098-creator/orbit-hub`，继续按开发版本号递增。
- 公开仓库：`gaowei90098-creator/orbit-hub`，只发布已从开发版完整验证通过的版本。
- 当前首个公开版命名为 `0.1.0 Beta`，Git tag 使用 `v0.1.0-beta`。
- 后续公开版沿用开发版的递增规则；包含新功能的公开版，在公开版本名后追加 `Beta`，tag 使用小写 `-beta` 后缀。
- 公开版必须上传可直接安装/使用的打包产物；Windows 至少提供 `AgentHub-Setup-<公开版本>.exe`。

## 发版前检查

发版 Agent 必须完成：

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

若某项因本机环境失败，必须在版本记录中写明失败命令、失败原因和是否阻塞发布。

## 并行协作约束

- 当前项目有两个 Claude 和至少两个 Codex 并行工作。
- 改动前先读 `COLLAB.md` 和本文件。
- 只暂存/提交自己改的具体文件，禁止 `git add -A`。
- 发现他人未提交改动时，不回滚、不格式化、不重排，除非用户明确要求。
- 发版前确认工作树中是否混有他人改动；无法区分时停止并让用户确认。

## 版本记录

> 按时间线的开发日志见 [docs/开发日志.md](docs/开发日志.md)；下方为按版本组织的权威记录（完整摘要 / 改动文件 / 验证命令）。

### 0.2.0

- 状态：当前开发基线。
- 备注：Agent 能力、工作区流程、agentic 活动展示仍在并行完善中。

### 0.2.1

- 状态：已完成本地验证，准备推送到 GitHub。
- 摘要：修复 Windows 任务栏/托盘图标透明占位问题，使用用户确认的新 AgentHub 图标；补充共享版本文件和发版协作规则。
- 验证：
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run build`

### 0.2.3

- 状态：已完成本地验证，推送到 GitHub（tag `v0.2.3`）。
- 摘要：统一 Agent 能力 + 跨 Agent 技能(Skill)系统 —— 技能子系统（按 agent 单独/集体安装、派发时注入系统提示）、AgentHub 原生 agentic 工具回环（让 HTTP 模型也能在工作区读写文件/跑命令，对齐 codex/claude）、能力矩阵 UI（设置 → 技能）、跨 provider（OpenAI/Anthropic/Gemini）工具调用。
- 主要文件：`src/main/skills/*`、`src/main/agentic/*`、`src/renderer/screens/Skills.tsx`，以及 dispatcher/index/preload/Settings/vite-env/client/agent-runtime 的接线（基于 `b864497` 干净叠加，未混入他人未提交改动）。
- 验证（全绿）：
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`（117 passed）
  - `npm run build`

### 0.2.4

- 状态：已完成本地验证，推送到 GitHub（tag `v0.2.4`）。
- 摘要：修复开发模式（`npm run dev`）渲染黑屏 —— `src/renderer/index.html` 的 CSP `script-src 'self'` 会拦截 `@vitejs/plugin-react` 在 dev 注入的 inline Fast Refresh 预置脚本，导致 React 无法挂载、窗口仅剩深色背景。新增仅开发（`apply: 'serve'`）生效的 `dev-csp-relax` 渲染插件，在 dev 放行 `'unsafe-inline' 'unsafe-eval'`；生产构建（loadFile）不注入该脚本，CSP 保持严格，安全性不受影响。
- 主要文件：`electron.vite.config.ts`（renderer 新增 `dev-csp-relax` 插件）。
- 验证：
  - `npm run typecheck`（exit 0）
  - `npx eslint src`（exit 0；`eslint .` 报的错误全部位于未跟踪的本机目录 `.cc-switch-src/`、`output/playwright/`，属另一项目，不在 AgentHub 源码内）
  - `npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'`（108 passed，exit 0；未限定时的 53 个失败套件均为 `.cc-switch-src/`，其依赖未在本仓库安装）
  - `npm run build`（exit 0）

### 0.3.0

- 状态：已完成本地验证，推送到 GitHub（tag `v0.3.0`）。
- 摘要：**全员 Agent 能力对齐**。让所有接入 agent（openclaw/hermes/marvis/minimax-code）在能力上对齐 codex/claude，并补齐审计发现的全部缺口：
  - HTTP 原生 agentic 回环**默认对所有 agent 开启**（`agentic/config.ts` 升 v2：`mode='all'` + 显式停用名单 + v1 迁移）——HTTP 模型默认可在工作区读写文件/执行命令；未绑定工作区时只读。
  - 工作区 `bootstrapFiles` 真正作为项目级上下文注入（`hub/workspace.ts#bootstrapContext`，路径沙箱 + 字符上限），全 agent、三派发路径通用。
  - 多行提示词保真（`stdio-adapter.ts`：仅 cmd.exe 路径压平换行，直接 spawn 保留）。
  - thinking 对齐到 stdio 路径（`dispatcher.ts` 以 prompt 指令注入）。
  - 技能可在 UI 编辑（`Skills.tsx` 接 `skills.update`）；能力矩阵新增「默认全员 Agentic」总开关（`agentic:getMode/setMode`）。
  - 文档/注释纠偏到实现现状（`docs/AGENTIC.md` §0、`executor.ts` 注释）。
- 主要文件：`agentic/config.ts`、`agentic/capabilities.ts`、`agentic/executor.ts`、`hub/workspace.ts`、`hub/dispatcher.ts`、`hub/adapters/stdio-adapter.ts`、`index.ts`、`preload/index.ts`、`renderer/vite-env.d.ts`、`renderer/screens/Skills.tsx`、`docs/AGENTIC.md`、`docs/DESIGN-0.3.0-capability-parity.md`，以及 5 个新测试。设计方案见 `docs/DESIGN-0.3.0-capability-parity.md`。
- 未覆盖（列入后续）：写/执行的逐次审批；openclaw/hermes/minimax-code 的 CLI 活动解析器（需输出样本）；proxy Anthropic 入站工具透传。
- 验证（全绿）：
  - `npm run typecheck`（exit 0）
  - `npx eslint src`（exit 0；`eslint .` 的报错全在未跟踪的本机目录 `.cc-switch-src/`、`output/playwright/`，属另一项目）
  - `npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'`（126 passed / 25 files，exit 0）
  - `npm run build`（exit 0）

### 0.4.0

- 状态：已完成本地验证，推送到 GitHub（tag `v0.4.0`）。
- 摘要：**Item K 后续能力**（0.3.0 列入后续的两项落地）：
  - **写/执行审批门禁**：新增 `agentic/approval.ts`，per-agent × per-tool 的 `allow/ask/deny` 策略（默认全 `allow`，零回归）。`executor.ts` 执行 `fs_write`/`exec` 前查策略：`deny` 直接挡下并回灌模型，`ask` 经 dispatcher `approval` 流事件 → 渲染层弹窗（`glass/approval-dialog.tsx`）→ `agentic:resolveApproval` 回传（超时/取消自动拒绝）。只读工具永不门禁。配置 UI 在能力矩阵下方「审批策略」（全局默认 + 按 agent 覆盖）。
  - **proxy Anthropic 入站工具透传**：`routing/proxy.ts` 的 `/v1/messages` 解析入站 `tools`/`tool_choice`、保留 `tool_use`/`tool_result` 多轮结构（转 OpenAI 形状经 client 出站到任意上游），并把上游 tool_calls 回写为 anthropic `tool_use` SSE 块（流式增量 + 上游无增量时 done 兜底补发）；非流式 json 同样含 tool_use。
- 主要文件：`agentic/approval.ts`(新)、`agentic/executor.ts`、`hub/dispatcher.ts`、`routing/proxy.ts`、`index.ts`、`preload/index.ts`、`renderer/vite-env.d.ts`、`renderer/App.tsx`、`renderer/glass/approval-dialog.tsx`(新)、`renderer/screens/Skills.tsx`、`docs/AGENTIC.md`、`docs/DESIGN-0.3.0-capability-parity.md`，以及 3 个测试（`approval.test.ts`、`proxy-anthropic-tools.test.ts` 新增，`executor.test.ts` 补门禁用例）。
- 未覆盖（仍待办）：openclaw/hermes/minimax-code 的 CLI 活动解析器（需各自真实输出样本）；proxy 工具透传的端到端正确性需联机 Claude Code + 支持工具的上游验证。
- 验证（全绿）：
  - `npm run typecheck`（exit 0）
  - `npx eslint src`（exit 0）
  - `npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'`（141 passed / 27 files，exit 0）
  - `npm run build`（exit 0）

### 0.5.0

- 状态：已完成本地验证，推送到 GitHub（tag `v0.5.0`）。
- 摘要：**ACP（Agent Client Protocol）统一接入** —— 0.3.0 Item K 的「三线 CLI 活动接入」改用更优的 ACP 路线落地。发现 hermes/openclaw/minimax-code(opencode) 都支持 ACP（JSON-RPC over stdio 标准），故写一个 ACP 客户端适配器统一接入，结构化活动（工具/文件/思考/正文）开箱即有。
  - `adapters/acp-client.ts`(新)：ACP JSON-RPC 客户端（initialize→session/new→session/prompt→stopReason，消费 session/update）+ `mapAcpUpdate` 纯函数映射；request_permission 第一阶段自动放行。
  - `adapters/acp-adapter.ts`(新)：`AcpAgentAdapter`（protocol:'acp'）+ `acpDefaults`（各 agent acp 启动默认）。
  - `hub/dispatcher.ts`：`sendToAgentAcp` 路径（stopReason 判完成、session/update→delta+activity、取消发 session/cancel）。
  - 类型/工厂/能力/UI：`protocol:'acp'` 全链路；createAdapter acp 分支；能力矩阵 ACP 展示；设置→路由 ACP 后端选项（hermes/openclaw/minimax-code）。
- 主要文件：`adapters/acp-client.ts`(新)、`adapters/acp-adapter.ts`(新)、`adapters/__tests__/acp-client.test.ts`(新)、`adapters/base.ts`、`adapters/agent-adapter.ts`、`hub/registry.ts`、`hub/dispatcher.ts`、`providers/types.ts`、`agentic/capabilities.ts`、`renderer/glass/meta.ts`、`renderer/screens/Skills.tsx`、`renderer/screens/Settings.tsx`、`renderer/vite-env.d.ts`、`docs/AGENTIC.md`、`docs/DESIGN-0.5.0-acp.md`(新)。
- 验证：
  - `npm run typecheck`（exit 0）
  - `npx eslint src`（exit 0）
  - `npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'`（149 passed / 28 files，exit 0）
  - `npm run build`（exit 0）
  - **端到端握手**：真实 `opencode acp` 跑通 `initialize`（protocolVersion=1 + agentCapabilities）+ `session/new`（sessionId），证明 JSON-RPC 编解码与真实 server 互通。
- 未覆盖（仍待办，见 DESIGN-0.5.0-acp §4）：`session/prompt` 完整对话流的联机验证；client fs/terminal handler；server 复用/会话记忆；openclaw .ps1/.cmd spawn 细节。

### 0.5.1

- 状态：已完成本地验证，推送到 GitHub（tag `v0.5.1`）。
- 摘要：ACP `session/request_permission` 对接 0.4.0 审批门禁。`acp-client.ts` 规范化 ACP permission 请求，把写入类请求映射为 `write`、命令类请求映射为 `exec`；dispatcher 按 per-agent 审批策略处理 `allow / deny / ask`，并复用既有审批弹窗与 `agentic:resolveApproval` 回传。只读或未知权限请求继续自动放行，保持兼容性。
- 主要文件：`src/main/hub/adapters/acp-client.ts`、`src/main/hub/dispatcher.ts`、`src/main/hub/adapters/__tests__/acp-client.test.ts`、`package.json`、`package-lock.json`、`docs/DESIGN-0.5.0-acp.md`、`docs/AGENTIC.md`。
- 验证：
  - `npm run typecheck`
  - `npx eslint src`
  - `npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'`（152 passed / 28 files）
  - `npm run build`

### 0.5.2

- 状态：已完成本地验证，推送到 GitHub（tag `v0.5.2`）。
- 摘要：ACP client fs handler 落地。`initialize` 现在声明 `clientCapabilities.fs.readTextFile/writeTextFile=true`；ACP server 调用 `fs/read_text_file` / `fs/write_text_file` 时由 AgentHub 在 session 工作区内执行。路径解析同时支持 ACP 传入的绝对路径和相对路径，真实路径必须留在 workspace 内，拒绝 `..`、绝对路径逃逸和符号链接逃逸。直接 `fs/write_text_file` 写入也复用 0.4.0 per-agent `write` 审批策略，避免绕过 `session/request_permission`。
- 主要文件：`src/main/hub/adapters/acp-client.ts`、`src/main/hub/adapters/__tests__/acp-client.test.ts`、`package.json`、`package-lock.json`、`docs/DESIGN-0.5.0-acp.md`、`docs/AGENTIC.md`、`docs/开发日志.md`。
- 验证：
  - `npm run typecheck`
  - `npx eslint src`
  - `npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'`
  - `npm run build`
  - `npm run build:win`
- 本机安装验证：已卸载旧版 `AgentHub 0.1.0`，安装并启动 `AgentHub 0.5.2`（`C:\Users\Admin\AppData\Local\Programs\AgentHub\AgentHub.exe`）。

### 0.5.3

- 状态：已完成本地验证，推送到 GitHub（tag `v0.5.3`）。
- 摘要：修复 Codex CLI StdIO 在 AgentHub 中被只读沙箱限制，导致无法执行 PowerShell/定位本地项目的问题。Codex CLI 0.134 在 `codex exec --sandbox workspace-write` 非交互模式下会降级为只读/不能执行 shell；默认参数改为 `exec --json --sandbox danger-full-access --skip-git-repo-check -C . -`，由 AgentHub 选择的 workspace 作为 spawn cwd 和 Codex `-C` 工作根。
- 主要文件：`src/main/hub/adapters/codex.ts`、`src/main/hub/__tests__/createAdapter.test.ts`、`src/renderer/glass/meta.ts`、`src/renderer/screens/Settings.tsx`、`package.json`、`package-lock.json`。
- 验证：
  - `npx vitest run src/main/hub/__tests__/createAdapter.test.ts src/main/hub/__tests__/codexAdapter.test.ts src/main/hub/adapters/__tests__/codex-stream-json.test.ts`（22 passed / 3 files）
  - `npm run typecheck`
  - `npx eslint src`
  - `npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'`（155 passed / 28 files）
  - `npm run build`
  - `npm run build:win`
  - 联机冒烟：真实 Codex CLI 0.134 用 `--sandbox danger-full-access -C .` 可在 `C:\Users\Admin\Desktop\测试` 执行 PowerShell 并定位 `D:\AgentHub开发版本`。
- 本机安装验证：已安装并启动 `AgentHub 0.5.3`（`C:\Users\Admin\AppData\Local\Programs\AgentHub\AgentHub.exe`）。

### 下一个候选版本

- 默认候选：`0.5.4`（小修复/小增强）；下一个较大功能版本 `0.6.0`。
- 适用范围：ACP 增强（terminal handler / server 复用）、session/prompt 联机验证、后续 agentic / 工作区 / 技能流程修复与小增强。
- 登记要求：完成后补充改动摘要、验证命令、提交哈希或发布 tag。
