import { StdioAgentAdapter } from './stdio-adapter'
import { locateOpenclawBinary } from '../agent-locator'

/**
 * OpenClaw 本地 CLI 直连适配器 — oneshot
 *
 * OpenClaw 默认入口需要交互式 TTY，单次命令须用其 crestodian 子命令：
 *   openclaw crestodian --message "<prompt>"
 * （CLI 报错信息给出的官方用法）prompt 经 {prompt} 占位符作为参数传入。
 * 如需其他子命令/flag，可在 设置→路由→StdIO 的"附加参数"里覆盖。
 */
export class OpenClawAdapter extends StdioAgentAdapter {
  constructor() {
    super('openclaw', 'OpenClaw', locateOpenclawBinary() || 'openclaw', ['crestodian', '--message', '{prompt}'])
  }
}
