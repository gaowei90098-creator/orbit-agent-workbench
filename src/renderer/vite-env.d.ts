/// <reference types="vite/client" />

interface ElectronAPI {
  hub: {
    getStatus: () => Promise<any>
    dispatch: (text: string, mode?: string, targetAgent?: string, opts?: { thinking?: any; workspaceId?: string | null; requirePlanApproval?: boolean; rounds?: number; participants?: string[] }) => Promise<any>
    approvePlan: (taskId: string, approved: boolean) => Promise<boolean>
    cancel: (taskId: string) => Promise<boolean>
    onStatus: (callback: (data: any) => void) => () => void
    onStream: (callback: (data: any) => void) => () => void
  }
  providers: {
    get: () => Promise<any>
    upsert: (p: any) => Promise<any>
    delete: (id: string) => Promise<boolean>
    setEnabled: (id: string, enabled: boolean) => Promise<any>
    setKey: (id: string, key: string) => Promise<any>
    health: (id: string) => Promise<any>
    healthAll: () => Promise<any>
    fetchModels: (id: string) => Promise<{ ok: boolean; count?: number; error?: string; config?: any }>
  }
  takeover: {
    status: () => Promise<Record<string, {
      supported: boolean; configPath: string; configExists: boolean
      takenOver: boolean; model: string | null; current: string | null
    }>>
    apply: (app: string, modelRef: string) => Promise<any>
    restore: (app: string) => Promise<any>
  }
  routing: {
    setBinding: (b: any) => Promise<any>
    removeBinding: (agentId: string) => Promise<any>
    setFallback: (chain: string[]) => Promise<any>
    setStrategy: (s: string) => Promise<any>
    setBindingThinking: (agentId: string, t: any) => Promise<any>
    setProviderThinking: (id: string, t: any) => Promise<any>
    activeBinding: (agentId: string) => Promise<any>
  }
  proxy: {
    info: () => Promise<{ url: string; openaiUrl?: string; anthropicUrl?: string; running: boolean }>
  }
  network: {
    getProxy: () => Promise<string>
    setProxy: (url: string) => Promise<string>
  }
  agents: {
    locate: () => Promise<Record<string, Array<{ source: 'desktop' | 'terminal'; label: string; path: string }>>>
  }
  win: {
    minimize: () => Promise<void>
    maximizeToggle: () => Promise<boolean>
    isMaximized: () => Promise<boolean>
    close: () => Promise<void>
    onMaximized: (callback: (maximized: boolean) => void) => () => void
  }
  onChatResponse: (callback: (data: any) => void) => () => void
  store: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any) => Promise<boolean>
  }
  memory: {
    catalog: () => Promise<any>
    list: (category?: 'conversation' | 'task' | 'skill' | 'file' | 'system' | 'episodic' | 'semantic' | 'procedure' | 'decision') => Promise<any[]>
    addEntry: (entry: any) => Promise<any>
    loadState: () => Promise<{ messages?: any[]; tasks?: any[]; conversations?: any[]; activeConversationId?: string | null; activeWorkspaceId?: string | null }>
    saveState: (state: { messages: any[]; tasks: any[]; conversations?: any[]; activeConversationId?: string | null; activeWorkspaceId?: string | null }) => Promise<any>
  }
  missions: {
    plans: () => Promise<any[]>
    outcomes: (limit?: number) => Promise<any[]>
    active: () => Promise<any | null>
    stm: () => Promise<any>
  }
  collaboration: {
    events: (filter?: any) => Promise<any[]>
    timeline: (missionId: string, limit?: number) => Promise<string>
  }
  openagents: {
    compatibility: () => Promise<any>
  }
  app: {
    openExternal: (url: string) => Promise<void>
    pickFolder: () => Promise<string | null>
    onDeepLink: (callback: (link: { action: string; params: Record<string, string> }) => void) => () => void
  }
  workspaces: {
    list: () => Promise<Array<{ id: string; name: string; rootPath: string; createdAt: number; updatedAt: number }>>
    create: (input: { name: string; rootPath: string }) => Promise<{ id: string; name: string; rootPath: string }>
    update: (id: string, patch: { name?: string; rootPath?: string; bootstrapFiles?: string[] }) => Promise<any>
    remove: (id: string) => Promise<boolean>
    getActive: () => Promise<string | null>
    setActive: (id: string | null) => Promise<string | null>
  }
  // --- AgentHub skills + native agentic (Claude-B 新增) ---
  skills: {
    list: () => Promise<Array<{ id: string; name: string; description: string; instructions: string; tags: string[]; source: string; createdAt: number; updatedAt: number }>>
    builtins: () => Promise<Array<{ name: string; description?: string; instructions: string; tags?: string[]; source?: string }>>
    add: (input: { name: string; description?: string; instructions: string; tags?: string[]; source?: string }) => Promise<any>
    update: (id: string, patch: { name?: string; description?: string; instructions?: string; tags?: string[]; source?: string }) => Promise<any>
    remove: (id: string) => Promise<boolean>
    getInstalls: () => Promise<Record<string, string[]>>
    install: (agentId: string, skillId: string) => Promise<Record<string, string[]>>
    uninstall: (agentId: string, skillId: string) => Promise<Record<string, string[]>>
  }
  agentic: {
    capabilities: () => Promise<Array<{ agentId: string; name: string; protocol: 'http' | 'stdio-plain' | 'acp'; nativeCli: boolean; httpAgentic: boolean; capabilities: string[] }>>
    getEnabled: () => Promise<string[]>
    setEnabled: (agentId: string, on: boolean) => Promise<string[]>
    getMode: () => Promise<'all' | 'selected'>
    setMode: (mode: 'all' | 'selected') => Promise<'all' | 'selected'>
    getApprovalConfig: () => Promise<{ version: 1; default: { write: 'allow' | 'ask' | 'deny'; exec: 'allow' | 'ask' | 'deny' }; overrides: Record<string, { write?: 'allow' | 'ask' | 'deny'; exec?: 'allow' | 'ask' | 'deny' }> }>
    setApprovalDefault: (tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny') => Promise<any>
    setApprovalOverride: (agentId: string, tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny' | null) => Promise<any>
    resolveApproval: (requestId: string, approved: boolean) => Promise<boolean>
  }
  platform: string
}

interface Window {
  electronAPI: ElectronAPI
}
