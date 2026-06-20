import { StdioAgentAdapter } from './stdio-adapter'
import { locateHermesBinary } from '../agent-locator'

/**
 * Hermes 本地 CLI 直连适配器 — oneshot
 *
 * Hermes 是交互式 TUI（基于 prompt_toolkit）：裸 `hermes` 会进 REPL，AgentHub 以管道
 * （非真实终端）spawn 时必崩（NoConsoleScreenBufferError），且 env 注入也救不了 Windows 上
 * 直接实例化的 Win32Output。因此默认用官方 oneshot 模式 `-z {prompt}`：发单条 prompt、
 * 只把最终答案打到 stdout 后退出，专为脚本/管道设计。
 * 若你的 hermes 需要别的子命令/flag，在 设置→路由→StdIO 的“附加参数”里覆盖。
 */
export class HermesAdapter extends StdioAgentAdapter {
  constructor() {
    super('hermes', 'Hermes', locateHermesBinary() || 'hermes', ['-z', '{prompt}'])
  }
}
