# AgentHub 设计文档 v2

> 基于 OpenAgents Network Model 参考，融合多 Agent 协同 UX 设计原则
> 更新日期: 2026-06-07

## 1. 设计目标

从用户体验角度人性化多 Agent 协同工具，打包为 Windows 桌面应用。

### 核心原则（参考 Victor Dibia, 2025）

1. Capability Discovery — 让用户知道每个 Agent 能做什么
2. Observability & Provenance — Agent 行为全程可追踪
3. Interruptibility — 随时中断/暂停/恢复任务
4. Cost-Aware Delegation — 知晓成本后再决策

### 参考项目

| 项目 | 关键参考点 |
|------|-----------|
| OpenAgents Workspace | 事件驱动网络模型、Mod Pipeline、统一寻址、Electron + React + Tailwind + Zustand 技术栈 |
| Stanshy/AgentHub | Harness Engineering、看板任务板、Gate 质量关卡、xterm 终端集成 |
| Microsoft Magentic-UI (2025) | 六种人机交互机制、MCP 工具集成、Action Guards |
| OrchVis (2025) | 层次化多 Agent 编排可视化、目标级进度追踪 |

## 2. 项目结构

agenthub/
  package.json — 项目配置 + electron-builder 打包
  electron.vite.config.ts — electron-vite + React + TailwindCSS 4
  tsconfig.json / .node / .web — TypeScript 配置
  src/
    main/ — Electron 主进程
      index.ts — 窗口管理 + Hub 初始化 + IPC
      store.ts — 持久化配置 (JSON)
      hub/ — Hub 后端核心
        server.ts — WebSocket 服务器
        pipeline.ts — Mod 事件管道
        router.ts — L1 关键词路由
        dispatcher.ts — L2 协同调度
        aggregator.ts — L3 输出汇总
        registry.ts — Agent 注册表
        adapters/ — Agent 适配器
    preload/ — 安全桥接
      index.ts — contextBridge API
    renderer/ — React 渲染层
      App.tsx — 主布局
      components/ — AgentSidebar, ChatPanel, ContextPanel, InputBar, ui/
      store/ — Zustand 状态管理
      hooks/ — React Hooks
      pages/ — Onboarding, Settings

## 3. UX 设计决策

### 布局
四区域布局（VS Code + Slack 混合）
- 左侧: Agent 列表 + 状态灯 + 会话列表
- 中央: 时间线聊天，Markdown 渲染
- 右侧: 调度模式选择 + 活跃任务 + 状态总览
- 底部: 输入框 + @提及 + 模式切换

### 色彩系统
- 背景: #0f1117 / #0a0c12
- 文本: #e2e6ef / #5c6478 / #3f4758
- 强调色: #6366f1 (Indigo)
- Agent: Codex=绿色, Claude=紫色, Hermes=橙色, OpenClaw=青色

### 人性化特性
- 首次引导四步走
- Toast 通知
- @提及自动补全
- 模式快速切换按钮
- 斜杆命令
- 快捷键 Ctrl+Enter
- 系统托盘
- 处理中动画

## 4. 打包
- electron-builder NSIS
- 可选安装目录
- 桌面/开始菜单快捷方式
- 便携版: dist/win-unpacked/AgentHub.exe

## 5. 后续规划
1. 看板任务板 (Kanban)
2. Agent 市场
3. MCP 工具集成
4. Electron 自动更新
5. macOS / Linux 跨平台构建
