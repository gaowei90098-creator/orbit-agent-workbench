/**
 * 出站 HTTP（provider / 健康检查 / 拉模型）统一入口。
 *
 * 背景：默认 `fetch`（undici）不读系统代理，且 GUI 应用经 Finder 启动拿不到 shell 的
 * HTTP_PROXY。当用户用 Shadowrocket/Clash 等代理且开启 fake-ip（域名解析到 198.18.x.x
 * 假地址）时，Orbit 直连假地址会无限卡死。改用 Electron `net.fetch` 走 defaultSession
 * 代理：由 Chromium 网络栈经代理解析真实地址并隧道转发，绕开 fake-ip。
 *
 * 同时对“连接 / 响应头”阶段加超时：收到响应头即视为连通并清除超时，不影响后续流式正文；
 * 上游始终不响应时快速失败，避免编排无限挂起。
 */
import { net, session } from 'electron'

let currentProxyUrl = ''

/** 当前出站代理（空 = 直连）。 */
export function getOutboundProxy(): string {
  return currentProxyUrl
}

/** 设置出站代理并应用到 Electron defaultSession。url 空字符串 = 直连。 */
export function setOutboundProxy(url: string): void {
  currentProxyUrl = (url || '').trim()
  try {
    const ses = session.defaultSession
    if (!ses) return
    if (currentProxyUrl) {
      void ses.setProxy({ mode: 'fixed_servers', proxyRules: toProxyRules(currentProxyUrl) })
    } else {
      void ses.setProxy({ mode: 'direct' })
    }
  } catch {
    /* session 未就绪（app 未 ready）或测试环境：忽略 */
  }
}

/** 用户输入 → Chromium proxyRules。
 *  支持 "127.0.0.1:1082" / "http://127.0.0.1:1082" / "socks5://127.0.0.1:1080"。 */
function toProxyRules(url: string): string {
  const v = url.trim()
  if (/^socks/i.test(v)) return v               // socks5://host:port 原样交给 Chromium
  const hostPort = v.replace(/^https?:\/\//i, '')
  return `http=${hostPort};https=${hostPort}`   // HTTP 代理同时用于 http / https(经 CONNECT)
}

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000

export interface ProxyFetchInit extends RequestInit {
  /** 连接/响应头阶段超时（ms）；收到响应头即清除，不限制后续流式正文。默认 30s。 */
  connectTimeoutMs?: number
}

/**
 * 经 Electron 网络栈（走 defaultSession 出站代理）发请求。
 * 对连接/响应头阶段加超时；caller 传入的 signal 仍对整体（含流式正文）生效。
 */
export async function proxyFetch(url: string, init: ProxyFetchInit = {}): Promise<Response> {
  const { connectTimeoutMs, signal: callerSignal, ...rest } = init
  const ctrl = new AbortController()
  const timer = setTimeout(
    () => ctrl.abort(new Error('上游连接/响应超时（请检查网络或代理设置）')),
    connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  )
  const signal = callerSignal ? AbortSignal.any([callerSignal, ctrl.signal]) : ctrl.signal
  try {
    const res = await net.fetch(url, { ...rest, signal })
    clearTimeout(timer)   // 已收到响应头 = 连通，放行后续流式正文
    return res
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}
