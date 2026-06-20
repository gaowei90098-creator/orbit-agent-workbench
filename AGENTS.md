# AgentForge Mission Control Instructions

Always read `PROJECT_MEMORY.md` before changing this project.

This workspace is named `AgentForge-MissionControl`. It is the future source workspace for the AgentHub-to-main-Agent pivot.

This repository is being turned into a main Agent / Orchestrator product:

- AgentHub receives a project goal.
- The main Agent decomposes it into a task DAG.
- Sub-agents receive bounded task contracts and execute.
- Shared coordination state keeps task granularity, file scope, interface contracts, memory, and verification aligned.
- Every coding session must append or update `PROJECT_MEMORY.md` with completed changes and the next recommended work.
- After any source, runtime, UI, asset, config, packaging, or dependency change that affects the desktop app, rebuild and repackage the app before stopping. The user launches `/Users/gao90098/Desktop/Orbit.app`, so finishing at source edits only leaves them with a stale desktop build.
- Required desktop delivery loop for app-affecting changes:
  1. Run the relevant validation commands, at minimum `npm run typecheck`; run `npm test` when behavior changed.
  2. Run `npm run build`.
  3. Run `npm run unpack`.
  4. Replace `/Users/gao90098/Desktop/Orbit.app` with `dist/mac-arm64/Orbit.app`.
  5. Ad-hoc sign the replaced app with `codesign --force --deep --sign - /Users/gao90098/Desktop/Orbit.app`.
  6. Verify with `codesign --verify --deep --strict --verbose=2 /Users/gao90098/Desktop/Orbit.app`.
  7. Relaunch or at least explicitly report whether relaunch/listener verification was completed.

Do not treat AgentHub as only a multi-model chat shell. Preserve the original goal: project intake -> decomposition -> collaboration -> verification -> synthesis.
