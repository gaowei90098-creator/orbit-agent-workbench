import { AGENT_META, MAIN_AGENT_ID, ROUTING_AGENT_IDS, AgentUIStatus, BindingDef, ProviderDef } from './meta'

export type ConnectionState = 'usable' | 'busy' | 'error' | 'needs-provider' | 'needs-install' | 'off'
export type SetupTab = 'providers' | 'routing' | 'sites' | 'proxy' | 'workspaces'

export interface ConnectionAction {
  labelZh: string
  labelEn: string
  tab: SetupTab
}

export interface AgentConnectionItem {
  agentId: string
  state: ConnectionState
  status: AgentUIStatus
  titleZh: string
  titleEn: string
  detailZh: string
  detailEn: string
  action: ConnectionAction | null
}

export interface ConnectionSummary {
  items: AgentConnectionItem[]
  counts: {
    usable: number
    busy: number
    error: number
    needsProvider: number
    needsInstall: number
    off: number
  }
  headlineZh: string
  headlineEn: string
  firstAction: ConnectionAction | null
}

const configureProviderAction: ConnectionAction = {
  labelZh: '去配置 Provider',
  labelEn: 'Configure provider',
  tab: 'providers'
}

const chooseCliAction: ConnectionAction = {
  labelZh: '选择 CLI 路径',
  labelEn: 'Choose CLI path',
  tab: 'routing'
}

const installCliAction: ConnectionAction = {
  labelZh: '打开安装入口',
  labelEn: 'Open install page',
  tab: 'sites'
}

function providerUsable(provider?: ProviderDef): boolean {
  return !!provider && provider.enabled && !!provider.apiKey
}

function isStdioBinding(binding?: BindingDef): boolean {
  return binding?.protocol === 'stdio-plain'
}

function stdioReady(binding?: BindingDef): boolean {
  // Empty binary means "auto": the main process locates the preferred local CLI
  // from env, desktop app bundles, Homebrew/npm, or PATH.
  return isStdioBinding(binding)
}

function itemForState(agentId: string, state: ConnectionState, status: AgentUIStatus, binding?: BindingDef, provider?: ProviderDef): AgentConnectionItem {
  const name = AGENT_META[agentId]?.name ?? agentId
  const isMainAgent = agentId === MAIN_AGENT_ID
  if (state === 'needs-provider') {
    return {
      agentId,
      state,
      status,
      titleZh: isMainAgent ? 'Orbit 主 Agent 需要 Provider Key' : `${name} 需要 Provider Key`,
      titleEn: isMainAgent ? 'Orbit main Agent needs a provider key' : `${name} needs a provider key`,
      detailZh: provider
        ? isMainAgent
          ? `Orbit 负责拆分、派发、校验和汇总；当前绑定到 ${provider.name}，但该提供商未启用或缺少 API Key。`
          : `当前绑定到 ${provider.name}，但该提供商未启用或缺少 API Key。`
        : '当前 HTTP 路由没有可用提供商。',
      detailEn: provider
        ? isMainAgent
          ? `Orbit decomposes, dispatches, verifies and synthesizes; it is bound to ${provider.name}, but that provider is disabled or missing an API key.`
          : `It is bound to ${provider.name}, but that provider is disabled or missing an API key.`
        : 'The current HTTP route has no usable provider.',
      action: configureProviderAction
    }
  }
  if (state === 'needs-install') {
    return {
      agentId,
      state,
      status,
      titleZh: `${name} 未检测到本地 CLI`,
      titleEn: `${name} local CLI not detected`,
      detailZh: binding?.binary
        ? '已选择自定义路径，但当前 Hub 状态仍未就绪。'
        : 'StdIO 模式会自动探测本地 CLI；如果派发失败，再到路由设置里选择可执行文件路径。',
      detailEn: binding?.binary
        ? 'A custom path is selected, but the Hub still does not report it as ready.'
        : 'StdIO mode auto-detects the local CLI; if dispatch fails, choose an executable path in Routing.',
      action: binding?.binary ? chooseCliAction : installCliAction
    }
  }
  if (state === 'error') {
    return {
      agentId,
      state,
      status,
      titleZh: `${name} 连接异常`,
      titleEn: `${name} has a connection error`,
      detailZh: '检查 Provider Key、模型绑定或本地 CLI 路径后再试。',
      detailEn: 'Check the provider key, model binding or local CLI path before trying again.',
      action: isStdioBinding(binding) ? chooseCliAction : configureProviderAction
    }
  }
  if (state === 'busy') {
    return {
      agentId,
      state,
      status,
      titleZh: `${name} 正在运行`,
      titleEn: `${name} is running`,
      detailZh: '这个 Agent 已经可用，当前正在处理任务。',
      detailEn: 'This agent is available and currently processing a task.',
      action: null
    }
  }
  if (state === 'usable') {
    return {
      agentId,
      state,
      status,
      titleZh: `${name} 可用`,
      titleEn: `${name} is ready`,
      detailZh: isMainAgent
        ? 'Orbit 主 Agent 已就绪，会负责拆分任务、派发子 Agent、监督和汇总。'
        : isStdioBinding(binding) ? '本地 CLI 模式已启用，会使用本机登录态直接派发。' : 'Provider Key 与模型绑定已就绪。',
      detailEn: isMainAgent
        ? 'Orbit main Agent is ready to plan, dispatch workers, supervise and synthesize.'
        : isStdioBinding(binding) ? 'Local CLI mode is enabled and will dispatch with your local login state.' : 'Provider key and model binding are ready.',
      action: null
    }
  }
  return {
    agentId,
    state,
    status,
    titleZh: `${name} 未启用`,
    titleEn: `${name} is disabled`,
    detailZh: '先完成 Provider 或 StdIO 路由设置。',
    detailEn: 'Finish provider or StdIO routing setup first.',
    action: isStdioBinding(binding) ? chooseCliAction : configureProviderAction
  }
}

export function summarizeAgentConnections({ agents, bindings, providers }: {
  agents: Record<string, { status: AgentUIStatus } | undefined>
  bindings: BindingDef[]
  providers: ProviderDef[]
}): ConnectionSummary {
  const counts = {
    usable: 0,
    busy: 0,
    error: 0,
    needsProvider: 0,
    needsInstall: 0,
    off: 0
  }

  const agentIds = ROUTING_AGENT_IDS.filter(agentId => agents[agentId] || bindings.some(binding => binding.agentId === agentId))

  const items = agentIds.map(agentId => {
    const binding = bindings.find(b => b.agentId === agentId)
    const provider = providers.find(p => p.id === binding?.providerId)
    const status = agents[agentId]?.status ?? 'off'
    let state: ConnectionState

    if (isStdioBinding(binding)) {
      if (!stdioReady(binding)) state = 'needs-install'
      else if (status === 'busy') state = 'busy'
      else if (status === 'error') state = 'error'
      else if (status === 'off') state = 'off'
      else state = 'usable'
    } else if (!binding || !providerUsable(provider)) {
      state = 'needs-provider'
    } else if (status === 'busy') {
      state = 'busy'
    } else if (status === 'error') {
      state = 'error'
    } else if (status === 'off') {
      state = 'off'
    } else {
      state = 'usable'
    }

    if (state === 'needs-provider') counts.needsProvider += 1
    else if (state === 'needs-install') counts.needsInstall += 1
    else counts[state] += 1
    return itemForState(agentId, state, status, binding, provider)
  })

  const firstAction = items.find(item => item.action)?.action ?? null
  return {
    items,
    counts,
    headlineZh: `${counts.usable} 个可用 · ${counts.busy} 个运行中 · ${counts.needsProvider} 个缺 Key · ${counts.needsInstall} 个待安装`,
    headlineEn: `${counts.usable} ready · ${counts.busy} running · ${counts.needsProvider} need keys · ${counts.needsInstall} need installs`,
    firstAction
  }
}

export function firstRunActionForError(error: string | undefined | null): ConnectionAction | null {
  const text = (error || '').toLowerCase()
  if (!text) return null
  if (text.includes('provider') || text.includes('api key') || text.includes('key') || text.includes('鉴权') || text.includes('unauthorized')) {
    return configureProviderAction
  }
  if (text.includes('local install') || text.includes('未检测到') || text.includes('cli') || text.includes('enoent') || text.includes('spawn')) {
    return chooseCliAction
  }
  return null
}
