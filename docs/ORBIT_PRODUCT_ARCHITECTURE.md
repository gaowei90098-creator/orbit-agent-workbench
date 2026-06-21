# Orbit Product Architecture Review

Date: 2026-06-21

This document is the product architecture guardrail for the AgentForge Mission Control / Orbit rewrite. It exists to keep Orbit from turning into a set of one-off pipes between UI buttons, CLIs, MCP endpoints, and provider calls.

## Product Thesis

Orbit is not a multi-model chat shell.

Orbit is a desktop mission-control product:

1. The user gives a goal.
2. Orbit creates an issue/mission with a task DAG.
3. Worker agents execute bounded contracts.
4. Runtime, evidence, artifacts, memory, and integration health are recorded as first-class product state.
5. The main Agent verifies and synthesizes the final result.

## Reference Systems Reviewed

### Multica

Use as a product/lifecycle reference.

Useful patterns:

- Agents are teammates, not buttons.
- Work enters the system as issues/tasks, not loose chat bubbles.
- Agent execution has an explicit lifecycle: queued, claimed, running, waiting/blocking, done, failed, cancelled.
- Runtime is a first-class concept: local daemon, detected CLIs, heartbeat, concurrency, workspace GC.
- Skills compound over time and can be reused by future agents.
- Squads provide stable routing through a leader instead of asking the user to pick exact workers every time.

Do not copy blindly:

- Multica is server/database-heavy. Orbit is currently local Electron-first.
- Orbit should not immediately grow a full Postgres + web backend unless the local JSON stores become the bottleneck.
- Frontend source can be used for private/internal experiments, but preserve Multica license/copyright requirements.

### OWWZO / Reactor-agent

Use as a runtime/execution reference.

Useful patterns:

- Clear architecture layers: Trigger -> Case -> Domain -> Infrastructure.
- Plan-Execute plus ReAct hybrid runtime with dynamic replanning.
- Artifact ledger and execution facts are not optional logs; they are the substrate for replay and verification.
- MCP registry/tool executor should discover, warm, cache, and execute tools through a single abstraction.
- Session context memory reconstructs prior runs from ledgered LLM calls, tool calls, and artifacts within a token budget.

Do not copy blindly:

- The repo does not expose a standard license file in the current checkout, so treat code as reference unless explicit permission is obtained.
- It is Java/Spring/MySQL/Qdrant-first; Orbit should adapt the architecture, not transplant the stack.

### EvoMap

Use as the sponsor integration and self-evolution layer.

Useful patterns:

- EvoMap's own docs position GEP/Gene/Capsule above MCP: MCP connects tools, while GEP records reusable agent capability.
- Orbit should consume EvoMap before planning and publish validated internal lessons after successful missions.
- A sponsor integration must have visible health, diagnostics, reset/reconnect, and proof that it influenced planning.

## Orbit Target Architecture

### 1. Mission Layer

Owns user goals and issue-like work items.

State:

- Mission id, workspace id, source conversation id.
- Goal, current phase, priority.
- Task DAG with contract nodes.
- User approval state.
- Final synthesis and unresolved blockers.

Product rule:

- A serious goal should become a mission artifact before workers run.
- Chat messages may create missions, but missions must not be trapped inside chat state.

### 2. Contract Layer

Owns sub-agent work boundaries.

State:

- Contract id, title, detail, assignee, file scope, dependencies.
- Done criteria, verify command, interface contract reference.
- Status lifecycle: planned, approved, queued, claimed, running, waiting, done, failed, cancelled.
- Attempts, handoff capsule, verifier result.

Product rule:

- Workers execute contracts, not vague prompts.
- Every failure must attach either a blocker, a handoff capsule, or exact artifact evidence.

### 3. Runtime Layer

Owns local agent execution.

State:

- Installed/located CLIs.
- Runtime health and PID/session state.
- Concurrency limits and timeouts.
- Active task id -> process/session mapping.
- Last activity and semantic inactivity reason.

Product rule:

- Runtime health must be inspectable independent of the chat screen.
- A worker card that says "running" must correspond to a real runtime/process/session or an explicit waiting state.

### 4. Evidence Layer

Owns what was actually produced.

State:

- Worker final text.
- Activity steps.
- Tool calls and outputs.
- Files/artifacts detected from contract file scope.
- Preview URLs.
- Verification notes.

Product rule:

- Verification reads evidence, not just final assistant text.
- Empty final text is not automatically empty result if scoped artifacts exist.

### 5. Integration Layer

Owns external systems such as EvoMap, provider APIs, MCP servers, and notification bridges.

State:

- Connection status.
- Auth status and reason.
- Last successful call.
- Last failure with stage and message.
- Reset/reconnect actions.
- Which missions used the integration.

Product rule:

- No sponsor or critical integration can be a hidden background call.
- Every integration needs health, diagnostics, and recovery in the product UI.

### 6. Memory / Evolution Layer

Owns reusable knowledge.

State:

- STM: current mission and active contracts.
- Episodic LTM: mission outcomes, failures, repairs, verifier notes.
- Procedure/semantic memory: project conventions, commands, architectural decisions.
- EvoMap Gene/Capsule candidates and locally validated lessons.

Product rule:

- After a successful mission, Orbit should extract a lesson candidate.
- Before planning a relevant mission, Orbit should consult local memory and EvoMap.

## Current Gaps

1. Canonical runtime is a large CJS file. This is operationally working but architecturally fragile.
2. Mission/contract/evidence concepts exist but are not yet exposed as a unified product view.
3. EvoMap integration existed but lacked diagnostics and recovery.
4. Runtime state and UI cards can drift when workers produce artifacts but no final text.
5. Reference repositories are cloned as ignored local sources, but their architecture lessons need to be captured in Orbit docs and code boundaries.

## Near-Term Product Update Plan

### Release Slice A: Integration Health

- EvoMap OAuth becomes a recoverable state machine.
- Settings shows reason, last error, pending callback count, reset, reconnect, and probe.
- Planner logs whether EvoMap was skipped, used, failed, or auth-blocked.

### Release Slice B: Evidence-First Verification

- Contract fileScope artifact scan feeds verifier.
- Activity tail and file previews are attached to worker result.
- UI exposes evidence links rather than only raw worker text.

### Release Slice C: Mission Board Stabilization

- Treat conversations, missions, and tasks as separate entities.
- Add mission diagnostics: DAG, contract status, blockers, handoff capsules, artifacts, verification.
- Add delete/archive semantics for chats and missions separately.

### Release Slice D: Runtime Registry

- Pull local CLI detection, runtime health, PID/session, and timeouts into a single runtime registry.
- UI reads runtime health from one source.
- Future daemon mode can fit here without rewriting mission logic.

### Release Slice E: Evolution Loop

- Before planning: local memory + EvoMap candidates.
- After success: validated lesson candidate.
- Keep EvoMap as a sponsored, visible capability: Gene/Capsule/RAG cards in diagnostics.

## Architecture Rule For Future Changes

When adding a feature, first decide which layer owns it:

- Mission
- Contract
- Runtime
- Evidence
- Integration
- Memory/Evolution
- UI projection

Do not wire UI directly to ad hoc provider/runtime behavior if one of these layers should own the state.

