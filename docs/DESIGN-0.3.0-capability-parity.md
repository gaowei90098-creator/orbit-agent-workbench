# AgentHub 0.3.0 设计方案 — 全员 Agent 能力对齐

> 目标版本：`0.2.4 → 0.3.0`（较大功能版本，按 [VERSION.md](../VERSION.md) 规则走 minor 递增）。
> 状态图例：✅ 已实现（本工作树，未提交） ｜ ⏳ 待完成 ｜ 🔭 本版不做（列入后续）。
> 配套：[AGENTIC.md](./AGENTIC.md)、[DESIGN.md](./DESIGN.md)。

---

## 1. 背景与目标

### 1.1 起因
对 0.2.4 接入的六个 agent（claude / codex / openclaw / hermes / marvis / minimax-code）做了一次全路径能力审计（3 路并行子审计 + 人工复核），结论：**能力并非统一，而是分层**：

| 层级 | agent | 说明 |
|------|-------|------|
| Tier 1（原生 agentic + 活动流） | claude、codex | 唯二设了 stream-json `activityParser`、唯二进 `NATIVE_CLI_AGENTS`（`capabilities.ts:23`） |
| Tier 2（裸 CLI，无结构化 agentic） | minimax-code、openclaw、hermes | 能启动 CLI，但多行提示词被压平、无活动解析、未被认定 agentic |
| Tier 3（无 CLI，仅 HTTP） | marvis | 空 exec args（`marvis.ts:14`），仅靠 HTTP 绑定 |

并发现若干确认缺口：HTTP 原生 agentic 回环**默认关闭**（`config.ts` `httpEnabled:[]`）；`bootstrapFiles` 字段声明但**无人消费**（悬空 stub）；技能 UI **不能编辑**已有技能；多行提示词在 `{prompt}` 占位 agent 上被**压平为空格**（`stdio-adapter.ts:84`）；thinking **未接入** stdio 路径；agentic 回环**零测试**；`docs/AGENTIC.md` 与 `executor.ts:8` 注释**严重过时**。

### 1.2 目标
让**所有**接入 agent 在能力上对齐 claude/codex，并补齐所有确认缺口。具体：

1. 任何 HTTP 绑定的 agent 默认具备 读/写/执行/多步自驱（agentic-loop），与 codex/claude 一致。
2. 工作区 `bootstrapFiles` 真正作为项目级上下文注入（全 agent 通用）。
3. 多行提示词对所有 agent 保真。
4. thinking/reasoning 控制在 stdio 路径也生效。
5. 技能可在 UI 编辑。
6. 上述能力有测试覆盖；文档与注释与实现一致。

### 1.3 设计原则
- **统一机制**：能力来自一处推导（`capabilities.ts`），而非每个适配器各自为政。
- **默认对齐**：开箱即对齐 claude/codex，而不是"手动逐个开"。
- **安全兜底**：未绑定工作区时工具回环**只读**；写/执行限定工作区内，拒绝 `..`/绝对路径逃逸。
- **零回归**：无工作区/无技能/未开 thinking 时行为与 0.2.4 完全一致。
- **协作合规**：只改并提交本方案涉及的文件，禁止 `git add -A`；不动他人未提交改动。

---

## 2. 改动地图（总览）

| # | 模块 / 文件 | 改动 | 状态 |
|---|-------------|------|------|
| A | `agentic/config.ts` | 配置升 v2：`mode='all'` 默认全员 agentic + 显式停用名单 + v1 迁移 | ✅ |
| B | `agentic/capabilities.ts` | 注释纠偏（默认开启语义）；推导逻辑不变 | ✅ |
| C | `hub/workspace.ts` | 新增 `bootstrapContext(id)`：安全读取 bootstrapFiles → 项目上下文块 | ✅ |
| D | `hub/dispatcher.ts` | 把 `workspaceId` 串进提示词构建并注入 bootstrap；stdio 路径补 thinking 指令 | ✅ |
| E | `hub/adapters/stdio-adapter.ts` | 多行提示词保真（仅 cmd.exe 路径压平，直接 spawn 保留换行） | ✅ |
| F | `index.ts` / `preload/index.ts` / `vite-env.d.ts` | 新增 `agentic:getMode/setMode` IPC + preload + 类型 | ✅ |
| G | `renderer/screens/Skills.tsx` | 技能编辑 UI + 能力矩阵"默认全员 Agentic"总开关 | ✅ |
| H | `agentic/executor.ts` 注释 / `docs/AGENTIC.md` | 注释与文档纠偏到实现现状 | ✅ |
| I | 测试补全（config / bootstrap / executor loop / inject / stdio） | 见 §5.8 | ✅ |
| J | 验证（typecheck/lint/test/build）+ 升 0.3.0 + 登记 VERSION.md + 推 GitHub | 见 §5.9 | ✅ |
| K | 逐次审批 / 三线 CLI 活动解析器 / proxy Anthropic 入站 | 见 §6 | 🔭 |

---

## 3. 详细设计

### 3.1 ✅ HTTP agentic 默认全员开启（最大杠杆）
**问题**：HTTP 原生 agentic 回环本已端到端可用（三种 provider 线都支持工具，`executor.ts` + `client.ts`），但默认关闭、需逐个 agent 手动开 → 实际能力不对齐。

**设计**：`config.ts` 升 v2：
```
{ version: 2, mode: 'all' | 'selected', selected: string[], disabled: string[] }
```
- `mode='all'`（新默认）：除 `disabled` 名单外，所有 HTTP agent 启用 agentic。
- `mode='selected'`：仅 `selected` 名单内启用。
- `isEnabled(id)`：`all` → `!disabled.includes(id)`；`selected` → `selected.includes(id)`。
- `setEnabled(id,on)`：`all` 模式下"关"= 加入 disabled；`selected` 模式下"开"= 加入 selected。
- `getMode/setMode` 新增；`getEnabled()` 按 `AGENTS` 推导当前实际启用列表。
- **v1 迁移**：旧 `{version:1, httpEnabled}` → `{mode:'selected', selected:httpEnabled}`，尊重老用户的显式选择；无配置的新装 → `mode:'all'`（默认对齐）。

**取舍/风险**：默认让 HTTP 模型可写文件/执行命令属能力增强也是攻击面增大。缓解：①未绑定工作区时**只读**；②写/执行限定工作区内（`tools.ts` 路径沙箱）；③能力矩阵提供"默认全员/按需"总开关 + 逐 agent 开关，可一键收紧。

### 3.2 ✅ 工作区 bootstrap 项目上下文注入
**问题**：`Workspace.bootstrapFiles` 声明、可持久化、可在 IPC 改，但无任何派发路径读取 → 悬空。

**设计**：`workspace.ts` 新增 `bootstrapContext(id, maxChars=16000)`：
- 取工作区，逐个 `bootstrapFiles`（相对 rootPath）解析；**拒绝绝对路径与 `..` 逃逸**；`readFileSync(utf-8)`；总字符超限即停并标注省略数；缺失/越界跳过并标注。
- 产出 `# Project context (workspace bootstrap files)` 块。
- 无工作区/无 bootstrapFiles/全失败 → 空串（零回归）。

`dispatcher.ts` 把 `opts.workspaceId` 串进 `systemPromptFor`（HTTP，附在系统提示后）与 `promptForAgent`（stdio，置于项目上下文顶部），经 `workspaceContextFor()` 注入。对全 agent、HTTP/HTTP-agentic/stdio 三路径统一生效。

### 3.3 ✅ 多行提示词保真
**问题**：`{prompt}` 占位的 agent（openclaw/hermes/minimax-code）把 `\n` 压成空格（`stdio-adapter.ts:84`），多行任务结构丢失。

**设计**：仅当走 `cmd.exe /c` 拼接命令行（`needsCommandShell`）时压平换行（否则破坏命令行解析）；直接 spawn（`.exe` / 非 Windows）时 argv 单元可含换行，**原样保留**。严格改进、无回归（hermes 等 .exe 直接受益）。

### 3.4 ✅ stdio thinking 对齐
**问题**：HTTP 路径尊重 `opts.thinking`，stdio 路径完全忽略 → reasoning 控制不对齐。

**设计**：stdio 无法下发 reasoning 参数，故在 `sendToAgentStdio` 中，当 `thinkingRequested(opts.thinking)` 为真时，以 `STDIO_THINKING_DIRECTIVE` 指令前置到 prompt（"逐步推理、考虑边界、不输出原始思维链"）。`thinkingRequested` 宽松兼容 `{enabled}`/`{level}`/`{budget}` 形态。仅在用户为该 agent 开了 thinking 时触发（opt-in，零回归）。

### 3.5 ✅ 技能编辑 UI + agentic 模式总开关
**问题**：`skills.update` 已贯通 IPC/preload，但 UI 只能增/删 → 无法编辑已有技能；能力矩阵无"默认全员"总控。

**设计**（`Skills.tsx`）：
- 技能卡片加"编辑"（铅笔）按钮 → 复用新增表单做编辑（预填、标题/按钮切"编辑/保存"），保存调 `skills.update`。
- 能力矩阵标题栏加"默认全员 Agentic"开关，绑 `agentic.getMode/setMode`（`all` ⇄ `selected`）。

### 3.6 ✅ IPC / preload / 类型
新增 `agentic:getMode` / `agentic:setMode`（`index.ts`）、`agentic.getMode/setMode`（`preload`）、对应 `vite-env.d.ts` 类型。

### 3.7 ✅ 文档与注释纠偏
- `executor.ts` 头部"anthropic/gemini 工具未补齐"已过时 → 改为"三线均已实现"；`userText/systemPrompt` 注释纠正为"bootstrap 注入 systemPrompt"。
- `AGENTIC.md` 顶部新增 §0「实现现状（0.3.0）」，纠正过时诊断、记录已落地项与待办，保留历史路线图。

### 3.8 ✅ 测试方案（已落地）
| 测试 | 文件 | 覆盖点 |
|------|------|--------|
| agentic 配置 | `agentic/__tests__/config.test.ts` | 默认 `all` → 全员 enabled；`all` 下 setEnabled 关 = 进 disabled；切 `selected` 语义；v1→v2 迁移 |
| 工作区 bootstrap | `hub/__tests__/workspaceBootstrap.test.ts` | 正常读取拼块；`..`/绝对路径越界拒绝；缺失跳过；字符上限省略；无 bootstrap → 空串 |
| agentic 回环 | `agentic/__tests__/executor.test.ts` | mock client：首轮 `tool_calls` → 执行工具 → 回灌 → 次轮收尾；round 上限；取消中断 |
| 技能注入块 | `skills/__tests__/inject.test.ts` | 空 → 空串；多技能拼装；16k 上限省略计数 |
| 多行保真 | `hub/adapters/__tests__/stdio-prompt.test.ts` | 直接 spawn 保留 `\n`；cmd.exe 路径压平（可用纯函数化的参数构造做断言） |

验收：`npx eslint src` exit 0；`npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'` 全绿；`npm run typecheck`、`npm run build` exit 0。

### 3.9 ✅ 验证与发版（已完成）
1. 跑发版前必检（见上，注意本机 `.cc-switch-src/`、`output/` 杂物会让全量 `eslint .`/`vitest` 假失败，限定 src 验证）。
2. `package.json` `version` + `build.buildVersion` → `0.3.0`。
3. `VERSION.md` 登记 0.3.0（摘要 + 验证 + 候选推进到 0.3.1 或 0.4.0）。
4. 只暂存本方案涉及文件，提交（subject 末尾 `(0.3.0)` + Co-Authored-By），打 tag `v0.3.0`，`git fetch` 后推 master + tag。

**结果（已完成）**：0.3.0 已落地为提交 `7e1c863`（`feat: 全员 Agent 能力对齐 …（0.3.0）`），含 §3.8 全部 5 个测试文件，已推送 `origin/master`。复核验证（2026-06-16）：`tsc --noEmit` exit 0；`eslint src` exit 0；`vitest run`（排除 `.cc-switch-src/`、`output/`）= 25 文件 / 126 用例全绿；`electron-vite build` exit 0。Item K（逐次审批 / 三线 CLI 活动解析器 / proxy Anthropic 入站）按计划留作 0.3.x/0.4.0 后续。

---

## 4. 派发链路（改动后数据流）

```
renderer → hub:dispatch(text, mode, agent, {thinking, workspaceId})
  → Dispatcher.dispatch → sendToAgent(agentId)
     ├─ stdio adapter（codex/claude/minimax…）→ sendToAgentStdio
     │     promptForAgent = [工作区bootstrap上下文] + runtime系统提示(+技能注入) + 用户任务
     │     (+ thinking 指令) → CLI 子进程在工作区 cwd 内执行
     └─ http
         ├─ isHttpAgenticEnabled(agentId)?  ← config v2: 默认 true
         │     是 → runAgenticHttp：systemPrompt(=runtime+技能+bootstrap) + AGENTIC_TOOLS
         │            → 模型 tool_calls → executeTool(读/写/列/执行, 限 workspace root)
         │            → 回灌 role:'tool' → 循环(≤8) → activity 事件 → 步骤卡 UI
         └─ 否 → 纯聊天 stream
```

---

## 5. 安全与权限姿态

- **只读降级**：`ToolContext.readOnly = !root`——未绑定工作区时 `fs_write`/`exec` 被拒（`tools.ts`）。
- **路径沙箱**：所有文件操作经 `resolveWithin` + `isRealPathWithin`，拒绝绝对路径、`..`、符号链接逃逸。
- **默认开启的取舍**：默认让 HTTP 模型可在**已绑定的工作区内**写/执行，是有意的能力对齐；用户可在能力矩阵切"按需"或对个别 agent 关闭。
- **回环上限**：默认 8 轮，防失控；支持取消。

---

## 6. 🔭 本版（0.3.0）不做 → 0.4.0 进展

> 下表为 0.3.0 列出的后续项（Item K）。**0.4.0 已落地前两项**（审批门禁 + proxy Anthropic 工具透传），详见 [AGENTIC.md](./AGENTIC.md) §0。

| 项 | 状态 | 说明 |
|----|------|------|
| 写/执行的逐次交互审批 | ✅ 0.4.0 | per-agent × per-tool 的 `allow/ask/deny`（默认 `allow`，零回归）；`ask` 运行时弹窗逐次审批，`deny` 直接挡下并回灌模型。`agentic/approval.ts` + `executor.ts` 门禁 + dispatcher `approval` 事件/`resolveApproval` + `glass/approval-dialog.tsx` 弹窗 + 能力矩阵「审批策略」UI，含单测。 |
| proxy 的 Anthropic 入站工具透传 | ✅ 0.4.0 | `/v1/messages` 解析入站 `tools`/`tool_choice`、保留 `tool_use`/`tool_result` 多轮结构、上游 tool_calls 回写为 anthropic `tool_use` SSE 块（流式 + done 兜底）。协议层单测；端到端需联机验证。 |
| openclaw/hermes/minimax-code 的 CLI 活动解析器 | ⏳ 待样本 | 需各自 CLI 真实输出样本，盲写会出错。三者已确认装于本机（`hermes.exe` / `openclaw.ps1` / `opencode.exe`），但「活动事件流」样本需跑真实任务（联网/可能计费）取得。 |

---

## 7. 多 Agent 协作注意

- 本方案涉及文件：`agentic/config.ts`、`agentic/capabilities.ts`、`agentic/executor.ts`、`hub/workspace.ts`、`hub/dispatcher.ts`、`hub/adapters/stdio-adapter.ts`、`index.ts`、`preload/index.ts`、`renderer/vite-env.d.ts`、`renderer/screens/Skills.tsx`、`docs/AGENTIC.md`、本文件，以及 §3.8 的测试文件。
- 提交时**只暂存以上文件**，禁止 `git add -A`；发版前确认工作树无他人未提交改动；本机 `.cc-switch-src/`、`output/` 为本地杂物，永不入库。
