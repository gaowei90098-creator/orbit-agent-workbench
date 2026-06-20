import { contextBridge, ipcRenderer } from 'electron'

const api = {
  hub: {
    getStatus: () => ipcRenderer.invoke('hub:status'),
    routePreview: (text: string) => ipcRenderer.invoke('hub:routePreview', text),
    dispatch: (text: string, mode?: string, targetAgent?: string, opts?: { thinking?: any; workspaceId?: string | null; requirePlanApproval?: boolean }) =>
      ipcRenderer.invoke('hub:dispatch', {
        text,
        mode: mode || 'auto',
        targetAgent,
        thinking: opts?.thinking,
        workspaceId: opts?.workspaceId ?? null,
        requirePlanApproval: !!opts?.requirePlanApproval
      }),
    approvePlan: (taskId: string, approved: boolean) => ipcRenderer.invoke('hub:approvePlan', taskId, approved),
    cancel: (taskId: string) => ipcRenderer.invoke('hub:cancel', taskId),
    onStatus: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('hub:status-update', handler)
      return () => ipcRenderer.removeListener('hub:status-update', handler)
    },
    onStream: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('dispatch:stream', handler)
      return () => ipcRenderer.removeListener('dispatch:stream', handler)
    }
  },
  proxy: {
    info: () => ipcRenderer.invoke('proxy:info')
  },
  network: {
    getProxy: () => ipcRenderer.invoke('network:getProxy'),
    setProxy: (url: string) => ipcRenderer.invoke('network:setProxy', url)
  },
  agents: {
    locate: () => ipcRenderer.invoke('agents:locate')
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('win:maximizeToggle'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    close: () => ipcRenderer.invoke('win:close'),
    onMaximized: (callback: (maximized: boolean) => void) => {
      const handler = (_event: any, v: boolean) => callback(v)
      ipcRenderer.on('win:maximized', handler)
      return () => ipcRenderer.removeListener('win:maximized', handler)
    }
  },
  providers: {
    get: () => ipcRenderer.invoke('providers:get'),
    upsert: (p: any) => ipcRenderer.invoke('providers:upsert', p),
    delete: (id: string) => ipcRenderer.invoke('providers:delete', id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('providers:setEnabled', id, enabled),
    setKey: (id: string, key: string) => ipcRenderer.invoke('providers:setKey', id, key),
    health: (id: string) => ipcRenderer.invoke('providers:health', id),
    healthAll: () => ipcRenderer.invoke('providers:healthAll'),
    fetchModels: (id: string) => ipcRenderer.invoke('providers:fetchModels', id)
  },
  takeover: {
    status: () => ipcRenderer.invoke('takeover:status'),
    apply: (app: string, modelRef: string) => ipcRenderer.invoke('takeover:apply', app, modelRef),
    restore: (app: string) => ipcRenderer.invoke('takeover:restore', app)
  },
  routing: {
    setBinding: (b: any) => ipcRenderer.invoke('routing:setBinding', b),
    removeBinding: (agentId: string) => ipcRenderer.invoke('routing:removeBinding', agentId),
    setFallback: (chain: string[]) => ipcRenderer.invoke('routing:setFallback', chain),
    setStrategy: (s: string) => ipcRenderer.invoke('routing:setStrategy', s),
    setBindingThinking: (agentId: string, t: any) => ipcRenderer.invoke('routing:setBindingThinking', agentId, t),
    setProviderThinking: (id: string, t: any) => ipcRenderer.invoke('routing:setProviderThinking', id, t),
    activeBinding: (agentId: string) => ipcRenderer.invoke('routing:activeBinding', agentId)
  },
  onChatResponse: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('chat:response', handler)
    return () => ipcRenderer.removeListener('chat:response', handler)
  },
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value)
  },
  memory: {
    catalog: () => ipcRenderer.invoke('memory:catalog'),
    list: (category?: string) => ipcRenderer.invoke('memory:list', category),
    addEntry: (entry: any) => ipcRenderer.invoke('memory:addEntry', entry),
    loadState: () => ipcRenderer.invoke('memory:loadState'),
    saveState: (state: any) => ipcRenderer.invoke('memory:saveState', state)
  },
  missions: {
    plans: () => ipcRenderer.invoke('missions:plans'),
    outcomes: (limit?: number) => ipcRenderer.invoke('missions:outcomes', limit),
    active: () => ipcRenderer.invoke('missions:active'),
    stm: () => ipcRenderer.invoke('missions:stm')
  },
  collaboration: {
    events: (filter?: any) => ipcRenderer.invoke('collaboration:events', filter),
    timeline: (missionId: string, limit?: number) => ipcRenderer.invoke('collaboration:timeline', missionId, limit)
  },
  openagents: {
    compatibility: () => ipcRenderer.invoke('openagents:compatibility')
  },
  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    pickFolder: () => ipcRenderer.invoke('app:pickFolder'),
    onDeepLink: (callback: (link: { action: string; params: Record<string, string> }) => void) => {
      const handler = (_event: any, link: any) => callback(link)
      ipcRenderer.on('app:deep-link', handler)
      return () => ipcRenderer.removeListener('app:deep-link', handler)
    }
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    create: (input: { name: string; rootPath: string }) => ipcRenderer.invoke('workspaces:create', input),
    update: (id: string, patch: { name?: string; rootPath?: string; bootstrapFiles?: string[] }) =>
      ipcRenderer.invoke('workspaces:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('workspaces:remove', id),
    getActive: () => ipcRenderer.invoke('workspaces:getActive'),
    setActive: (id: string | null) => ipcRenderer.invoke('workspaces:setActive', id)
  },
  // --- AgentHub skills + native agentic (Claude-B 新增) ---
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    builtins: () => ipcRenderer.invoke('skills:builtins'),
    add: (input: any) => ipcRenderer.invoke('skills:add', input),
    update: (id: string, patch: any) => ipcRenderer.invoke('skills:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('skills:remove', id),
    getInstalls: () => ipcRenderer.invoke('skills:getInstalls'),
    install: (agentId: string, skillId: string) => ipcRenderer.invoke('skills:install', agentId, skillId),
    uninstall: (agentId: string, skillId: string) => ipcRenderer.invoke('skills:uninstall', agentId, skillId)
  },
  agentic: {
    capabilities: () => ipcRenderer.invoke('agentic:capabilities'),
    getEnabled: () => ipcRenderer.invoke('agentic:getEnabled'),
    setEnabled: (agentId: string, on: boolean) => ipcRenderer.invoke('agentic:setEnabled', agentId, on),
    getMode: () => ipcRenderer.invoke('agentic:getMode'),
    setMode: (mode: 'all' | 'selected') => ipcRenderer.invoke('agentic:setMode', mode),
    // 写/执行审批门禁
    getApprovalConfig: () => ipcRenderer.invoke('agentic:getApprovalConfig'),
    setApprovalDefault: (tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny') =>
      ipcRenderer.invoke('agentic:setApprovalDefault', tool, policy),
    setApprovalOverride: (agentId: string, tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny' | null) =>
      ipcRenderer.invoke('agentic:setApprovalOverride', agentId, tool, policy),
    resolveApproval: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke('agentic:resolveApproval', requestId, approved)
  },
  // --- /AgentHub skills + native agentic ---
  platform: process.platform
}

contextBridge.exposeInMainWorld('electronAPI', api)
