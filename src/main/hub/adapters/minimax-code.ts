import { StdioAgentAdapter } from './stdio-adapter'
import { locateMinimaxCodeBinary } from '../agent-locator'

/**
 * MiniMax Code 直连适配器 — oneshot
 *
 * MiniMax Code 桌面版基于 OpenCode 构建，内置 opencode.exe：
 *   opencode run "<prompt>"
 * 非交互执行、输出到 stdout、退出即完成；登录态/默认模型继承桌面版配置。
 * prompt 经 {prompt} 占位符作为参数传入（完整路径 .exe 直接 spawn，无转义问题）。
 */
export class MinimaxCodeAdapter extends StdioAgentAdapter {
  constructor() {
    super('minimax-code', 'MiniMax Code', locateMinimaxCodeBinary() || 'opencode', ['run', '{prompt}'])
  }
}
