# AgentHub 源码索引（0.2.0）

> 当前源码树逐文件速查。架构说明见 [DESIGN.md](./DESIGN.md)；权威以 `src/` 实际代码为准。
> （历史说明：本文件早期版本是 Codex 一次性生成的旧源码归档，已于 0.2.0 重写为活动索引。）

## `src/main/` —— Electron 主进程

| 文件 | 作用 |
|------|------|
| `index.ts` | 应用入口：创建窗口、注册全部 IPC、按绑定注册 agent、启动路由代理与 Hub |
| `store.ts` | electron-store 封装（应用配置 / 接管暂存的持久化） |
| `capabilities/thinking.ts` | thinking / 推理能力相关元数据 |

### `src/main/hub/` —— Agent 调度中枢

| 文件 | 作用 |
|------|------|
| `registry.ts` | adapter 注册表，维护 `AgentInfo` 状态 |
| `dispatcher.ts` | 按 `adapter.protocol` 派发（http / stdio）、系统提示词、流事件 |
| `agent-locator.ts` | 多候选二进制探测，返回 `AgentBinaryCandidate[]` |
| `agent-detector.ts` | Agent / CLI 探测规则 |
| `router.ts` | 关键词路由（auto 模式选 agent） |
| `aggregator.ts` | 多 agent 输出聚合 + agent 显示名 |
| `pipeline.ts` | 事件管线 |
| `server.ts` | 遗留 9527 WebSocket server（见 DESIGN §8） |

#### `src/main/hub/adapters/`

| 文件 | 作用 |
|------|------|
| `base.ts` | `AgentAdapter` 接口、`HttpAgentAdapter`、`createAdapter` 工厂、`STDIO_FACTORIES` |
| `agent-adapter.ts` | 抽象 `BaseAgentAdapter`（拆出断循环依赖） |
| `stdio-adapter.ts` | 通用 `StdioAgentAdapter`：oneshot、Windows taskkill、GBK/UTF-8 解码 |
| `codex.ts` | Codex：`codex exec --skip-git-repo-check -` |
| `claude.ts` | Claude Code：`claude --print` |
| `hermes.ts` | Hermes：stdin 写入 |
| `openclaw.ts` | OpenClaw：`crestodian --message {prompt}` |
| `marvis.ts` | Marvis：无非交互 CLI，建议 HTTP 绑定 |
| `minimax-code.ts` | MiniMax Code：`opencode run {prompt}`（stdio-plain，无需 key） |

#### `src/main/hub/__tests__/`

| 文件 | 作用 |
|------|------|
| `createAdapter.test.ts` | `createAdapter` 工厂行为断言 |
| `codexAdapter.test.ts` | 真实 spawn 端到端（经 mock-codex） |
| `mock-codex.cmd` / `mock-codex.js` | 测试用回显子进程 |

### `src/main/routing/`

| 文件 | 作用 |
|------|------|
| `proxy.ts` | 本地路由代理（9528）：OpenAI + Anthropic 双协议入站、故障转移 + 熔断 |
| `takeover.ts` | Desktop Agent 配置接管（TOML/JSON/YAML 手术 + `.agenthub-bak` 备份） |

### `src/main/providers/`

| 文件 | 作用 |
|------|------|
| `presets.ts` | 12 个内置供应商预设 |
| `manager.ts` | `fetchModels` / `mergeWithBuiltins` / 自定义供应商 CRUD / 健康检查 / `resolveBinding` |
| `client.ts` | `ProviderClient`：HTTP 流式调用上游 |
| `types.ts` | 配置 schema（`ProviderDef` / `AgentRouteBinding` 等） |

## `src/preload/`

| 文件 | 作用 |
|------|------|
| `index.ts` | 安全 IPC 桥，暴露 `window.electronAPI` |

## `src/renderer/` —— React 渲染层

| 文件 | 作用 |
|------|------|
| `main.tsx` | 渲染入口 |
| `App.tsx` | 根组件 + IPC 监听 + 页面路由 |
| `globals.css` | 玻璃拟态设计令牌（CSS 自定义属性） |
| `index.html` | HTML 模板 |

### `src/renderer/glass/` —— 设计系统

| 文件 | 作用 |
|------|------|
| `i18n.ts` | `tr(zh,en)` 内联翻译 + `useLang()` |
| `meta.ts` | `AGENT_META`、`DEFAULT_STDIO_ARGS`、共享类型 |
| `ui.tsx` | 通用玻璃组件 |
| `Sidebar.tsx` / `Titlebar.tsx` | 侧边栏 / 自定义标题栏 |

### `src/renderer/screens/` —— 四个页面

| 文件 | 作用 |
|------|------|
| `Home.tsx` | 总览 |
| `Chat.tsx` | 会话 |
| `Tasks.tsx` | 任务 |
| `Settings.tsx` | 设置（含 RoutingTab、AgentSitesTab） |

`src/renderer/public/icons/` 为各 Agent / 供应商图标。

---

> 已删除（0.2.0）：`src/renderer/{components,pages,store,hooks}` —— 旧版 pre-glass UI 与 WebSocket 客户端死代码。
