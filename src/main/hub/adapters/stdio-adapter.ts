import { BaseAgentAdapter } from './agent-adapter'
import { spawn, exec, execSync, ChildProcess } from 'child_process'
import { existsSync, statSync } from 'fs'
import { homedir } from 'os'

function quoteForCommandShell(value: string): string {
  if (/^[A-Za-z0-9_./:\\=@%+-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

/**
 * 多行提示词保真决策（纯函数，便于单测）：
 * 仅当经 cmd.exe /c 拼接命令行时压平换行（否则破坏命令行解析）；直接 spawn 时原样保留。
 */
export function resolvePromptArg(prompt: string, needsCommandShell: boolean): string {
  return needsCommandShell ? prompt.replace(/\r?\n/g, ' ') : prompt
}

/**
 * 通用本地 CLI 直连适配器 — oneshot
 *
 * 每次 send() spawn 一次子进程：
 *   - execArgs 含 “{prompt}” 占位符 → prompt 替换后作为命令行参数传入
 *   - 否则（默认）prompt 写入 stdin 并关闭 —— 免转义，适配大多数 CLI
 *   - opts.cwd 指定工作目录；不存在/不可访问则降级到 homedir（stderr 输出回退原因）
 * stdout 实时回流为流式输出（流式 UTF-8 解码，避免多字节字符被分块截断），
 * 进程退出即任务完成；stderr 按 UTF-8 → GBK 智能解码（Windows cmd 错误是 GBK）。
 * 登录态/模型/沙箱等继承各 CLI 自己的本机配置。
 *
 * dispatcher 的 stdio 轮询依赖 `proc` 字段名与 mode='oneshot'，勿改名。
 */
export class StdioAgentAdapter extends BaseAgentAdapter {
  id: string
  name: string
  binary = ''
  protocol = 'stdio-plain' as const
  mode = 'oneshot' as const
  /** oneshot 参数；可被路由绑定的 args 覆盖 */
  execArgs: string[]

  /** 活动解析器（如 claude stream-json）。set 则按行缓冲 stdout、逐行解析为活动步骤/最终内容；
      null（默认）= 原样把 stdout 透传给 onOutput，行为与历史完全一致（零回归）。 */
  activityParser: ((line: string) => { steps?: any[]; content?: string } | null) | null = null
  /** 解析出的活动步骤回调（dispatcher 透传成 {kind:'activity'} 流事件） */
  onActivity: ((step: any) => void) | null = null

  protected proc: ChildProcess | null = null
  private errChunks: Buffer[] = []
  private errBytes = 0
  private outDecoder: TextDecoder | null = null
  private lineBuf = ''

  constructor(id: string, name: string, defaultBinary: string, defaultArgs: string[]) {
    super()
    this.id = id
    this.name = name
    this.binary = defaultBinary
    this.execArgs = defaultArgs
  }

  /** oneshot：start 仅做预检（fail fast），真正 spawn 发生在 send() */
  async start(): Promise<void> {
    if (this.binary && /[\\/]/.test(this.binary)) {
      // 完整路径：检查文件存在
      if (!existsSync(this.binary)) {
        this.status = 'error'
        throw new Error(this.name + ' 二进制不存在: ' + this.binary + '（请在 设置→路由→StdIO 修改路径或留空自动探测）')
      }
    } else if (this.binary) {
      // 裸命令：用 where/which 预检 PATH，避免 shell 报 GBK 乱码错误
      try {
        execSync((process.platform === 'win32' ? 'where ' : 'which ') + this.binary,
          { timeout: 2000, encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      } catch {
        this.status = 'error'
        throw new Error('未检测到 ' + this.name + ' CLI（PATH 中没有 “' + this.binary + '”）。请先安装该 CLI，或在 设置→路由→StdIO 填写完整二进制路径。')
      }
    }
    this.status = 'idle'
    this.startCount++
  }

  send(prompt: string, opts?: { cwd?: string | null }): void {
    this.buffer = ''
    this.errChunks = []
    this.errBytes = 0
    this.lineBuf = ''
    this.outDecoder = new TextDecoder('utf-8')
    const viaArg = this.execArgs.some(a => a.includes('{prompt}'))
    const needsCommandShell = process.platform === 'win32' && !/\.exe$/i.test(this.binary)
    // 多行提示词保真：直接 spawn（.exe / 非 Windows）时单个 argv 可含换行，原样保留；
    // 仅经 cmd.exe /c 拼接命令行时才压平换行（否则换行会破坏命令行解析）。
    const promptArg = resolvePromptArg(prompt, needsCommandShell)
    const args = viaArg
      ? this.execArgs.map(a => a.replace('{prompt}', promptArg))
      : this.execArgs
    const cmd = needsCommandShell ? (process.env.ComSpec || 'cmd.exe') : this.binary
    const spawnArgs = needsCommandShell
      ? ['/d', '/s', '/c', [this.binary, ...args].map(quoteForCommandShell).join(' ')]
      : args

    // 工作目录解析：opts.cwd 给定 → 预检 → 不存在/不是目录 → 降级 homedir，控制台告警
    // （不写入 errChunks：那是 CLI 进程的真实 stderr，混入会误导用户）
    const requested = typeof opts?.cwd === 'string' ? opts.cwd.trim() : ''
    let cwd = homedir()
    if (requested) {
      try {
        const st = statSync(requested)
        if (st.isDirectory()) cwd = requested
        else console.warn('[StdioAgentAdapter] cwd 存在但不是目录，已回退 home:', requested)
      } catch {
        console.warn('[StdioAgentAdapter] cwd 不可访问，已回退 home:', requested)
      }
    }

    this.proc = spawn(cmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsVerbatimArguments: needsCommandShell,
      cwd,
      // 本地 CLI 以管道方式 spawn（非真实终端）。显式声明”非交互纯文本管道”：
      // - TERM=dumb / NO_COLOR：让基于 prompt_toolkit / rich / curses 的 CLI 退化为纯文本，
      //   而不是去查询 Windows 控制台屏幕缓冲区导致 NoConsoleScreenBufferError 崩溃
      //   （Hermes 等 Python TUI 继承到 TERM=xterm-256color 时正是这样崩的），同时避免 ANSI
      //   颜色码污染聊天气泡；
      // - PYTHONUNBUFFERED：Python CLI 实时回流输出（更好的流式体验）；
      // - PYTHONIOENCODING=utf-8：修正 Windows 下 Python 输出的 GBK 乱码。
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true
    })
    this.status = 'busy'

    this.proc.stdout?.on('data', (d: Buffer) => {
      const text = this.outDecoder ? this.outDecoder.decode(d, { stream: true }) : d.toString()
      if (!text) return
      this.buffer += text
      if (this.activityParser) this.handleActivityChunk(text)
      else this.handleOutput(text)
    })
    this.proc.stderr?.on('data', (d: Buffer) => {
      this.errChunks.push(d)
      this.errBytes += d.length
      while (this.errBytes > 16384 && this.errChunks.length > 1) {
        this.errBytes -= this.errChunks[0].length
        this.errChunks.shift()
      }
    })
    this.proc.on('error', (e: Error) => {
      this.proc = null
      this.handleError(e)
    })
    this.proc.on('exit', (code) => {
      // 活动模式：进程退出前刷掉最后一行（结果行常无尾随换行）
      if (this.activityParser && this.lineBuf.trim()) {
        this.consumeActivityLine(this.lineBuf)
        this.lineBuf = ''
      }
      const failed = code !== 0 && code !== null
      this.proc = null
      this.status = 'idle'
      if (failed) {
        let detail = this.decodeStderr().trim()
        // 某些 CLI（如 Codex）把错误对象误格式化成 "[object Object]"，或只把错误写到 stdout。
        // 这类 stderr 对用户毫无信息量 → 回退到 stdout 尾部，避免抛出 "退出码 1：[object Object]"。
        if (!detail || /^(\[object Object\])+$/.test(detail)) detail = this.buffer.trim()
        detail = detail.slice(-500)
        this.handleError(new Error(this.name + ' 退出码 ' + code + '：' + (detail || '(无错误输出)')))
      }
    })

    try {
      if (!viaArg) this.proc.stdin?.write(prompt)
      this.proc.stdin?.end()
    } catch (e: any) {
      this.handleError(e)
    }
  }

  /** 活动模式：按行缓冲 stdout，逐完整行交给 activityParser。 */
  private handleActivityChunk(text: string): void {
    this.lineBuf += text
    let nl: number
    while ((nl = this.lineBuf.indexOf('\n')) >= 0) {
      const line = this.lineBuf.slice(0, nl)
      this.lineBuf = this.lineBuf.slice(nl + 1)
      this.consumeActivityLine(line)
    }
  }

  /** 单行 → 活动步骤（onActivity）/ 最终内容（handleOutput）。解析器抛错则回退把原行当内容透传。 */
  private consumeActivityLine(line: string): void {
    const parser = this.activityParser
    if (!parser) return
    let parsed: { steps?: any[]; content?: string } | null
    try {
      parsed = parser(line)
    } catch {
      parsed = { content: line.endsWith('\n') ? line : line + '\n' }
    }
    if (!parsed) return
    if (parsed.steps) {
      for (const s of parsed.steps) { if (this.onActivity) this.onActivity(s) }
    }
    if (parsed.content) this.handleOutput(parsed.content)
  }

  /** stderr 解码：先 UTF-8，出现替换符则按 GBK 重解（Windows 中文 cmd 错误信息） */
  private decodeStderr(): string {
    if (this.errChunks.length === 0) return ''
    const raw = Buffer.concat(this.errChunks)
    let text = raw.toString('utf8')
    if (text.includes('�')) {
      try { text = new TextDecoder('gbk').decode(raw) } catch { /* 编码不支持则保留 utf8 结果 */ }
    }
    return text
  }

  async stop(): Promise<void> {
    const p = this.proc
    this.proc = null
    if (p?.pid) {
      if (process.platform === 'win32') {
        // 杀整棵进程树（CLI 可能派生子进程）
        try { exec(`taskkill /pid ${p.pid} /t /f`, { windowsHide: true }) } catch { /* noop */ }
      } else {
        try { p.kill('SIGKILL') } catch { /* noop */ }
      }
    }
    this.status = 'idle'
  }
}
