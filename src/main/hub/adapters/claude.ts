import { StdioAgentAdapter } from './stdio-adapter'
import { locateClaudeBinary } from '../agent-locator'
import { parseClaudeStreamJsonLine } from './claude-stream-json'

/**
 * Claude Code CLI 直连适配器 — oneshot + agentic 活动呈现
 *
 * `claude --print --verbose --output-format stream-json --permission-mode acceptEdits`
 *   - --print（-p）：非交互单次模式，prompt 经 stdin 传入。
 *   - --output-format stream-json（须配 --verbose）：把每步工具调用/结果以 NDJSON 事件流出，
 *     由 activityParser 解析成活动步骤卡（Write/Bash/Read… running→done），最终答案取自 result 事件。
 *   - --permission-mode acceptEdits：自动接受文件编辑、运行命令（Bash）—— agent 真正能动手
 *     （改文件、跑命令）。其它可选项：default（每次确认）/ plan（只读）/ bypassPermissions（全开无确认）。
 * 登录态/模型设置继承用户本机的 Claude Code 配置（~/.claude/settings.json 等）。
 * 注：activityParser 对非 JSON 行原样透传，故用户即便把 args 改回纯 `--print` 也不会炸（退化为纯文本）。
 */
export class ClaudeAdapter extends StdioAgentAdapter {
  constructor() {
    super('claude', 'Claude Code', locateClaudeBinary() || 'claude',
      ['--print', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits'])
    this.activityParser = parseClaudeStreamJsonLine
  }
}
