# AgentForge Mission Control Project Memory

> This file is the durable handoff memory for the AgentForge Mission Control pivot. Every coding session must update it before stopping.

## Project Name

Current workspace name: `AgentForge-MissionControl`

This is the new Desktop source workspace for future development. It contains the source code, project memory, and handoff rules. Continue future coding work from:

`/Users/gao90098/Desktop/AgentForge-MissionControl`

The packaged desktop app is now `/Users/gao90098/Desktop/Orbit.app`. The app still keeps the existing `agenthub` userData directory for continuity of Provider keys, workspaces, memory, mission state, and collaboration logs.

## Current Canonical State - 2026-06-20

This workspace is now the only canonical source for Orbit development:

- Source root: `/Users/gao90098/Desktop/AgentForge-MissionControl`
- Public project: `https://github.com/gaowei90098-creator/orbit-agent-workbench`
- Contact: `gaowei90098@gmail.com`
- Runtime entry: `src/main/index.ts` loads `src/main/orbit-runtime.cjs`.
- Build sync: `npm run build` runs `electron-vite build` and then `scripts/sync-orbit-runtime.mjs`, copying the canonical runtime to `out/main/orbit-runtime.cjs`.
- EvoMap integration is in the canonical runtime and must stay active:
  - `EVOMAP_MCP_ENDPOINT = "https://evomap.ai/mcp"`
  - OAuth endpoints: `/oauth/evomap/start`, `/oauth/evomap/callback`, `/oauth/evomap/status`, `/oauth/evomap/probe`
  - planner preflight: `buildEvoMapPlannerContext`
  - self-evolution gene: `gene:evomap-preplanning`
- Active product agents are `Codex CLI`, `Claude Code`, and `Hermes`.
- `OpenClaw`, `Marvis`, and `MiniMax Code` are disabled product agents and must not appear in the primary UI or execution pool.
- Relay / handoff mode means one user-selected Agent runs at a time. It is not parallel orchestration.
- Orchestration mode is led by the Orbit main Agent. Orbit should understand the goal, consult memory/EvoMap, generate bounded contracts, dispatch workers, verify evidence, and synthesize deliverables.
- Desktop delivery rule: after any app-affecting source/runtime/UI/asset/config/package/dependency change, do not stop at source edits. Run validation, `npm run build`, `npm run unpack`, replace `/Users/gao90098/Desktop/Orbit.app` with `dist/mac-arm64/Orbit.app`, ad-hoc sign it, verify codesign, and report whether the packaged desktop app was relaunched/checked. The user opens the Desktop app directly, so stale packaging is a release blocker.

## North Star

AgentForge Mission Control is the working codename for turning AgentHub into a main Agent / Orchestrator for project collaboration.

The user goal is not a multi-model chat shell. The product should accept a project goal, decompose it into aligned work units, dispatch sub-agents, coordinate their work, verify outputs, and synthesize the final result.

Core loop:

1. User gives a project goal.
2. Main Agent reads project context and memory.
3. Main Agent creates a task DAG with bounded task contracts.
4. Sub-agents claim or receive tasks and execute in local workspaces.
5. Shared coordination layer keeps task ownership, file scope, interface contracts, messages, and outcomes aligned.
6. Supervisor detects blockers, syncs results, asks for rescue/rework, and drives final verification.
7. Main Agent produces the final acceptance summary.

## Architecture Commitments

- Keep the Orbit Electron + React glass UI as the product shell.
- Preserve local CLI execution as the preferred worker route for Codex CLI and Claude Code. API providers are optional, not the primary path.
- Do not let sub-agents share raw full chat history by default. Each worker keeps private execution history; only task outcomes, blockers, contract changes, verification results, and lessons are promoted to shared memory.
- Every sub-agent task must include a task contract: title, detail, file scope, done criteria, verify command, and interface/design contract reference.
- Memory is layered:
  - STM: active mission context, task DAG, current workers, recent decisions, route context.
  - Episodic LTM: past mission/dispatch outcomes, failures, repairs, verification results, lessons.
  - Semantic/procedure LTM: project conventions, agent capabilities, reusable commands, operating rules, architectural decisions.

## Reference Guidance

- Microsoft multi-agent reference architecture: use STM/LTM separation and episodic memory pattern.
- open-multi-agent: use goal -> task DAG -> parallel execution -> synthesis as the planning model.
- Agent Squad / SupervisorAgent: use classifier global view plus worker-private histories; treat workers as tools available to a lead agent.
- LangGraph Supervisor: handoff tools are a useful reference for structured delegation.

## 2026-06-18 Session Changes

Branch: `codex/orbit-agenthub-pivot`

Changed files:

- `src/main/providers/manager.ts`
  - Bumped provider config schema to v2.
  - Default Codex and Claude bindings now use `stdio-plain` local CLI mode.
  - Added migration from old default HTTP bindings to local CLI mode.

- `src/renderer/glass/connection-status.ts`
  - Treat empty StdIO binary as auto-detect instead of "not installed".
  - Updated ready/help text to explain local CLI login-state dispatch.

- `src/main/index.ts`
  - Added local CLI environment preparation for packaged/double-click launches.
  - Prepends Homebrew/npm/local/cargo paths to `PATH`.
  - Reads Claude Code subscription token from `~/.agenthub-oauth-token` or `~/.orbit-oauth-token`.
  - Seeds core architecture memories into runtime memory.
  - Records every dispatch outcome into episodic memory.

- `src/main/hub/agent-locator.ts`
  - Added macOS Codex.app CLI discovery at `/Applications/Codex.app/Contents/Resources/codex`.
  - Added non-Windows cargo path fallback for `~/.cargo/bin/codex`.

- `src/main/memory-library.ts`
  - Added memory categories: `episodic`, `semantic`, `procedure`, `decision`.

- `src/main/hub/agent-runtime.ts`
  - Prioritizes semantic/procedure/episodic/decision memories when selecting prompt context.

- `src/main/hub/orchestrator.ts`
  - Main Agent decomposition prompt now asks for task contracts.
  - `PlanSubtask` now supports `fileScope`, `doneWhen`, `verifyCommand`, and `interfaceRef`.
  - Added `subtaskContractPrompt()` so workers receive bounded execution specs.

- `src/main/hub/dispatcher.ts`
  - Streams task contract metadata in `orchestrate:plan`.
  - Sends contract prompts to sub-agents instead of vague subtask text.

- `src/main/hub/agent-detector.ts`
  - Switched CLI probing to quiet cross-platform `execFileSync`.
  - Uses `which` on macOS/Linux and `where` only on Windows, so packaged launches do not print shell noise for missing optional CLIs.

- `src/main/hub/adapters/acp-client.ts`
  - Fixed macOS `/var` vs `/private/var` workspace containment checks by comparing lexical and real paths safely.

- `src/main/hub/__tests__/mock-codex.js`
  - Added executable shebang and execute bit so adapter tests run the mock Codex script correctly.

- `src/renderer/glass/connection-status.test.ts`
  - Updated connection-status expectations for auto-detected local StdIO CLI mode.

- `README.md`
  - Repositioned the project as a main-Agent dispatch workbench rather than a generic multi-model chat shell.
  - Documented local CLI priority, task contracts, and layered Memory direction.

- `AGENTS.md`
  - Added a handoff rule for future coding agents: read this Memory before changing code and preserve the main-Agent north star.

Desktop delivery:

- Built app copied to `/Users/gao90098/Desktop/AgentHub.app`.
- Source handoff first copied to `/Users/gao90098/Desktop/AgentHub-MainAgent`.
- Source handoff was renamed/moved to `/Users/gao90098/Desktop/AgentForge-MissionControl` as the future workspace.
- Old `/Users/gao90098/Desktop/Orbit.app` was moved to Trash as `Orbit.app.deleted-2026-06-18`.
- The older `/Users/gao90098/Desktop/AgentHub` source directory was not deleted because it is a separate repo with active worker processes and may still contain prior work.

Validation:

- `npm run typecheck` passed.
- `npm test` passed: 28 test files, 155 tests.
- `npm run build` passed.
- `npm run unpack` passed and produced `dist/mac-arm64/AgentHub.app`.
- Desktop app was ad-hoc signed with `codesign --force --deep --sign -`.
- `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/AgentHub.app` passed.
- Foreground desktop launch verified Hub startup on `ws://127.0.0.1:9527` and proxy startup on `http://127.0.0.1:9528/v1`.
- Normal macOS `open /Users/gao90098/Desktop/AgentHub.app` launch also passed; the app process stayed alive and listened on ports 9527 and 9528.

## 2026-06-18 Main Agent Workflow Slice

User-requested order was implemented in this sequence:

1. Main Agent plan artifact format.
2. Episodic memory store.
3. Classifier global STM.
4. Supervisor rules + optional lightweight LLM judgment.
5. AgentHub UI plan-confirmation workflow.

Changed files:

- `src/main/hub/plan-artifact.ts`
  - Added first-class `PlanArtifact`, `TaskDAG`, `TaskContract`, `TaskContractStatus`.
  - Supports preferred `taskDag.nodes` JSON and legacy `subtasks` JSON.
  - Normalizes file scope, dependencies, done criteria, verify command, interface reference, status, and DAG edges.

- `src/main/hub/mission-store.ts`
  - Added JSON-backed mission store under app userData `missions/mission-state.json`.
  - Persists plans, mission outcomes, and global STM.
  - Provides planner context from recent outcomes and router context from active mission.

- `src/main/hub/supervisor.ts`
  - Added rule-first Supervisor decisions for dependency wait, verification failure, worker error, and stalls.
  - Calls optional lightweight LLM only for ambiguous stall/handoff cases.
  - Parses bounded JSON decisions.

- `src/main/hub/orchestrator.ts`
  - Decomposition prompt now asks for `taskDag.nodes` and `dependsOn`.
  - Lead Planner prompt receives recent episodic mission context.
  - `parsePlan()` now returns normalized task contracts backed by a PlanArtifact.

- `src/main/hub/dispatcher.ts`
  - Orchestrate mode now creates a mission id and PlanArtifact before worker execution.
  - PlanArtifact is persisted to MissionStore.
  - Supports `requirePlanApproval`: plan is emitted, UI can approve/reject, workers start only after approval.
  - Executes tasks by DAG waves: no-dependency tasks run in parallel; dependent tasks wait.
  - Records task status transitions into MissionStore.
  - Emits `orchestrate:supervisor` decisions.
  - Records mission outcomes with summary, blockers, lessons, verification flag, and failed task ids.

- `src/main/hub/router.ts` and `src/main/hub/route-preview.ts`
  - Router accepts global mission STM.
  - Route scoring combines the current sentence with active mission goal, pending contracts, and recent decisions.

- `src/main/index.ts`
  - Initializes `MissionStore` and `Supervisor`.
  - Passes MissionStore into Dispatcher.
  - Route preview now uses active mission STM.
  - Added IPC for `hub:approvePlan` and mission queries.
  - Runtime episodic memory now includes mission/plan metadata in dispatch outcome entries.

- `src/preload/index.ts` and `src/renderer/vite-env.d.ts`
  - Exposed `hub.approvePlan()`.
  - Exposed mission read APIs for future diagnostics panels.
  - `hub.dispatch()` now accepts `requirePlanApproval`.

- `src/renderer/glass/orchestrate-reducer.ts`
  - Added `awaiting-approval` phase.
  - Stores task id, mission id, plan artifact, file scope, dependencies, verification command, and interface reference.

- `src/renderer/glass/orchestrate-view.tsx`
  - Displays task contracts with scope/dependencies/verify/interface metadata.
  - Shows Approve/Reject controls before worker launch.

- `src/renderer/screens/Chat.tsx`
  - Orchestrate mode button now says "生成流程".
  - Orchestrate messages render the plan/mission view instead of ordinary agent bubbles.

- `src/renderer/App.tsx`
  - Orchestrate dispatch now requests plan approval.
  - Approve/Reject buttons call `hub.approvePlan()`.

- Tests added/updated:
  - `src/main/hub/__tests__/plan-artifact.test.ts`
  - `src/main/hub/__tests__/mission-store.test.ts`
  - `src/main/hub/__tests__/supervisor.test.ts`
  - `src/main/hub/__tests__/router.test.ts`
  - `src/renderer/glass/orchestrate-reducer.test.ts`

Validation:

- `npm install` was run because this new Desktop workspace did not include `node_modules`.
- `npm run typecheck` passed.
- `npm test` passed: 31 test files, 164 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- `/Users/gao90098/Desktop/AgentHub.app` was overwritten with the new packaged app.
- Desktop app was ad-hoc signed and `codesign --verify --deep --strict --verbose=2` passed.
- Normal `open /Users/gao90098/Desktop/AgentHub.app` launch passed; the app stayed alive and listened on ports 9527 and 9528.

## Current State

The main Agent workflow now has a real backend skeleton:

- AgentHub defaults toward local CLI sub-agents.
- Runtime memory has typed categories for main-agent coordination.
- Dispatch outcomes are promoted into episodic memory.
- Main Agent orchestration produces a persisted PlanArtifact / TaskDAG / TaskContract set.
- Lead Planner reads recent mission outcomes before planning.
- Router can use active mission STM, not just the current sentence.
- Supervisor emits rule-first decisions and can ask a lightweight LLM in ambiguous stall cases.
- Chat UI now follows "generate collaboration plan -> user confirms -> workers run -> live summary".
- Desktop handoff exists at `/Users/gao90098/Desktop/AgentForge-MissionControl`; future coding work should start there.
- User-facing app bundle exists at `/Users/gao90098/Desktop/AgentHub.app`.

## 2026-06-19 Workspace Conversations + Custom Model IDs

User asked Orbit to behave more like Codex: every project/workspace should have its own conversations, with a visible "新对话" entry and conversation history grouped under each workspace. User also reported that custom Providers only allowed selecting a supplier but not entering a model name, causing HTTP 404 against relays/middlewares.

Changed files:

- `src/renderer/App.tsx`
  - Replaced global `messages/tasks` runtime state with `conversations[]`.
  - Each conversation now has `workspaceId`, `title`, `messages`, `tasks`, timestamps, and an active conversation id.
  - Legacy `messages/tasks` runtime snapshots are migrated into a conversation automatically.
  - Switching workspace selects that workspace's latest conversation or creates a fresh one.
  - Stream events now bind backend `taskId` to `conversationId`, so long-running agent output does not jump to another project if the user switches workspaces.
  - New conversation / workspace / conversation selection handlers were added and passed to Sidebar and Chat.

- `src/renderer/glass/Sidebar.tsx`
  - Added a Codex-like sidebar structure:
    - `新对话` primary action.
    - compact overview/tasks/settings buttons.
    - workspace folders with conversation rows and relative timestamps.
    - each workspace keeps its own visible conversation list.
  - Sidebar now uses the Orbit icon and wider layout for conversation titles.

- `src/renderer/screens/Chat.tsx`
  - Removed local duplicated workspace state.
  - Chat now receives the active workspace and workspace picker from App, so the top toolbar and sidebar always agree.

- `src/main/memory-library.ts`
  - Runtime Memory snapshots now persist `conversations`, `activeConversationId`, and `activeWorkspaceId`.
  - Conversation-level runtime entries are written into the Memory catalog; task entries remain separate.
  - Running work is still normalized to cancelled on restore, now inside each conversation too.

- `src/renderer/vite-env.d.ts`
  - IPC Memory state types now include conversations and active ids.

- `src/renderer/screens/Settings.tsx`
  - Custom Provider creation now requires a `Model ID`.
  - Custom Provider cards can manually add model IDs after creation.
  - This avoids relying on `/models` for relays that do not implement model listing and prevents blank-model routing/404 failures.

- `README.md`
  - Rewritten as Orbit README rather than AgentForge/AgentHub positioning.
  - Documents workspace-isolated conversations, Orbit main-Agent loop, and custom Provider Model ID requirements.

- `src/renderer/index.html`
  - Browser/Electron document title changed from AgentHub to Orbit.

- `AgentHub UI设计/` and `docs/UI对比报告.md`
  - Removed legacy prototype screenshots and the old visual comparison report so the GitHub repo no longer presents the previous AgentHub UI direction as the current product visual.

- `electron.vite.config.ts`
  - Removed the old design-package icon sync step. Orbit now uses committed renderer icon assets directly.

Desktop delivery:

- Rebuilt and replaced `/Users/gao90098/Desktop/Orbit.app`.
- The app was ad-hoc signed and verified.
- Normal launch succeeded; Orbit listened on `127.0.0.1:9527` and `127.0.0.1:9528`.
- Visual screenshot checked at `/tmp/orbit-ui-check.png`: sidebar shows New Chat, workspace folders, and per-workspace conversations without obvious overlap.

Validation:

- `npm run typecheck` passed.
- `npm test` passed: 34 test files, 175 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app` passed.

GitHub publish:

- Legacy upstream reference was retained only during the early migration; the active public project is now `https://github.com/gaowei90098-creator/orbit-hub`.
- Added `orbit` remote: `https://github.com/gaowei90098-creator/orbit-hub.git`.
- Pushed direct snapshot branch: `codex/orbit-agenthub-pivot`.
- Created common-history PR branch based on `orbit-hub/main`: `codex/orbit-agenthub-pivot-pr`.
- User clarified they wanted a direct GitHub update, not a PR.
- Directly updated `gaowei90098-creator/orbit-hub` `main` from `codex/orbit-agenthub-pivot-pr`.
- GitHub auto-marked draft PR `https://github.com/gaowei90098-creator/orbit-hub/pull/2` as merged because `main` now points at the PR branch commit.
- Deleted the temporary remote branch `codex/orbit-agenthub-pivot-pr`; retained direct snapshot branch `codex/orbit-agenthub-pivot` for reference.

This is not yet the full Orbit coordination engine. Missing pieces:

- Full task claim/soft lock/contract board inside this AgentHub codebase.
- Rich Mission/Memories diagnostics UI.
- Worktree isolation and integration/verification flow from the old Orbit code.
- Real handoff/rescue execution when Supervisor decides `handoff` rather than only emitting the decision.
- Project-level acceptance gate that runs final verification commands across worker outputs.

## Next Recommended Work

1. Add a visible Mission Control panel: current PlanArtifact, TaskDAG, outcomes, STM, and Supervisor decisions.
2. Add task claim/soft lock/contract board semantics so workers can explicitly claim and update contracts.
3. Add worktree-based execution so sub-agents do not collide in the same project tree.
4. Implement Supervisor handoff/rescue execution for `handoff` decisions.
5. Add a project-level final verification gate before mission outcome is marked verified.

## 2026-06-18 OpenAgents Collaboration Bus Integration

User asked to clone and inspect `openagents-org/openagents`, then reuse suitable collaboration architecture in AgentForge because the current multi-agent collaboration had serious coordination gaps.

Reference repo:

- Initially cloned to `/Users/gao90098/Desktop/AgentForge-MissionControl/reference_repos/openagents`.
- Later organized under `/Users/gao90098/Desktop/AgentForge-MissionControl/reference_repos/collaboration-frameworks/openagents`.
- Commit inspected: `45abec586df5761da08aa042d4f6ccbe7370d28b`.
- License: Apache-2.0.
- Added `reference_repos/` to `.gitignore`; this repo is local reference material, not AgentForge source.

Useful OpenAgents patterns adopted:

- ONM event envelope: collaboration is represented as durable events, not scattered ad hoc state.
- ONM addressing: `agent:codex`, `human:user`, `channel/mission-id`, `resource/context/name`, `core`.
- Mod pipeline shape: `guard -> transform -> observe`, with priority ordering and side-effect events.
- Project/task mod concepts: project lifecycle, agent-specific state, task delegation lifecycle, artifact/outcome events.

Implemented in AgentForge:

- Added `src/main/hub/collaboration-events.ts`.
  - Defines `CollaborationEvent`, `CollaborationAddress`, visibility, event type constants, address helpers, event creation, and reply creation.
  - Supports bare agent names, local/cross-network scope, channels, resources, core, broadcast.

- Added `src/main/hub/collaboration-bus.ts`.
  - JSON-backed event log under app userData `collaboration/events.json`.
  - Provides `CollaborationPipeline` with `guard`, `transform`, and `observe` mods.
  - Persists processed events and observer side-effect events.
  - Supports event queries by mission, channel, source, target, exact type, type prefix, and mission timeline rendering.

- Updated `src/main/hub/dispatcher.ts`.
  - Dispatcher now accepts optional `CollaborationBus`.
  - Orchestrate flow records durable collaboration events for:
    - mission started
    - plan proposed
    - plan approval requested / approved / rejected
    - mission status changed
    - contract created
    - contract claimed
    - contract status changed
    - contract completed / failed
    - verification result
    - supervisor decision
    - synthesis started / completed
    - outcome recorded
  - Event payloads intentionally use lightweight contract snapshots and output previews to avoid polluting memory with full stream output.

- Updated `src/main/index.ts`.
  - Initializes `CollaborationBus` from app userData and passes it into Dispatcher.
  - Adds IPC:
    - `collaboration:events`
    - `collaboration:timeline`
  - Startup order changed so proxy and WebSocket Hub start before `detectAgentsAsync()`.
  - Agent detection now runs in the background, preventing slow provider health checks from blocking ports `9527` and `9528`.

- Updated `src/preload/index.ts` and `src/renderer/vite-env.d.ts`.
  - Exposes `electronAPI.collaboration.events()` and `electronAPI.collaboration.timeline()`.

- Updated `vitest.config.ts`.
  - Excludes `reference_repos/**` so cloned reference repositories do not pollute AgentForge test discovery.

- Added tests:
  - `src/main/hub/__tests__/collaboration-events.test.ts`
  - `src/main/hub/__tests__/collaboration-bus.test.ts`
  - Tests cover ONM-style address parsing, event defaults/replies, guard rejection, transform/observe ordering, side-effect persistence, and mission timeline output.

Validation:

- `npm run typecheck` passed.
- `npm test` passed: 33 test files, 170 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- `/Users/gao90098/Desktop/AgentHub.app` was overwritten with the new packaged app.
- Desktop app was ad-hoc signed and `codesign --verify --deep --strict --verbose=2` passed.
- Real app launch passed after fixing startup order:
  - process: `/Users/gao90098/Desktop/AgentHub.app/Contents/MacOS/AgentHub`
  - WebSocket Hub: `127.0.0.1:9527` listening
  - local proxy: `127.0.0.1:9528` listening

Current collaboration state:

- AgentForge now has a durable collaboration event backbone.
- MissionStore still owns plan/outcome/STM snapshots.
- CollaborationBus now owns the append-only mission event history.
- This directly supports the next UI step: a Mission Control panel that reads event history and shows who claimed what, what changed, what failed, what Supervisor decided, and what outcome was recorded.

Next recommended work:

1. Build a Mission Control UI panel using `collaboration:events` / `collaboration:timeline`.
2. Add explicit worker claim/soft-lock actions from UI and worker runtime, backed by collaboration events.
3. Add shared artifact events (`project.artifact.set/list/get`) so sub-agents can exchange concrete files/results through the bus.
4. Connect Supervisor `handoff` decisions to an actual rescue/handoff execution path.
5. Add final acceptance gate that reads MissionStore + CollaborationBus before marking a mission verified.

## 2026-06-18 Reference Repo Library Cleanup

User asked to put all cloned reference material into the new AgentForge folder, categorize it clearly, and write the change into project memory so Claude Code can read it cleanly next time.

Current reference repo library:

- Root: `/Users/gao90098/Desktop/AgentForge-MissionControl/reference_repos`
- Catalog: `/Users/gao90098/Desktop/AgentForge-MissionControl/reference_repos/CATALOG.json`
- Human entry point: `/Users/gao90098/Desktop/AgentForge-MissionControl/reference_repos/README.md`

Categories created:

- `reference_repos/collaboration-frameworks/`
  - Full multi-agent collaboration/workspace frameworks.
  - Contains `openagents`.

- `reference_repos/memory-architectures/`
  - Placeholder for STM / episodic LTM / semantic-procedural memory references.
  - Has README explaining current AgentForge memory files.

- `reference_repos/routing-supervisor-patterns/`
  - Placeholder for classifier/router/supervisor/handoff references.
  - Has README pointing to current AgentForge router/supervisor implementation.

- `reference_repos/task-delegation-patterns/`
  - Placeholder for task contract / DAG / claim / progress / result handoff references.
  - Has README pointing to current AgentForge task contract and collaboration bus files.

Moved:

- `reference_repos/openagents`
- to `reference_repos/collaboration-frameworks/openagents`

Index files added inside the ignored `reference_repos/` folder:

- `README.md`
- `CATALOG.json`
- `collaboration-frameworks/README.md`
- `memory-architectures/README.md`
- `routing-supervisor-patterns/README.md`
- `task-delegation-patterns/README.md`

Important note:

- `reference_repos/` remains ignored by git and excluded from Vitest discovery.
- These files are still present locally in the workspace for Claude Code/Codex reading.
- Future cloned repos should go into the relevant category folder and be added to `reference_repos/CATALOG.json`.

## 2026-06-18 OpenAgents Compatibility Bridge

User clarified that the OpenAgents repo already contains many required features and asked whether it can be embedded directly, with compatibility guaranteed.

Decision:

- Do not keep rewriting OpenAgents features from scratch.
- Treat OpenAgents as a sidecar collaboration engine.
- Keep AgentForge as the main Agent / Mission Control orchestration shell.
- First direct-embed target is `packages/agent-connector`, because it is Node-based and fits Electron better than embedding the Python SDK or Next workspace frontend first.

Compatibility principles:

- AgentForge must not import OpenAgents CommonJS modules directly into Electron main.
- Use subprocess boundaries for `agn` / `agent-connector`.
- Use an isolated AgentForge-owned OpenAgents config directory, not default `~/.openagents`.
- Prefer the categorized local clone under `reference_repos/collaboration-frameworks/openagents`.
- Fallback to `OPENAGENTS_LAUNCHER_BIN` or `agn` on PATH.
- Disable OpenAgents update checks from embedded calls with `OPENAGENTS_SKIP_UPDATE_CHECK=1`.
- Keep OpenAgents tests/reference source excluded from AgentForge Vitest discovery.

Implemented:

- Added `src/main/openagents/bridge.ts`.
  - Discovers OpenAgents launchers in this order:
    1. `OPENAGENTS_LAUNCHER_BIN` / explicit launcher option.
    2. Local reference clone: `reference_repos/collaboration-frameworks/openagents/packages/agent-connector/bin/agent-connector.js`.
    3. `agn` from PATH.
  - Uses `node <agent-connector.js>` for JS launchers.
  - Uses raw command execution for configured/native commands.
  - Adds `--config <AgentForge userData>/openagents` automatically when missing.
  - Supports compatibility report with checks for Node version, launcher discovery, config isolation, package version, and launcher response.
  - Exposes supported OpenAgents commands for future UI integration.

- Added IPC in `src/main/index.ts`:
  - `openagents:compatibility`

- Added preload/type exposure:
  - `window.electronAPI.openagents.compatibility()`

- Added tests:
  - `src/main/openagents/__tests__/bridge.test.ts`
  - Tests verify local categorized reference discovery, isolated config injection, endpoint env propagation, and compatibility reporting.

Local compatibility result:

- Selected launcher:
  `/Users/gao90098/Desktop/AgentForge-MissionControl/reference_repos/collaboration-frameworks/openagents/packages/agent-connector/bin/agent-connector.js`
- Package version:
  `0.2.143`
- Compatibility:
  passed
- Checks passed:
  - Node version >= 18
  - launcher discovered
  - config directory isolated
  - package version read
  - launcher `version` command responds

Validation:

- `npm run typecheck` passed.
- `npm test` passed: 34 test files, 173 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- `/Users/gao90098/Desktop/AgentHub.app` was overwritten, ad-hoc signed, verified with `codesign --verify --deep --strict --verbose=2`, relaunched, and confirmed listening on `127.0.0.1:9527` and `127.0.0.1:9528`.

Next recommended direct-embed steps:

1. Add a hidden or settings-level OpenAgents compatibility panel showing selected launcher, version, config dir, endpoint, and warnings.
2. Add safe UI actions around the bridge:
   - `agn status`
   - `agn list`
   - `agn runtimes`
   - `agn workspace list`
   - later `agn create`, `agn up`, `agn connect`
3. Map AgentForge provider/agent cards to OpenAgents agent types.
4. Add Workspace sidecar connection:
   - use OpenAgents workspace API/client for shared threads, files, browser, todos, timers, notifications, knowledge.
5. Convert AgentForge `TaskContract` events into OpenAgents workspace messages/tasks/artifacts, instead of only storing them locally.

## 2026-06-18 React Bits UI Refresh

User asked to clone `DavidHDev/react-bits` into the new AgentForge folder and use the best-looking, best-fitting UI patterns because the existing plugins/UI felt too rough.

Reference repo:

- Cloned to `/Users/gao90098/Desktop/AgentForge-MissionControl/reference_repos/ui-component-libraries/react-bits`.
- Commit: `d352289208f986ca14a1a2b4db937004955114b0`.
- License: MIT + Commons Clause License Condition v1.0.
- Compatibility finding:
  - The repo targets React 19.
  - It brings heavy visual dependencies including `motion`, `gsap`, `three`, `ogl`, and `@react-three/*`.
  - AgentForge renderer currently uses React 18, so this pass did not import the full component repo or add the heavy dependency graph.
  - The license permits use as part of an application/product, but the components must not be redistributed as a standalone component library or bundle.

Adopted UI direction:

- Use a restrained mission-control look instead of landing-page animation.
- Borrowed compatible patterns from React Bits:
  - `SpotlightCard` hover focus.
  - `ShinyText` brand sheen.
  - Grid/dot operational background patterns.
- Avoided Three/GSAP/cursor/showcase effects because they distract from the main Agent workflow and risk Electron/React compatibility issues.

Implemented:

- Added `src/renderer/glass/react-bits.tsx`.
  - `SpotlightPanel`: dependency-free React 18-compatible spotlight panel.
  - `ShinyText`: dependency-free shiny text effect.

- Updated `src/renderer/globals.css`.
  - Replaced blurred blob background with structured mission-grid background.
  - Tightened design tokens to 6-8px radius for operational UI.
  - Restyled buttons, segmented controls, chips, chat bubbles, and panels.
  - Added React Bits-inspired local classes:
    - `.rb-spotlight`
    - `.rb-command-surface`
    - `.rb-composer`
    - `.rb-table`
    - `.rb-shiny`

- Updated core renderer surfaces:
  - `src/renderer/App.tsx`
    - Uses `ah-backdrop-grid` instead of old blob node.
  - `src/renderer/glass/Titlebar.tsx`
    - Visible brand now reads `AgentForge / Mission Control` while the packaged app name remains `AgentHub.app` for now.
    - Uses `ShinyText`.
  - `src/renderer/glass/Sidebar.tsx`
    - Uses `SpotlightPanel`.
    - Navigation and agent rows now use sharper active states.
  - `src/renderer/screens/Home.tsx`
    - Home now presents as `AgentForge Mission Control`.
    - Budget panel, first-run panel, and agent cards use spotlight surfaces.
    - Recent tasks use the new table surface.
  - `src/renderer/screens/Chat.tsx`
    - Toolbar and composer now use command/composer surfaces.
    - Blocked configuration warning uses spotlight focus.
  - `src/renderer/screens/Tasks.tsx`
    - Task rows use spotlight table surfaces.
  - `src/renderer/glass/orchestrate-view.tsx`
    - PlanArtifact / TaskDAG / TaskContract view now presents as a collaboration workflow panel.
  - `src/renderer/glass/ui.tsx`
    - Task status badge radius tightened.

- Updated local reference repo docs:
  - `reference_repos/README.md`
    - Added `ui-component-libraries/` category.
    - Updated rule to allow direct use only after explicit license and compatibility checks.
  - `reference_repos/CATALOG.json`
    - Added `react-bits` metadata, compatibility notes, selected source files, adopted patterns, and AgentForge files touched.
  - `reference_repos/ui-component-libraries/README.md`
    - Added read-first notes, compatibility notes, license constraints, and adopted patterns.

Validation:

- `npm run typecheck` passed.
- `reference_repos/CATALOG.json` parsed successfully.
- `npm test` passed: 34 test files, 173 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- `/Users/gao90098/Desktop/AgentHub.app` was overwritten with the new packaged app.
- Desktop app was ad-hoc signed and `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/AgentHub.app` passed.
- Normal macOS `open /Users/gao90098/Desktop/AgentHub.app` launch passed.
- App process stayed alive and listened on:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`

Next recommended UI work:

1. Add a dedicated Orbit mission timeline panel that visualizes CollaborationBus events.
2. Add an OpenAgents compatibility/status panel in Settings.
3. Add task claim/soft-lock board UI so workers can explicitly claim or release TaskContracts.
4. Consider a later protocol/appId migration only after preserving existing `agenthub` userData and deep-link compatibility.

## 2026-06-18 Orbit Naming, Aurora Background, Visible Main Agent

User feedback:

- The hard grid background looked bad and too much like an engineering debug surface.
- Keep the shiny text effect, but rename the visible product back to `Orbit`.
- Remove the `AgentForge Mission Control` / `任务控制台` naming from the visible UI.
- The main Agent should be explicit: if Orbit is responsible for planning, dispatching and synthesis, it needs a visible model/API Key configuration instead of acting as an invisible worker.

Implemented UI/background changes:

- Added `ogl` as a runtime dependency.
- Added `src/renderer/glass/orbit-aurora.tsx`.
  - Local React 18-compatible Aurora-style background adapted from the local `react-bits` reference.
  - Uses OGL/WebGL for a soft moving aurora instead of the previous hard grid.
- Updated `src/renderer/globals.css`.
  - Removed `ah-backdrop-grid`.
  - Removed the prominent grid background.
  - Added `.orbit-aurora`.
  - Kept subtle texture and dark depth while reducing visual clutter.
- Updated visible branding:
  - `src/renderer/glass/Titlebar.tsx`
    - Badge now shows `O`.
    - Brand text now shows `Orbit` with shiny text.
    - Subtitle is `多智能体工作台` / `Multi-Agent Workspace`.
  - `src/renderer/glass/Sidebar.tsx`
    - Sidebar title is now `Orbit`.
  - `src/renderer/screens/Home.tsx`
    - Main heading is now `Orbit`.
    - Removed `AgentForge 任务控制台` visible wording.
- Updated Electron/package naming:
  - `package.json` productName is now `Orbit`.
  - macOS build output is now `dist/mac-arm64/Orbit.app`.
  - `src/main/index.ts` BrowserWindow title and tray copy now use `Orbit`.
  - `src/main/index.ts` sets app name to `Orbit`.
  - To preserve existing local state after renaming, `src/main/index.ts` sets `userData` to the old `agenthub` app data folder before ProviderManager initializes.

Implemented visible main Agent changes:

- Added main Agent id: `orbit`.
- Updated `src/main/hub/agents.ts`.
  - Added `MAIN_AGENT_ID = 'orbit'`.
  - Added Orbit manifest entry with capabilities:
    - planning
    - routing
    - supervision
    - synthesis
  - Added `WORKER_AGENTS` and `WORKER_AGENT_IDS` helpers.
- Updated `src/renderer/glass/meta.ts`.
  - Added `orbit` display metadata.
  - Added `MAIN_AGENT_ID`.
  - Kept `AGENT_IDS` as worker-only ids so the left sidebar and home worker cards still show the six sub-agents.
  - Added `ROUTING_AGENT_IDS` for settings/connection summaries.
- Updated `src/main/providers/manager.ts`.
  - Default route bindings now include `orbit` as the first binding.
  - Orbit defaults to HTTP provider routing: OpenAI / GPT-4o.
  - This means Orbit requires a usable Provider/API Key unless the user later changes the binding.
- Updated `src/main/hub/dispatcher.ts`.
  - Normal `auto` / `broadcast` dispatch excludes `orbit`; Orbit is not treated as a worker.
  - Orchestrate mode uses `orbit` as the lead planner/verifier/synthesizer when an Orbit binding exists.
  - Worker assignment only uses sub-agents.
  - If Orbit is not configured with a usable model/API Key, orchestrate mode now fails with a clear message:
    `Orbit 主 Agent 尚未配置可用模型/API Key...`
- Updated `src/main/hub/orchestrator.ts`.
  - Lead prompts now identify the lead as `Orbit`, not AgentHub.
- Updated `src/main/hub/agent-detector.ts`.
  - Detection now uses the unified manifest for names/capabilities so Orbit is not mislabeled as a generic tool agent.
- Updated `src/renderer/glass/connection-status.ts`.
  - Connection summaries include Orbit via `ROUTING_AGENT_IDS`.
  - Orbit-specific missing-key and ready text explains that Orbit plans, dispatches, supervises and synthesizes.
- Updated `src/renderer/screens/Home.tsx`.
  - First-run panel now distinguishes:
    - Orbit main Agent readiness.
    - Worker Agent readiness.
  - It no longer treats “any one agent is ready” as enough for the intended Orbit workflow.
- Updated `src/renderer/screens/Settings.tsx`.
  - Routing tab sorts Orbit to the top.
  - Orbit is HTTP/provider-only in the UI; StdIO is disabled for Orbit.
  - Orbit row explains that it handles planning, dispatching, supervision and synthesis.

Reference repo docs updated:

- `reference_repos/ui-component-libraries/README.md`
  - Now documents that Orbit uses the Aurora pattern with `ogl`.
  - Spotlight/Shiny remain dependency-free local rewrites.
- `reference_repos/CATALOG.json`
  - Added `src/renderer/glass/orbit-aurora.tsx`.
  - Updated adopted patterns from Grid/Dot background to Aurora-style OGL background.

Desktop delivery:

- Built app output: `dist/mac-arm64/Orbit.app`.
- Copied to `/Users/gao90098/Desktop/Orbit.app`.
- Removed old `/Users/gao90098/Desktop/AgentHub.app` to prevent launching the wrong version.
- Ad-hoc signed `/Users/gao90098/Desktop/Orbit.app`.
- Launched `/Users/gao90098/Desktop/Orbit.app`.
- Confirmed process:
  - `/Users/gao90098/Desktop/Orbit.app/Contents/MacOS/Orbit`
- Confirmed listening:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`

Validation:

- `npm run typecheck` passed.
- `package.json` parsed successfully.
- `npm test` passed: 34 test files, 173 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app` passed.
- Attempted a local screenshot for visual verification with `screencapture`, but macOS refused to create the capture image in this session.

Current expected user flow:

1. Open `/Users/gao90098/Desktop/Orbit.app`.
2. Go to Settings -> Providers and add/enable a Provider/API Key for the model Orbit should use.
3. Go to Settings -> Routing and confirm the top Orbit row uses the desired Provider/model.
4. Configure one or more worker agents, preferably local CLI for Codex/Claude.
5. In Chat, choose `编排`; Orbit generates the plan first, then the user confirms before sub-agents run.

## 2026-06-18 Hermes/OpenClaw User Bridge Boundary and Memory Hardening

User clarification:

- Hermes and OpenClaw should not be treated as reliable coding/deployment/database-writing workers.
- They should be a user-facing communication layer:
  - notify the user about mission progress,
  - report completion/failure,
  - accept remote user requests/instructions,
  - relay approvals or new requirements back to Orbit.
- The multi-agent core remains:
  user gives project goal -> Orbit understands and decomposes -> execution workers receive bounded contracts -> Orbit verifies/tests -> failures return for repair -> Orbit synthesizes final result.
- Memory must remain strong and explicit so future sessions do not lose role boundaries.

Implemented role boundary:

- Updated `src/main/hub/agents.ts`.
  - `Hermes` capabilities changed to `notify`, `remote-control`, `progress`, `approval`.
  - `OpenClaw` capabilities changed to `notify`, `remote-control`, `progress`, `approval`.
  - Their system prompts now define them as Orbit user communication bridges.
  - They explicitly should not act as coding, deployment, database, or file-writing workers by default.
  - Added `USER_BRIDGE_AGENT_IDS`.
  - Added `EXECUTION_WORKER_AGENT_IDS`.
  - Added `NOTIFICATION_BRIDGE_STORAGE_KEY = orbit.notificationBridge`.
  - Added `DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID = hermes`.
- Execution worker pool is now:
  - Codex CLI
  - Claude Code
  - Marvis
  - MiniMax Code
- Codex / MiniMax route keywords now absorb deployment/script/pipeline-style execution work that used to go to OpenClaw.

Implemented dispatch/orchestration behavior:

- Updated `src/main/hub/orchestrator.ts`.
  - `KNOWN_AGENTS` now comes from `EXECUTION_WORKER_AGENT_IDS`.
  - Orbit planning prompts no longer list Hermes/OpenClaw as execution candidates.
- Updated `src/main/hub/dispatcher.ts`.
  - Normal broadcast uses only execution workers.
  - Auto dispatch uses only execution workers unless the request is clearly a notification/remote/progress request.
  - Direct target dispatch can still target Hermes/OpenClaw for bridge use.
  - Orchestrate mode requires an Orbit main Agent binding.
  - Orchestrate mode requires at least one execution worker.
  - Orchestrate worker assignment excludes Hermes/OpenClaw even if the planner output mentions them.
  - Added `user.notification.requested` collaboration events for:
    - plan proposed,
    - plan rejected,
    - mission running,
    - contract completed,
    - contract failed,
    - contract blocked,
    - mission completed,
    - mission failed.
  - Notification events target the bridge chosen in local store (`orbit.notificationBridge`), defaulting to Hermes.
- Updated `src/main/hub/collaboration-events.ts`.
  - Added `CollaborationEventTypes.UserNotificationRequested`.

Implemented UI behavior:

- Updated `src/renderer/glass/meta.ts`.
  - Hermes display role is now `远程通报`.
  - OpenClaw display role is now `远程通道`.
  - Added renderer-side `USER_BRIDGE_AGENT_IDS`, `EXECUTION_AGENT_IDS`, and notification bridge constants.
- Updated `src/renderer/glass/i18n.ts`.
  - English descriptions now match remote notification / approval relay roles.
- Updated `src/renderer/screens/Home.tsx`.
  - Hermes/OpenClaw cards show a bridge warning instead of looking like ordinary workers.
  - Their primary action label is `远程通道`.
  - First-run readiness checks execution workers only, not Hermes/OpenClaw.
- Updated `src/renderer/screens/Settings.tsx`.
  - Added `用户通报通道` selector in Routing.
  - User can choose Hermes or OpenClaw.
  - The selection is stored in `orbit.notificationBridge`.
  - Agentic one-click local execution banner excludes Hermes/OpenClaw.
  - Routing rows label Hermes/OpenClaw as user notification / remote-instruction bridges excluded from the execution pool.

Implemented memory hardening:

- Added `docs/MEMORY_SYSTEM.md`.
  - Documents STM, episodic LTM, semantic/procedure LTM.
  - Documents promotion rules.
  - Documents execution workers vs user bridges.
  - Documents task contract fields.
- Updated `src/main/index.ts` `seedCoreMemories()`.
  - Added semantic memory:
    `semantic:user-bridge-agent-boundary`.
  - This permanently records that Hermes/OpenClaw are bridges, not execution workers.

Validation:

- `npm run typecheck` passed.
- `npm test` passed: 34 test files, 174 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- Replaced `/Users/gao90098/Desktop/Orbit.app` with `dist/mac-arm64/Orbit.app`.
- Ad-hoc signed `/Users/gao90098/Desktop/Orbit.app`.
- `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app` passed.
- Relaunched `/Users/gao90098/Desktop/Orbit.app`.
- Confirmed process:
  - `/Users/gao90098/Desktop/Orbit.app/Contents/MacOS/Orbit`
- Confirmed listening:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`

Current caveat:

- Notification is now represented as durable collaboration events and UI/store preference.
- Actual external mobile push / remote-control delivery through Hermes/OpenClaw is not yet wired to their real network protocol. The next step is to connect `user.notification.requested` events to the selected bridge runtime.

## 2026-06-18 StdIO Subscription Path and Latest HTTP Model Presets

User clarification/question:

- User asked what Codex CLI / Claude Code `StdIO` means.
- User wants Codex and Claude Code to connect through ChatGPT / Claude paid subscriptions where possible.
- User noticed the HTTP model presets were stale.

Product rule clarified:

- `StdIO` means Orbit spawns the local CLI as a child process and sends the task prompt through stdin or command arguments.
- `StdIO` uses the CLI's own local login/session state.
- `StdIO` does not use Orbit Provider/API Key settings; the UI correctly says Provider/model settings do not apply in StdIO mode.
- For Claude Code, the user should install Claude Code locally and log in with the Claude account/subscription in that CLI.
- For Codex CLI, the user should install/OpenAI Codex locally and sign in with the ChatGPT/OpenAI account supported by the Codex CLI.
- `HTTP` means Orbit directly calls provider APIs with API keys. ChatGPT Plus/Pro and Claude Pro/Max subscriptions are not API keys.
- Orbit main Agent still needs an HTTP Provider/API Key unless a later local main-agent mode is explicitly implemented.

Implemented model updates:

- Updated `src/main/providers/presets.ts`.
  - OpenAI presets now include:
    - `gpt-5.5`
    - `gpt-5.5-pro`
    - `gpt-5.4`
    - `gpt-5.4-pro`
    - `gpt-5.4-mini`
    - `gpt-5.4-nano`
    - `gpt-5.3-codex`
    - `gpt-5.2`
    - legacy `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `o3-mini`, `o4-mini`
  - Anthropic presets now include:
    - `claude-fable-5`
    - `claude-opus-4-8`
    - `claude-sonnet-4-6`
    - `claude-haiku-4-5-20251001`
    - legacy Sonnet/Opus/3.7 entries
- Updated default bindings in `src/main/providers/manager.ts`.
  - OpenAI default is now `gpt-5.5`.
  - Anthropic default is now `claude-sonnet-4-6`.
  - Existing stale official defaults migrate:
    - Orbit/Codex `openai/gpt-4o` -> `openai/gpt-5.5`
    - Claude `anthropic/claude-sonnet-4-5` -> `anthropic/claude-sonnet-4-6`
  - Existing built-in providers now merge newly added built-in models into saved configs, so old user config does not hide new model presets.
- Updated `src/main/providers/client.ts`.
  - GPT-5-family OpenAI models now use OpenAI Responses API (`/responses`) instead of old Chat Completions.
  - Responses API stream handling supports:
    - output text deltas,
    - reasoning text deltas,
    - function-call argument deltas,
    - completed usage,
    - conversion back to existing OpenAI-style `tool_calls` for the agentic loop.
- Updated `src/renderer/glass/meta.ts`.
  - Cost estimate table now includes GPT-5.5 / GPT-5.4 / Claude Fable / latest Opus pricing patterns.

Validation:

- `npm run typecheck` passed.
- `npm test` passed: 34 test files, 175 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- Replaced `/Users/gao90098/Desktop/Orbit.app`.
- Ad-hoc signed and verified `/Users/gao90098/Desktop/Orbit.app`.
- Relaunched Orbit; confirmed PID 4520 and local listeners:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`

User-facing guidance:

- To use membership/subscription auth for workers, keep Codex CLI / Claude Code on `StdIO`, install the local CLIs, and log in through their official CLI flows.
- To use HTTP latest models, configure API keys under Providers and select the model in Routing.
- For latest provider catalogs, users can also click `获取模型` after adding a provider API key.

## 2026-06-18 Orbit Icon Replacement and Compact Chat Controls

User request:

- Replace Orbit icons with the newly designed Orbit icon image supplied by the user.
- The Chat top routing/workspace bar was too cluttered.
- Collapse those controls into a Codex-like function button/menu.

Implemented icon updates:

- Generated new icon assets from the supplied image:
  - `build/icon.png`
  - `build/icon-linux.png`
  - `src/renderer/public/icons/orbit.png`
  - `src/renderer/public/icons/default.png`
- Updated `src/renderer/glass/meta.ts`.
  - Orbit main Agent icon now uses `icons/orbit.png`.
  - Orbit accent color now matches the new violet-blue dot.
- Updated `src/renderer/glass/Titlebar.tsx`.
  - Replaced the old text/letter badge with the new Orbit image.
- Updated `src/renderer/glass/Sidebar.tsx`.
  - Sidebar brand now shows the new Orbit image beside the Orbit name.

Implemented compact Chat controls:

- Updated `src/renderer/screens/Chat.tsx`.
  - Replaced the always-expanded top control row with a compact `功能 / Controls` button.
  - Top row now only shows summary chips:
    - current dispatch mode,
    - target/route prediction,
    - workspace summary.
  - Clicking `功能` opens a glass popover containing:
    - dispatch mode selector,
    - target Agent selector,
    - workspace selector,
    - routing/workspace setup shortcuts.
  - Popover closes on outside click or Escape.
  - Existing behaviors are preserved:
    - active targeted Agent override,
    - route preview hint,
    - workspace persistence,
    - setup actions.

Validation:

- `npm run typecheck` passed.
- `npm test` passed: 34 test files, 175 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- Replaced `/Users/gao90098/Desktop/Orbit.app`.
- Ad-hoc signed and verified `/Users/gao90098/Desktop/Orbit.app`.
- Relaunched Orbit; confirmed PID 12575 and local listeners:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`

Current caveat:

- Windows `build/icon.ico` was not regenerated because this macOS workspace only had `sips/iconutil`, not an ICO writer such as ImageMagick. macOS and in-app visible icons are replaced.

## 2026-06-19 EvoMap Main Agent API Fix and Claude Code Handoff

User request:

- Fix EvoMap HTTP 404 / timeout when connecting the main Orbit Agent.
- Explain which folder Claude Code should use as the continuing workspace and which Memory it should read.

Implemented EvoMap/API fixes:

- Added `src/main/providers/endpoints.ts`.
  - OpenAI-compatible URLs now accept either a base URL such as `https://api.example.com/v1` or a full endpoint such as `https://api.evomap.ai/v1/chat/completions`.
  - Prevents duplicated paths like `/chat/completions/chat/completions`, which caused HTTP 404.
- Updated `src/main/providers/client.ts`.
  - OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages requests now use endpoint helpers instead of naive string concatenation.
- Updated `src/main/providers/manager.ts`.
  - Health check for OpenAI-compatible relays now falls back from `/models` to a tiny `chat/completions` probe.
  - If the user configured a full `chat/completions` URL, health check directly tests that endpoint.
  - `/models` 404/405 no longer blocks a provider that has a manually configured model ID.
- Updated `src/renderer/screens/Settings.tsx`.
  - Provider setup now labels the URL field as `Base URL / 完整接口地址` and documents that a full `chat/completions` URL is valid.
- Added `src/main/providers/__tests__/endpoints.test.ts`.

Local runtime configuration:

- The local Electron config at `/Users/gao90098/Library/Application Support/agenthub/config.json` has the main `orbit` Agent bound to:
  - provider: `evomap` (`custom-1781833326321`)
  - model: `evomap-gpt-5.5`
  - protocol: `http`
- EvoMap API key was preserved in the encrypted local config; do not print it into docs or chat.

Validation completed:

- `npm run typecheck` passed.
- `npm test` passed: 35 test files, 179 tests.
- `npm run build` passed.
- `npm run unpack` passed.
- Replaced `/Users/gao90098/Desktop/Orbit.app`.
- Ad-hoc signed and verified `/Users/gao90098/Desktop/Orbit.app`.
- Relaunched Orbit and confirmed local listeners:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`
- Verified the local proxy `/v1/models` responds.

Claude Code handoff rule:

- Continue future Orbit development from `/Users/gao90098/Desktop/AgentForge-MissionControl`.
- Claude Code should read `/Users/gao90098/Desktop/AgentForge-MissionControl/PROJECT_MEMORY.md` first, then `README.md`, then relevant files under `docs/`.
- Do not use `/Users/gao90098/Desktop/AgentHub` as the active workspace for this Orbit rewrite; it is the older/original workspace and can confuse future agents.
- The packaged app to run is `/Users/gao90098/Desktop/Orbit.app`; the editable source of truth is `/Users/gao90098/Desktop/AgentForge-MissionControl`.

## 2026-06-21 Desktop Packaging Rule Hardening

User clarified that after source changes, clicking `/Users/gao90098/Desktop/Orbit.app` must open the latest build, not a stale previously packaged app.

Updated workspace rules:

- `AGENTS.md` now requires every app-affecting change to complete the desktop delivery loop before stopping.
- `PROJECT_MEMORY.md` Current Canonical State now records stale packaging as a release blocker.
- Required delivery loop:
  - run relevant validation, at minimum `npm run typecheck`;
  - run `npm run build`;
  - run `npm run unpack`;
  - replace `/Users/gao90098/Desktop/Orbit.app` with `dist/mac-arm64/Orbit.app`;
  - run `codesign --force --deep --sign - /Users/gao90098/Desktop/Orbit.app`;
  - run `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app`;
  - relaunch or explicitly report whether relaunch/listener verification was completed.

This rule applies especially to runtime, renderer UI, icon/assets, provider/config, package/dependency, and packaging-script changes. Documentation-only changes still need `PROJECT_MEMORY.md` updated, but only app-affecting changes require replacing the Desktop app bundle.

Next recommended work:

1. For the next code/UI/runtime change, follow the full desktop delivery loop and record the packaged-app verification result here.

## 2026-06-21 Multi-Agent Evidence, Chat Deletion, and EvoMap Status

User request:

- The debate/orchestration flow looked stiff and showed validation failures such as `RESULT为空` even when worker cards had executed.
- Workspace conversation rows had create/new actions but no delete action.
- EvoMap is a sponsor and its MCP/self-evolution integration must be visible and reliably connected.
- Review `OWWZO/ai-agent` and `multica-ai/multica` for better multi-agent architecture patterns.

Reference findings:

- `OWWZO/ai-agent` / Reactor-agent emphasizes Plan-Execute + ReAct, dynamic replanning, parallel subtasks, artifact/workspace registry, MCP registry, RAG, and execution persistence/replay.
- `multica-ai/multica` emphasizes agents as teammates, issue assignment, claim/start/complete/fail lifecycle, blockers, squads, reusable skills, and unified local runtimes.
- Direct source migration was not used in this session: `multica` has modified Apache/commercial embedding restrictions, and the local `OWWZO/ai-agent` clone did not expose a standard license file. Orbit borrowed the architecture patterns, not source code.

Implemented:

- Updated `src/main/orbit-runtime.cjs`.
  - Worker verification now gets an `Orbit 执行事实` evidence section.
  - Orbit scans each contract `fileScope` for concrete artifacts, captures absolute paths, local preview URLs, file size/mtime, and text previews.
  - Activity tails are included when final worker text is empty.
  - Verifier instructions now review artifact/activity evidence instead of failing only because worker final text is empty.
  - Reactor artifact registry now includes scoped artifact preview links, not only web/HTML delivery links.
  - Codex JSON stream parsing now handles nested or alternative `agent_message` content shapes.
- Updated `src/main/hub/adapters/codex-stream-json.ts` and tests.
  - Added nested `agent_message.content[]` extraction coverage.
- Updated `src/renderer/glass/Sidebar.tsx` and `src/renderer/App.tsx`.
  - Each conversation row now has a delete button.
  - Deletion confirms with the user, preserves workspace files, and blocks deletion while the chat has running tasks.
  - After deleting the active chat, Orbit selects the latest remaining chat in the same workspace or creates a fresh chat if needed.
- Updated `src/renderer/screens/Settings.tsx`.
  - Added an EvoMap Self-Evolution MCP status card under Routing.
  - The card refreshes `/oauth/evomap/status`, opens OAuth connect/reconnect, and probes `/oauth/evomap/probe`.
- Updated `vitest.config.ts` and existing tests.
  - Excludes `.claude/**` and `reference_repos/**` from the main test suite.
  - Aligns router/connection tests with the current active Agent set: Codex CLI, Claude Code, Hermes.

Validation:

- `node -c src/main/orbit-runtime.cjs` passed.
- `npm run typecheck` passed.
- `npx vitest run src/main/hub/adapters/__tests__/codex-stream-json.test.ts` passed.
- `npm test` passed: 35 test files, 183 tests.
- `npm run build` passed and synced `src/main/orbit-runtime.cjs` into `out/main/orbit-runtime.cjs`.
- `npm run unpack` passed and produced `dist/mac-arm64/Orbit.app`.
- Replaced `/Users/gao90098/Desktop/Orbit.app`.
- Ad-hoc signed `/Users/gao90098/Desktop/Orbit.app`.
- `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app` passed.
- Relaunched `/Users/gao90098/Desktop/Orbit.app`; confirmed new PID 1437 and listeners:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`
- Verified local endpoints:
  - `/oauth/evomap/status` responds with EvoMap client/scopes/authorize URL, currently `connected:false`.
  - `/v1/models` responds through the local proxy.

Next recommended work:

1. In the new desktop app, open Settings -> Routing and connect/reconnect EvoMap OAuth so `connected:true` before relying on sponsor MCP planning context.
2. Run a small debate mission again and confirm the produced `debate/*.md` artifacts appear in the worker evidence and no longer fail as empty result.
3. Add a dedicated orchestration diagnostics panel for artifact registry, blockers, and handoff capsules so failures are explainable without reading raw cards.

## 2026-06-21 EvoMap OAuth Recovery and Product Architecture Guardrail

User request:

- EvoMap OAuth browser callback showed `EvoMap 授权失败` at `127.0.0.1:9527/oauth/evomap/callback`.
- User emphasized that Orbit must be treated as a coherent product update from source architecture, not a sequence of temporary patches.
- Re-check `OWWZO/ai-agent`, `multica-ai/multica`, and EvoMap sponsor MCP ideas for patterns Orbit should absorb.

Reference findings used for architecture direction:

- `multica-ai/multica` is strongest as a product model for teammate-like agents, issue/task assignment, claim/start/complete/fail lifecycles, blockers, squads, reusable skills, daemon runtime detection, heartbeat, concurrency, and cleanup.
- `OWWZO/ai-agent` / Reactor-agent is strongest as an engineering model for Plan-Execute + ReAct, dynamic replanning, artifact/workspace ledgers, MCP tool registry, RAG/context injection, and replayable execution memory.
- EvoMap docs position Gene, Capsule, EvolutionEvent, capability registry/A2A, sandbox, audit, and replay as a self-evolution layer. Orbit should use EvoMap as an integration/evolution layer, not as a hidden provider toggle.
- Direct source vendoring remains a case-by-case decision. For private local use it can be acceptable if the license allows it, but wholesale copying must still fit Orbit's runtime/UI/data boundaries and should not import an incompatible architecture stack by accident.

Implemented:

- Added `docs/ORBIT_PRODUCT_ARCHITECTURE.md`.
  - Defines Orbit as mission-control/orchestrator, not a multi-model chat shell.
  - Establishes seven product layers: Mission, Contract, Runtime, Evidence, Integration, Memory/Evolution, UI Projection.
  - Records near-term release slices: Integration Health, Evidence-First Verification, Mission Board Stabilization, Runtime Registry, and Evolution Loop.
  - Adds the rule that every feature must declare its owning layer; UI code should not wire directly to ad hoc runtime/provider behavior.
- Updated `src/main/orbit-runtime.cjs`.
  - EvoMap OAuth status now reports explicit health reasons: `not_authorized`, `expired`, `token_unreadable`, or `empty_token`.
  - OAuth callback failures are recorded as `evomap.oauth.lastError` and shown on the local status endpoint instead of collapsing into a vague failure page.
  - OAuth callback page now shows a detailed escaped error body and a retry link.
  - Pending OAuth states are stored as a small bounded multi-state set so repeated browser tabs do not overwrite each other.
  - Added `/oauth/evomap/reset` to clear local EvoMap auth, pending callbacks, last error, and MCP cache.
  - `/oauth/evomap/status` now exposes `connected`, `reason`, `tokenSource`, `tokenError`, `lastError`, `pendingCount`, `clientId`, `mcpEndpoint`, `authorizationEndpoint`, `scopes`, `expiresAt`, and `authorizeUrl`.
- Updated `src/renderer/screens/Settings.tsx`.
  - EvoMap card now surfaces the exact auth reason.
  - Added visible reset auth, reconnect, docs, refresh, and MCP probe controls.
  - Expired or unreadable local tokens now direct the user to reset/reconnect instead of pretending the MCP is connected.

Current EvoMap state after relaunch:

- `/oauth/evomap/status` returns `connected:false`.
- Reason is `expired`.
- `expiresAt` is `2026-06-20T09:47:12.408Z`, which is already expired relative to the current local date.
- `pendingCount` is `1`, so there is one stale/incomplete OAuth callback state from previous attempts.
- Recommended user action in the new desktop app: Settings -> Routing -> `重置授权` -> `连接 EvoMap`.

Validation and desktop delivery:

- `node -c src/main/orbit-runtime.cjs` passed.
- `npm run typecheck` passed.
- `npm test` passed: 35 test files, 183 tests.
- `npm run build` passed and synced `src/main/orbit-runtime.cjs` into `out/main/orbit-runtime.cjs`.
- `npm run unpack` passed and produced `dist/mac-arm64/Orbit.app`.
- Replaced `/Users/gao90098/Desktop/Orbit.app`.
- Ran `codesign --force --deep --sign - /Users/gao90098/Desktop/Orbit.app`.
- Ran `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app`; verification passed.
- Relaunched normally with `open /Users/gao90098/Desktop/Orbit.app`.
- Confirmed new desktop app PID `14019` listens on:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`
- Verified `/oauth/evomap/status` and `/v1/models` respond from the relaunched desktop app.

Next recommended work:

1. Reconnect EvoMap in Settings -> Routing and verify the callback now either succeeds or records a precise `lastError`.
2. Promote the architecture document into implementation slices: integration health store, runtime registry, evidence ledger, task lifecycle, and evolution replay.
3. Add UI diagnostics for mission DAG/evidence/blockers so debate or multi-agent failures are product-visible instead of buried in worker cards.

## 2026-06-21 GitHub Launch Prep for Orbit Agent Workbench

User request:

- Create a new GitHub repository for the product.
- Rewrite the public-facing documentation so the repo explains Orbit's full Agent architecture, Memory system, RAG/retrieval approach, technical stack, product problem, features, Agent relay, Agent collaboration, Claude Code/Codex collaboration, Hermes user bridge, and unified workspace model.
- Make the product positioning stronger and closer to polished open-source agent framework repositories.

Reference README positioning reviewed:

- LangGraph emphasizes long-running, stateful, durable agents with short-term and long-term memory.
- CrewAI emphasizes role-based agent collaboration and event/workflow control.
- Microsoft Agent Framework emphasizes production-grade orchestration, handoff, observability, human-in-the-loop, and provider flexibility.

Implemented:

- Rewrote `README.md` as a public product page for `Orbit`.
  - Positions Orbit as Agent Mission Control, not a multi-model chat shell.
  - Highlights Agent Relay for quota/context exhaustion and model switching.
  - Highlights Agent Collaboration with Orbit main Agent, `PlanArtifact`, `TaskDAG`, and `TaskContract`.
  - Documents Hermes as a user bridge for progress, approvals, and remote instructions.
  - Documents Memory layers: STM, episodic LTM, semantic/procedure memory.
  - Documents RAG/retrieval honestly: local Memory retrieval, workspace artifact/evidence retrieval, EvoMap MCP semantic/reuse context, and room for later local vector indexing.
  - Adds architecture and memory Mermaid diagrams.
  - Adds tech stack, repository map, quick start, usage, roadmap, and license sections.
- Rewrote `docs/HANDOFF.md`.
  - Removed stale AgentHub private-repo and old Windows-machine handoff notes.
  - Replaced it with Orbit's current Agent handoff protocol for Codex CLI / Claude Code / Hermes.
- Updated `.gitignore`.
  - Ignores root-level generated `index.js` and `orbit-runtime.cjs` artifacts.
  - Removed those generated root artifacts from the working tree.
- Updated `package.json` and `package-lock.json`.
  - Package name is now `orbit-agent-workbench`.
  - Homepage, bugs, and repository metadata now point to `https://github.com/gaowei90098-creator/orbit-agent-workbench`.

Publication target:

- New public GitHub repository name: `gaowei90098-creator/orbit-agent-workbench`.
- The repo names `orbit-agent-workbench` and `agentforge-mission-control` were both checked and available before choosing `orbit-agent-workbench`.

Security/publication checks:

- Secret scan over non-ignored source/docs found no real API keys, GitHub tokens, private keys, EvoMap access codes, or safeStorage ciphertext.
- Ignored bulky/local directories remain excluded:
  - `node_modules/`
  - `out/`
  - `dist/`
  - `reference_repos/`
- `docs/HANDOFF.md` was sanitized for public release.

Validation and desktop delivery:

- `npm run typecheck` passed.
- `npm test` passed: 35 test files, 183 tests.
- `npm run build` passed and synced `src/main/orbit-runtime.cjs` into `out/main/orbit-runtime.cjs`.
- `npm run unpack` passed and produced `dist/mac-arm64/Orbit.app`.
- Replaced `/Users/gao90098/Desktop/Orbit.app`.
- Ran `codesign --force --deep --sign - /Users/gao90098/Desktop/Orbit.app`.
- Ran `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app`; verification passed.
- Relaunched normally with `open /Users/gao90098/Desktop/Orbit.app`.
- Confirmed new desktop app PID `20608` listens on:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`
- Verified `/oauth/evomap/status` returns `connected:true`, `tokenSource:"stored-encrypted"`, and `pendingCount:0`.

Next recommended work:

1. Create/push the new `orbit-agent-workbench` GitHub repository from the sanitized current source snapshot.
2. Add screenshots/GIFs to the README after taking polished desktop captures.
3. Add release artifacts once the macOS app is notarized or a non-notarized developer preview policy is documented.

## 2026-06-21 GitHub Launch Final Sync and Workspace Audit

Final public repository:

- URL: `https://github.com/gaowei90098-creator/orbit-agent-workbench`
- Visibility: public
- Default branch: `main`
- Source of truth: `workbench/main` on `gaowei90098-creator/orbit-agent-workbench`
- Latest SHA should be checked with `git ls-remote workbench main` or the GitHub commit page, because updating this memory file creates a new commit.
- CI pipeline was verified passing on GitHub Actions after the launch sync; check the latest run at `https://github.com/gaowei90098-creator/orbit-agent-workbench/actions`.

Implemented after initial publish:

- Added a Chinese project introduction near the top of `README.md`.
  - Highlights Orbit as Agent Mission Control.
  - Explains the product problem: quota exhaustion, broken context, unclear collaboration, unverifiable delivery, and repeated project re-explanation.
  - Highlights Agent relay between Claude Code and Codex CLI.
  - Highlights Agent collaboration through Orbit main Agent, `PlanArtifact`, `TaskDAG`, and `TaskContract`.
  - Explains layered Memory and RAG-like retrieval.
  - Emphasizes EvoMAP MCP integration: Genes, Capsules, Recipes, Assets, semantic reuse context, OAuth status, MCP probe, reset, and pre-planning injection.
- Added `src/main/orbit-runtime.cjs` to the public repo. This file is required by `scripts/sync-orbit-runtime.mjs` during `npm run build`.
- Fixed CI for the new `main` branch:
  - `.github/workflows/ci.yml` now runs on `main` and `master`.
  - `vitest.config.ts` aliases `electron` to `test/electron-stub.ts`, so tests do not depend on downloading a real Electron binary.
  - ESLint ignores `.claude/**`, `reference_repos/**`, and the generated runtime bundle path used as canonical Electron runtime source.
- Updated `AGENTS.md` with public-release instructions:
  - use `workbench` remote for `orbit-agent-workbench`;
  - treat old `origin` / `orbit` remotes as historical only;
  - ignore local `.claude/worktrees`, `reference_repos`, `node_modules`, `out`, and `dist` while auditing published source.

Workspace audit:

- A checksum-based dry-run sync from `/Users/gao90098/Desktop/AgentForge-MissionControl` to `/tmp/orbit-agent-workbench-publish` showed no content differences for publishable files, only timestamp differences.
- Ignored/local-only material is not part of the public source:
  - `.claude/worktrees/`
  - `reference_repos/`
  - `node_modules/`
  - `out/`
  - `dist/`
  - root generated `index.js`
  - root generated `orbit-runtime.cjs`
- Registered local worktrees were inspected.
  - `/private/tmp/orbit-hub-pr-worktree` is clean but belongs to old `orbit-hub` PR work and is not the new release source.
  - `.claude/worktrees/*` are local Claude worktrees. They are old/local-only and ignored from publish. One contains an untracked generated `index.js`; it is not a source change to merge.
- The current working tree remains dirty relative to its older historical git branch, but the publishable file content has been uploaded to the new public repo via the clean release snapshot.
- New sessions should treat `workbench/main` and this `PROJECT_MEMORY.md` entry as the latest public truth, not the older `origin` or `orbit` remotes.

Validation:

- Local validation after the final CI fixes:
  - `npm run typecheck` passed.
  - `npm run lint` passed.
  - `npm test` passed: 35 test files, 183 tests.
  - `npm run build` passed.
  - `npm run unpack` passed.
- Desktop delivery was previously refreshed for the same runtime/app-affecting codebase:
  - `/Users/gao90098/Desktop/Orbit.app` replaced and ad-hoc signed.
  - `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app` passed.
  - Relaunched app PID `25685`.
  - Confirmed listeners `127.0.0.1:9527` and `127.0.0.1:9528`.
  - EvoMAP status returned `connected:true`, `tokenSource:"stored-encrypted"`, `pendingCount:0`.

Next recommended work:

1. In the next chat, start from `/Users/gao90098/Desktop/AgentForge-MissionControl`, read this file first, and target the `workbench` remote / `orbit-agent-workbench` repo.
2. For any future GitHub publish, sync current source into a clean snapshot or align this local git history with `workbench/main` before pushing.
3. Add polished screenshots/GIFs to README and create a GitHub Release once a signed/notarized installer policy is ready.

## 2026-06-21 Orbit Startup Video and Icon Refresh

User request:

- Use `/Users/gao90098/Desktop/微信图片_20260619172247_258_606.jpg` as the new Orbit logo/app icon.
- Use `/Users/gao90098/Desktop/logoA2.zip` video material as the app startup animation.
- Make startup transition smoothly from the animation into the Orbit console.

Implemented:

- Generated new Orbit icon assets from the supplied image:
  - `build/icon.png`
  - `build/icon-linux.png`
  - `build/icon.icns`
  - `src/renderer/public/icons/orbit.png`
  - `src/renderer/public/icons/default.png`
- Updated `package.json` macOS packaging config to use `build/icon.icns`.
- Updated `.gitignore` so `build/icon.icns` is not hidden by the existing `build/*` ignore rule.
- Extracted `logoA2/logoA.mp4` and transcoded it from HEVC 4K to a renderer-friendly H.264 MP4:
  - `src/renderer/public/media/orbit-intro.mp4`
  - 1920x1102, 30fps, 6.47s, about 1.65MB, no audio.
- Updated `src/renderer/App.tsx`.
  - Added `OrbitIntroSplash`, a first-launch overlay that auto-plays the startup video muted.
  - The splash fades out on video end, with timeout/error fallback so Orbit never blocks on media playback.
  - The underlying console starts slightly blurred/dimmed and resolves as the splash exits.
- Updated `src/renderer/globals.css`.
  - Added splash video layout, vignette, fade-out, and console handoff transitions.
- Updated `src/renderer/index.html`.
  - Added explicit `media-src 'self'` CSP permission for packaged local video playback.

Validation and desktop delivery:

- `npm run typecheck` passed.
- `npm test` passed: 35 test files, 183 tests.
- `npm run build` passed and copied `src/main/orbit-runtime.cjs` to `out/main/orbit-runtime.cjs`.
- `npm run unpack` passed and produced `dist/mac-arm64/Orbit.app`.
- Replaced `/Users/gao90098/Desktop/Orbit.app` with `dist/mac-arm64/Orbit.app`.
- Ran `codesign --force --deep --sign - /Users/gao90098/Desktop/Orbit.app`.
- Ran `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app`; verification passed.
- Cold relaunched `/Users/gao90098/Desktop/Orbit.app` after force-ending the old tray process.
- Confirmed new desktop app PID `40337` listens on:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`
- Verified local `/v1/models` and `/oauth/evomap/status`; EvoMap returned `connected:true`, `tokenSource:"stored-encrypted"`, `pendingCount:0`.
- Visual smoke checks:
  - `/tmp/orbit-cold-splash-check.png` captured the startup video overlay.
  - `/tmp/orbit-console-front-check.png` captured the post-splash Orbit console without a blank screen.

Current caveat:

- Windows `build/icon.ico` still has the previous icon because this macOS workspace does not currently include an ICO writer such as ImageMagick. The macOS app icon, Linux icon, tray/runtime PNG, and in-app Orbit/default icons are updated.

Next recommended work:

1. If Windows packaging matters next, install or add an ICO generation path and regenerate `build/icon.ico` from the same source image.
2. Consider adding a Settings appearance toggle later if users want to skip the startup animation on every launch.

## 2026-06-21 Collaborate Mode Product Slice

User guidance:

- Treat external implementation notes as reference only; verify them against Orbit's actual architecture and workspace rules first.
- Product changes must be made from a product-manager perspective, not as narrow patches. Startup stability and coherent user flow matter more than simply wiring a button.

Reference/spec audit:

- Correct: `src/main/orbit-runtime.cjs` is the authoritative desktop runtime; changing only modular `src/main/hub/*.ts` would not change the packaged app.
- Correct: a real collaboration mode needs a shared transcript where workers can respond to prior turns, not just broadcast/chain/orchestrate map-reduce.
- Adjusted: renderer mode selection lives in `src/renderer/screens/Chat.tsx`, not `src/renderer/glass/ui.tsx`.
- Adjusted: Hermes remains a user notification/remote instruction bridge and is not included in the execution collaboration pool.
- Not adopted: no external AutoGen/CrewAI/Multica/Reactor source was imported. Orbit kept its own Dispatcher, CollaborationBus, Memory, and UI contracts.

Implemented:

- Added `collaborate` dispatch mode end-to-end.
- Updated authoritative runtime `src/main/orbit-runtime.cjs`.
  - `dispatch()` now routes `mode === "collaborate"` to `runCollaborate()`.
  - `runCollaborate()` selects executable worker agents only, defaults to Codex + Claude when both are bound, requires at least two workers, and keeps Orbit as the lead synthesizer.
  - `rounds` defaults to 3 and is hard-clamped to 1-6.
  - Each worker turn receives the shared transcript, the most recent peer turn, and a compacted older-history capsule via the existing handoff capsule mechanism.
  - Emits `collaborate:start`, `collaborate:turn`, `collaborate:synthesizing`, `collaborate:final`, and `collaborate:error`.
  - Records collaboration lifecycle events through the existing CollaborationBus using mission/contract/synthesis/outcome event types.
  - Failure is explicit: empty/error worker turns emit a failed turn and abort; Orbit does not synthesize a fake success.
  - WebSocket and IPC dispatch paths now pass `rounds` and `participants`.
- Updated TS mirror/test layer.
  - `src/main/hub/dispatcher.ts` mirrors the `collaborate` mode contract and control flow.
  - `src/main/hub/orchestrator.ts` adds `collabTurnPrompt()` and `collabSynthesisPrompt()`.
  - Added `src/main/hub/__tests__/collaborate.test.ts` to prove second-round prompts include peer prior-turn content and that turn errors do not become completed results.
- Updated renderer.
  - `src/renderer/glass/meta.ts` and `src/renderer/glass/i18n.ts` know the new mode label.
  - Added `src/renderer/glass/collaborate-reducer.ts`.
  - Added `src/renderer/glass/collaborate-view.tsx`, a dedicated round-by-round collaboration timeline with Orbit final conclusion.
  - `src/renderer/App.tsx` aggregates `collaborate:*` events separately and suppresses internal agent stream events so the UI does not duplicate output.
  - `src/renderer/screens/Chat.tsx` adds a `协作 / Collaborate` mode and a simple rounds input. Collaborate mode clears/ignores single-agent targeting by design.
  - `src/preload/index.ts` and `src/renderer/vite-env.d.ts` pass typed `rounds`/`participants` through dispatch options.

Validation completed before packaging:

- `node -c src/main/orbit-runtime.cjs` passed.
- `npm run typecheck` passed.
- `npx vitest run src/main/hub/__tests__/collaborate.test.ts` passed.
- `npm test` passed: 36 test files, 185 tests.

Desktop delivery:

- `npm run build` passed and copied `src/main/orbit-runtime.cjs` to `out/main/orbit-runtime.cjs`.
- `npm run unpack` passed and produced `dist/mac-arm64/Orbit.app`.
- Replaced `/Users/gao90098/Desktop/Orbit.app` with `dist/mac-arm64/Orbit.app`.
- Ran `codesign --force --deep --sign - /Users/gao90098/Desktop/Orbit.app`.
- Ran `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app`; verification passed.
- Cold relaunched `/Users/gao90098/Desktop/Orbit.app`.
- A first normal `open` verification did not show listeners within 32 seconds, so the packaged binary was launched from terminal for diagnostics; Hub and proxy started normally. After force-ending the diagnostic instance and cold-launching via normal `open` again, startup verified.
- Confirmed desktop app PID `50284` listens on:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`
- Verified `/v1/models` responds and `/oauth/evomap/status` returns `connected:true`, `tokenSource:"stored-encrypted"`, `pendingCount:0`.
- Visual smoke check: `/tmp/orbit-collaborate-ui-check.png` captured the post-launch Orbit UI without blank/black startup failure.

Next recommended work:

1. After packaged desktop verification, run a real small `协作` task with Codex CLI + Claude Code and inspect `collaboration/events.json` for the turn events.
2. Consider a later Settings option for default collaboration rounds and optional early-stop criteria, but keep the launch slice simple and bounded.

## 2026-06-21 Parallel Swimlane Orchestration Prototype

User guidance:

- Evaluate the proposed "replace checklist with pipeline/swimlanes" design before touching production app files.
- Use `DavidHDev/react-bits` only if it fits Orbit's current theme and product rules.
- The goal is to emphasize parallel execution and collaboration, not to narrowly patch the existing stacked list.

Reference/product audit:

- The swimlane direction is product-correct for `orchestrate`: horizontal lanes make independent worker execution much clearer than the current vertical task rows.
- The proposal needed adjustment: Hermes should remain a user notification / remote-instruction bridge and should not be represented as an execution worker lane.
- The local `reference_repos/ui-component-libraries/react-bits` copy was reviewed. The full library is not a good app dependency because it brings many heavy UI/3D/motion dependencies. Orbit should keep using/adapting its existing lightweight `SpotlightPanel` / `ShinyText` style instead of importing the library wholesale.

Implemented:

- Added a standalone, non-production prototype at `docs/prototypes/orbit-parallel-swimlane.html`.
- The prototype uses Orbit's current dark glass tokens, mint/cyan/violet atmosphere, Codex/Claude identity colors, and a separate Hermes bridge strip.
- Included fan-out control bar, two worker lanes, status-coded progress/log motion, failed validation state, fan-in synthesis bar, horizontal overflow for narrow screens, and `data-motion="off"` support.

Verification:

- Opened the standalone HTML in Chrome and captured a desktop visual smoke screenshot at `/tmp/orbit-parallel-swimlane-prototype.png`.
- Captured a narrow-window smoke screenshot at `/tmp/orbit-parallel-swimlane-narrow.png`; text did not overlap and the lanes preserved horizontal scroll instead of being squeezed.
- No production renderer/main source, runtime assets, packaging config, or desktop app bundle was changed, so the desktop delivery loop was intentionally not run for this prototype-only change.

Next recommended work:

1. If approved, integrate the swimlane model into `src/renderer/glass/orchestrate-view.tsx` using real `OrchestrateState` / `orchestrate:*` events.
2. Keep progress visually state-based unless the backend exposes true percentages; do not fake exact progress.
3. Add lane grouping by execution worker and retain Hermes only as a bridge/status strip.

## 2026-06-21 Orchestrate Swimlanes + Shared Mission Context Ledger

User guidance:

- Integrate the approved parallel/swimlane orchestration UI into the real Orbit desktop app.
- Also inspect `openagents-org/openagents` source to understand how it implements multi-agent shared context; do not blindly copy claims from README/screenshots.
- Make product-level changes with stability in mind, not a temporary UI patch.

OpenAgents source audit:

- Local reference repo checked at `reference_repos/collaboration-frameworks/openagents`, commit `45abec586df5761da08aa042d4f6ccbe7370d28b`.
- OpenAgents shared context is implemented as a workspace channel/event system plus shared files and shared browser tools, not as hidden shared LLM memory.
- Key source points inspected:
  - `packages/agent-connector/src/workspace-client.js`: agents post and poll `workspace.message.posted` events for the same workspace/channel.
  - `sdk/src/openagents/mcp_server.py`: MCP tools expose `workspace_get_history`, shared file read/write/list/delete, and shared browser operations.
  - `workspace/backend/app/routers/events.py`: `/v1/events` persists workspace events and routes posted workspace messages.
  - `workspace/backend/app/routers/files.py`: shared file upload emits `workspace.file.uploaded`.
- Product conclusion for Orbit: do not import the full OpenAgents cloud workspace stack. Implement the most important local equivalent first: a mission-scoped shared context ledger inside the user workspace, connected to Orbit's existing CollaborationBus/Reactor execution.

Implemented:

- Updated authoritative runtime `src/main/orbit-runtime.cjs`.
  - Added `memory.updated` to `CollaborationEventTypes`.
  - Added mission shared context ledger generation.
  - Ledger path priority:
    - workspace-bound missions: `.orbit/missions/<mission-id>/shared-context.md`
    - fallback with no workspace: app userData `missions/<mission-id>/shared-context.md`
  - Ledger includes mission goal, shared Definition of Done, task DAG, contract details, previous worker results, artifact registry, Reactor waves, handoff capsules, and recent mission timeline.
  - `buildOpenAgentsWorkspaceContext()` now tells each worker where the ledger is and how to use it.
  - `runOrchestrate()` refreshes the ledger when the mission starts running, before worker attempts, after handoff capsules, after each wave, after Reactor replans, before synthesis, and after final completion/failure.
  - `orchestrate:plan` snapshots include `sharedContextPath` so the UI can surface the real shared context artifact.
- Updated renderer.
  - Replaced the stacked task-list orchestration panel with a horizontal pipeline/swimlane UI in `src/renderer/glass/orchestrate-view.tsx`.
  - Added fan-out control strip, shared-context ledger path, per-worker lanes, status-coded progress/log areas, validation failure state, fan-in synthesis, and separate Hermes bridge strip.
  - `src/renderer/glass/orchestrate-reducer.ts` stores `sharedContextPath` and preserves backend contract status from later `orchestrate:plan` snapshots.
  - Added reducer test coverage for shared context path propagation.
  - Added `.orx-*` CSS in `src/renderer/globals.css`, matching Orbit's current dark glass/mint/cyan theme and preserving narrow-screen horizontal scroll.
- Updated TS mirror typing.
  - `src/main/hub/collaboration-events.ts` includes `MemoryUpdated`.
  - `src/main/hub/dispatcher.ts` stream type allows `sharedContextPath` on `orchestrate:plan`.

Validation:

- `node -c src/main/orbit-runtime.cjs` passed.
- `npm run typecheck` passed.
- Targeted tests passed:
  - `src/renderer/glass/orchestrate-reducer.test.ts`
  - `src/main/hub/__tests__/orchestrator.test.ts`
  - `src/main/hub/__tests__/orchestrator-e2e.test.ts`
- `npm test` passed: 36 files, 187 tests.
- `npm run build` passed and copied `src/main/orbit-runtime.cjs` to `out/main/orbit-runtime.cjs`.
- `npm run unpack` passed and produced `dist/mac-arm64/Orbit.app`.
- Replaced `/Users/gao90098/Desktop/Orbit.app` with `dist/mac-arm64/Orbit.app`.
- Ran `codesign --force --deep --sign - /Users/gao90098/Desktop/Orbit.app`.
- Ran `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app`; verification passed.
- Relaunched `/Users/gao90098/Desktop/Orbit.app`.
- Verified desktop app PID `89381` listens on:
  - `127.0.0.1:9527`
  - `127.0.0.1:9528`
- Verified proxy health:
  - `http://127.0.0.1:9528/health` returns `{"ok":true,...}`.
  - `http://127.0.0.1:9528/v1/models` returns model list.
- Verified EvoMap OAuth status endpoint responds on 9527, but current token state is `connected:false`, `reason:"expired"`; this is an external auth state, not a startup regression.
- Visual smoke:
  - Screenshot saved at `/tmp/orbit-after-swimlane-shared-context.png`; Orbit process/window exists and the app is running.
  - `System Events` reports Orbit window `Orbit` at position `95,33` size `1280,820`, but macOS kept Chrome frontmost during the final screenshot attempts.

Next recommended work:

1. Run a small real `智能路由 / Orchestrate` mission and inspect the generated `.orbit/missions/<mission-id>/shared-context.md` to confirm workers cite and update the ledger through handoff capsules.
2. Consider adding a small "Open ledger" affordance in the orchestrate UI after the user has seen the path work in a real mission.
3. Later, if the product needs true live peer-to-peer same-wave context, add a local event/MCP tool layer around the ledger; do not fake live sharing in the UI.

## 2026-06-21 GitHub Publication Prep

- User decided not to build a Vercel/cloud demo; future demos should be real local desktop demonstrations because Codex CLI / Claude Code membership, local file access, and workspace mutation require the desktop runtime.
- Added `outputs/` to `.gitignore` so temporary generated decks and inspection logs are not published to the public source repo.
- Publishing target remains the canonical public `workbench` remote (`gaowei90098-creator/orbit-agent-workbench`), not the old `origin` or `orbit` remotes.
