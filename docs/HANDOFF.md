# Orbit Agent Handoff Protocol

Orbit is designed for long-running software work where one AI agent may not be enough.

This document explains how Orbit preserves continuity when work moves from one agent to another, especially between Codex CLI and Claude Code.

## The Problem

Single-agent coding sessions often fail for operational reasons:

- the agent reaches quota;
- the agent loses context;
- the user wants to switch models;
- one agent is better at implementation while another is better at review;
- the previous worker produced partial files but no final summary;
- the user has to manually re-explain the project to the next agent.

Orbit treats that as a product problem, not a user problem.

## Handoff Goal

When a mission moves from one worker agent to another, the next agent should receive:

- the current workspace;
- the user goal;
- active task contract;
- file scope;
- done criteria;
- verification command;
- relevant memory;
- recent execution evidence;
- known blockers;
- open decisions.

The next agent should not need the entire private transcript of the previous agent. It needs the operational state required to continue safely.

## Orbit Roles

| Role | Responsibility |
| --- | --- |
| Orbit main Agent | Plan, route, supervise, verify, synthesize |
| Codex CLI | Local code execution, edits, tests, implementation |
| Claude Code | Deep reasoning, implementation, code review, repair |
| Hermes | Progress reports, approval relay, user communication |

Hermes is intentionally not part of the default code execution pool.

## Handoff Artifacts

Orbit uses these structures to make relay possible:

- `PlanArtifact`: mission-level plan.
- `TaskDAG`: dependency graph for the mission.
- `TaskContract`: bounded worker assignment.
- Collaboration events: durable mission timeline.
- Memory entries: STM, episodic LTM, semantic/procedure LTM.
- Evidence records: files, previews, activity tails, verification status.

## Relay Mode

Relay mode runs one selected agent at a time.

Use it when:

- a user wants Codex only;
- a user wants Claude Code only;
- one agent reached a usage limit and another should continue;
- the work is linear enough that full orchestration would be overkill.

The important point is that relay mode still runs inside the Orbit workspace and memory system.

## Orchestration Mode

Orchestration mode is for multi-agent collaboration.

Orbit does this:

1. Build a plan.
2. Convert the plan into task contracts.
3. Assign workers based on capability and routing.
4. Track execution events.
5. Verify evidence.
6. Decide whether to repair, hand off, or synthesize.
7. Produce a final answer.

## Handoff Checklist for Workers

Before starting:

- read the task contract;
- respect `fileScope`;
- read relevant project memory;
- check active collaboration events;
- avoid changing files outside the contract unless the contract is updated.

While working:

- report blockers explicitly;
- produce concrete files or evidence;
- keep interface changes visible;
- do not assume another worker saw private chat history.

Before finishing:

- run the requested verification command when possible;
- list changed files;
- list unresolved risks;
- release or complete the task contract.

## Current Implementation Status

Implemented:

- workspace-scoped conversations;
- Orbit main-agent planning and task contracts;
- local CLI worker dispatch;
- collaboration event bus;
- layered memory model;
- evidence-aware verification;
- EvoMap MCP status and planning context;
- user bridge boundary for Hermes.

Next:

- richer mission diagnostics UI;
- explicit soft-lock board;
- stronger automated rescue/handoff actions;
- optional local vector retrieval for larger workspaces.
