# AgentHub 设计文档（0.2.0）

> 本文件描述 **当前** 架构。逐文件源码索引见 [SOURCE.md](./SOURCE.md)；权威以 `src/` 实际代码为准。
> （历史说明：本文件早期版本只描述「Codex 单适配器」的初始接线，已于 0.2.0 重写。）

---

## 1. 总览

AgentHub 是一个 **Electron 33 + React 18 + TypeScript** 桌面应用，把多个本地 AI Agent CLI 与 HTTP 大模型供应商统一到一个玻璃拟态工作台。三条核心能力：

1. **StdIO 直连** —— 把本地 Agent CLI（Codex / Claude Code / Hermes / OpenClaw / Marvis / MiniMax Code）作为子进程直接驱动。
2. **本地路由代理（端口 9528）** —— 对外暴露 OpenAI 与 Anthropic 两种入站协议，转发到可配置的上游供应商，带故障转移链 + 熔断器。
3. **Desktop Agent 接管** —— 直接改写已安装 Agent 的配置文件，把它们指向本地代理（全部可备份还原）。

UI 为玻璃拟态（`backdrop-filter:blur` + CSS 自定义属性），`frame:false` 自定义标题栏，全量中英双语。

## 2. 进程与目录结构

```
src/
├── main/        Electron 主进程（Node）：IPC、窗口、hub 派发、路由代理、供应商、接管
├── preload/     安全 IPC 桥（window.electronAPI）
└── renderer/    React 渲染层：glass/ 设计系统 + screens/ 四页面
```

渲染层与主进程之间 **只通过 IPC 通信**（旧的 WebSocket 客户端已在 0.2.0 移除）。

## 3. Agent Hub（`src/main/hub/`）

- **registry.ts** — 注册/注销 adapter，维护 `AgentInfo` 状态。
- **adapters/**
  - `base.ts` — `AgentAdapter` 接口、`HttpAgentAdapter`、`createAdapter` 工厂（`STDIO_FACTORIES` 表驱动）。
  - `agent-adapter.ts` — 抽象 `BaseAgentAdapter`（拆出以断循环依赖）。
  - `stdio-adapter.ts` — 通用 `StdioAgentAdapter`：oneshot 模式、Windows `taskkill /t /f` 收尾、GBK/UTF-8 智能解码。
  - `codex.ts` / `claude.ts` / `hermes.ts` / `openclaw.ts` / `marvis.ts` / `minimax-code.ts` — 各 Agent 的 exec 参数与 stdin 写法配置。
- **agent-locator.ts** — 多候选二进制探测，返回 `AgentBinaryCandidate[]`（来源 `desktop` / `terminal`），供 UI 下拉选择。
- **dispatcher.ts** — 按 `adapter.protocol` 路由（`http` → `ProviderClient`；`stdio-*` → 子进程），注入系统提示词，发出流事件（`start`/`delta`/`done`/`error`）。
- **router.ts / aggregator.ts / pipeline.ts** — 关键词路由、聚合、事件管线（部分为早期脚手架，按需精简）。
- **server.ts** — 遗留的 9527 WebSocket server（见 §8 安全说明）。

适配方式速查：

| Agent | 适配方式 |
|-------|---------|
| Codex | `codex exec --skip-git-repo-check -`（多候选探测）|
| Claude Code | `claude --print`（多候选探测）|
| Hermes | stdin 写入（多候选探测）|
| OpenClaw | `crestodian --message {prompt}`（多候选探测）|
| Marvis | 无非交互 CLI → 建议 HTTP 绑定（stdio 候选已禁用，避免卡死）|
| MiniMax Code | `opencode run {prompt}`（`stdio-plain`，无需 key）|

## 4. 路由代理（`src/main/routing/proxy.ts`）

- **双协议入站**：`/v1/chat/completions`（OpenAI SSE）+ `/v1/messages`（Anthropic SSE）。
- **故障转移链 + 熔断器**：单上游连续 3 次失败 → 断路 60s，自动切到下一个。
- 出站统一经 `ProviderClient` 流式转发，最终回写 SSE。

## 5. 配置接管（`src/main/routing/takeover.ts`）

把已安装的 Desktop Agent 指向本地代理，逐格式做最小手术：

- Codex：`config.toml` TOML 键手术
- Claude Code：`settings.json` env 补丁
- Hermes：`config.yaml` 行级手术
- OpenClaw：`openclaw.json` 补丁

全部写 `.agenthub-bak` 备份 + electron-store 暂存，可 **精确还原**。

## 6. 供应商管理（`src/main/providers/`）

- `presets.ts` — 12 个内置供应商（openai/anthropic/gemini/deepseek/minimax/moonshot/zhipu/qwen/doubao/siliconflow/hunyuan/openrouter）。
- `manager.ts` — `fetchModels`（OpenAI `/models`、Anthropic `/models`、Gemini `/models`）、`mergeWithBuiltins`、自定义供应商 CRUD、健康检查、绑定解析 `resolveBinding`。
- `client.ts` — `ProviderClient`（HTTP 流式调用）。
- `types.ts` — 配置 schema（`ProviderDef`、`AgentRouteBinding` 等）。

## 7. 渲染层（`src/renderer/`）

- `glass/` — 设计系统：`i18n.ts`（`tr(zh,en)` + `useLang()`）、`meta.ts`（`AGENT_META`、`DEFAULT_STDIO_ARGS`）、`ui.tsx`、`Sidebar.tsx`、`Titlebar.tsx`。
- `screens/` — `Home`、`Chat`、`Tasks`、`Settings`（含 `RoutingTab`、`AgentSitesTab`）。
- `App.tsx` — 根组件 + IPC 监听；`main.tsx` 为入口。
- 全 UI 中英双语，语言切换整树重挂载，`localStorage` 持久化（key `ah-lang`）。

## 8. 关键不变量与约束

1. **协议决定派发路径**：`adapter.protocol` 为 `http` 走 HTTP，否则走 stdio；默认 `http`。
2. **stdio 字段名锁定**：`StdioAgentAdapter` 的 `proc` 字段名与 `mode='oneshot'` 被 dispatcher 轮询依赖，**勿改名**。
3. **接管可还原**：任何 takeover 都必须留 `.agenthub-bak` 并能精确还原。
4. **IPC 唯一通道**：渲染层不再使用 WebSocket；`server.ts`（9527）为遗留服务，若保留需加鉴权（参见安全待办）。
5. **失败外显**：adapter 的 `onError` 必须转成 `error` 流事件，dispatcher 不得吞错。
   - `sendToAgent` / `sendToAgentStdio` 出错时返回 `{ content, error }`（`error` 非空即失败），调用方据此判断，**绝不能把空内容当成成功**。
   - 编排模式（`runOrchestrate`）：① 子任务 provider 报错 → 发 `orchestrate:subtask status:error`，不得发 `done`（空内容）伪装成功；② 分解/汇总阶段报错 → 发 `orchestrate:error` 且 `task.status='failed'`，不得静默 `completed`；③ 未绑定任何 agent → 同样发 `orchestrate:error`。契约由 `orchestrator-e2e.test.ts` 锁定。

## 9. 构建与质量门

- 开发：`npm run dev`（须在项目根目录）。
- 校验：`npm run typecheck`、`npm run lint`、`npm test`（vitest）。
- 打包：`npm run build:win` → `dist/AgentHub-Setup-<version>.exe`。
- CI：`.github/workflows/ci.yml` 在 push/PR 上跑 typecheck + lint + test + build（windows-latest）。

## 10. 版本与变更

每个大版本变更记录在 git 提交与 tag 中（`v0.1.0` 为完整功能基线）。0.2.0 开发周期的修复/清理详见提交历史。
