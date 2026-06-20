import { StdioAgentAdapter } from './stdio-adapter'
import { locateCodexBinary } from '../agent-locator'
import { parseCodexStreamJsonLine } from './codex-stream-json'

/**
 * Codex（桌面版/CLI）直连适配器 — oneshot
 *
 * `codex exec --json --sandbox danger-full-access --skip-git-repo-check -C . -`
 *   - --json：把执行过程以 JSONL 事件流出，由 activityParser 解析成步骤卡和最终答案。
 *   - --sandbox danger-full-access：Codex CLI 0.134 在非交互 exec 下用 workspace-write 会
 *     降级成只读/不能执行 shell；danger-full-access 才能稳定执行本地工程任务。AgentHub
 *     已在派发层按用户选择的 workspace 设置 cwd，并由本机用户显式选择 StdIO 模式。
 *   - --skip-git-repo-check：避免非 git 目录直接拒绝（agent 在任意项目目录都能工作）。
 *   - -C .：告诉 Codex 把当前 spawn cwd 当作工作根；cwd 由 Dispatcher 从 WorkspaceManager 注入。
 *   - `-` 显式从 stdin 读 prompt（规避引号/换行转义）。
 * 登录态/默认模型继承 ~/.codex/config.toml（或桌面版配置）。
 */
export class CodexAdapter extends StdioAgentAdapter {
  constructor() {
    super('codex', 'Codex CLI', locateCodexBinary() || 'codex', ['exec', '--json', '--sandbox', 'danger-full-access', '--skip-git-repo-check', '-C', '.', '-'])
    this.activityParser = parseCodexStreamJsonLine
  }
}
