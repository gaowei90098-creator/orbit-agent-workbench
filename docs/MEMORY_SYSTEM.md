# Orbit Memory System

Orbit uses memory to keep multi-agent work aligned across sessions. The goal is not to store everything. The goal is to preserve the facts that affect planning, routing, verification, and future handoff.

## Layers

### STM: Active Mission State

Stored in `missions/mission-state.json` through `MissionStore`.

- Current `PlanArtifact`
- `TaskDAG` nodes and statuses
- Active mission id
- Router context for vague follow-ups such as "continue the next step"
- Recent coordination decisions

STM is for the live mission only. It should be compact and directly useful to the Router and Lead Planner.

### Episodic LTM: Mission Outcomes

Stored as `MissionOutcome` records and dispatch outcome entries.

- Goal
- Final status
- Result summary
- Blockers
- Lessons
- Verification state
- Failed task ids

The Lead Planner reads recent outcomes before creating a new plan so Orbit does not repeat known coordination mistakes.

### Semantic / Procedure LTM

Stored through `MemoryLibrary` entries.

- Product principles
- Agent role boundaries
- Task contract rules
- Project conventions
- Reusable verification commands
- Stable architecture decisions

Semantic and procedure memory should be curated. Only promote facts that should remain true across missions.

## Role Boundaries

Orbit is the main Agent. It plans, routes, supervises, verifies, and synthesizes.

Execution workers are the only agents that should receive coding, deployment, database, file-writing, or workspace mutation contracts:

- Codex CLI
- Claude Code
- Marvis
- MiniMax Code

Hermes and OpenClaw are user bridges. They are used for user notification, progress reports, approval relay, and remote user instructions back to Orbit. They are intentionally excluded from the execution worker pool.

## Promotion Rules

- Worker private history stays private.
- Contract result summaries, blockers, verification failures, and final lessons can be promoted.
- Interface decisions belong in the task contract first, then semantic/procedure memory if reusable.
- Failed missions must record why they failed and which contracts were affected.
- Remote user instructions arriving through Hermes/OpenClaw should be recorded as decisions or active STM before Orbit replans.

## Planning Contract

Every planned worker task should preserve:

- `id`
- `title`
- `detail`
- `agentId`
- `fileScope`
- `dependsOn`
- `doneWhen`
- `verifyCommand`
- `interfaceRef`

This keeps task granularity aligned and prevents parallel workers from implementing mismatched specs.
