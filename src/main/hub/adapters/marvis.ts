import { StdioAgentAdapter } from './stdio-adapter'
import { locateMarvisBinary } from '../agent-locator'

/**
 * 腾讯 Marvis 适配器 — oneshot
 *
 * Marvis 桌面版（MarvisAgent.exe）目前没有公开的非交互 CLI，
 * 推荐用 HTTP 路由绑定（默认绑定到腾讯混元）。
 * 若未来提供 CLI（或你有内部入口），在 设置→路由→StdIO 填写路径与参数即可直连。
 */
export class MarvisAdapter extends StdioAgentAdapter {
  constructor() {
    super('marvis', 'Marvis', locateMarvisBinary() || 'marvis', [])
  }
}
