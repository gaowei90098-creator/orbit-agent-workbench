/* ============================================================
   AgentHub — 玻璃拟态壳层（design_handoff_glass_ui 实现）
   背景光斑 + 标题栏 + 侧边栏 + 四页（总览/会话/任务/设置）
   真实 IPC：hub:status / hub:dispatch / dispatch:stream /
             providers:* / routing:setBinding / proxy:info
   ============================================================ */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Titlebar } from './glass/Titlebar'
import { Sidebar, PageId } from './glass/Sidebar'
import { Enter } from './glass/ui'
import {
  AGENT_IDS, AgentUIStatus, BindingDef, ProviderDef, TaskItem, ChatMessage,
  DispatchMode, nowHHMM, sumTokens, sumCost, ConversationItem, WorkspaceItem
} from './glass/meta'
import { HomeScreen } from './screens/Home'
import { ChatScreen } from './screens/Chat'
import { TasksScreen } from './screens/Tasks'
import { SettingsScreen, MotionLevel } from './screens/Settings'
import { useLang, tr } from './glass/i18n'
import { getBudget, getBudgetMode } from './glass/budget'
import { applyOrchestrateEvent } from './glass/orchestrate-reducer'
import { applyCollaborateEvent } from './glass/collaborate-reducer'
import { upsertStep } from './glass/chat-transcript'
import { SetupTab, summarizeAgentConnections } from './glass/connection-status'
import { ApprovalDialog, ApprovalItem } from './glass/approval-dialog'
import { OrbitAurora } from './glass/orbit-aurora'

type AgentMap = Record<string, { status: AgentUIStatus }>
type DispatchRunOptions = { rounds?: number; participants?: string[] }

const asRecord = (v: any): Record<string, string> => {
  if (!v) return {}
  if (v instanceof Map) return Object.fromEntries(v)
  if (Array.isArray(v)) return Object.fromEntries(v)
  return v
}

type ListUpdater<T> = React.SetStateAction<T[]>

const sameWorkspace = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null)

const shortConversationTitle = (text: string): string => {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact ? compact.slice(0, 32) : '新对话'
}

const makeConversation = (workspaceId: string | null, title = '新对话'): ConversationItem => {
  const now = Date.now()
  return {
    id: 'conv-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    workspaceId,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    tasks: []
  }
}

const normalizeConversations = (state: any, fallbackWorkspaceId: string | null): {
  conversations: ConversationItem[]
  activeConversationId: string | null
} => {
  const fromState = Array.isArray(state?.conversations)
    ? state.conversations
        .filter((c: any) => c && typeof c.id === 'string')
        .map((c: any) => ({
          id: c.id,
          workspaceId: typeof c.workspaceId === 'string' ? c.workspaceId : null,
          title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : '新对话',
          createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
          updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
          messages: Array.isArray(c.messages) ? c.messages : [],
          tasks: Array.isArray(c.tasks) ? c.tasks : []
        })) as ConversationItem[]
    : []

  const legacyMessages = Array.isArray(state?.messages) ? state.messages as ChatMessage[] : []
  const legacyTasks = Array.isArray(state?.tasks) ? state.tasks as TaskItem[] : []
  if (fromState.length === 0 && (legacyMessages.length > 0 || legacyTasks.length > 0)) {
    const title = legacyMessages[0]?.text ? shortConversationTitle(legacyMessages[0].text) : '迁移的对话'
    const conv = makeConversation(fallbackWorkspaceId, title)
    conv.messages = legacyMessages
    conv.tasks = legacyTasks
    conv.updatedAt = Date.now()
    fromState.push(conv)
  }

  if (fromState.length === 0) fromState.push(makeConversation(fallbackWorkspaceId))
  fromState.sort((a, b) => b.updatedAt - a.updatedAt)
  const activeConversationId = typeof state?.activeConversationId === 'string' && fromState.some(c => c.id === state.activeConversationId)
    ? state.activeConversationId
    : fromState[0]?.id ?? null
  return { conversations: fromState, activeConversationId }
}

const latestConversationForWorkspace = (items: ConversationItem[], workspaceId: string | null): ConversationItem | undefined =>
  items.filter(c => sameWorkspace(c.workspaceId, workspaceId)).sort((a, b) => b.updatedAt - a.updatedAt)[0]

const INTRO_FADE_MS = 760

function OrbitIntroSplash({ leaving, onDone }: { leaving: boolean; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const fallback = window.setTimeout(onDone, 8200)
    const play = window.setTimeout(() => {
      videoRef.current?.play().catch(() => {
        window.setTimeout(onDone, 1100)
      })
    }, 80)
    return () => {
      window.clearTimeout(fallback)
      window.clearTimeout(play)
    }
  }, [onDone])

  return (
    <div className={'orbit-intro' + (leaving ? ' leaving' : '')} aria-hidden="true">
      <video
        ref={videoRef}
        className="orbit-intro-video"
        src="media/orbit-intro.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={onDone}
        onError={onDone}
      />
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState<PageId>('home')
  const [search, setSearch] = useState('')
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [settingsTab, setSettingsTab] = useState<SetupTab | 'appearance'>('providers')
  const [hubRunning, setHubRunning] = useState(false)
  const [proxyHost, setProxyHost] = useState('127.0.0.1:9528')
  const [hubAgents, setHubAgents] = useState<Record<string, string>>({})   // 注册表原始状态
  const [busyOverride, setBusyOverride] = useState<Record<string, AgentUIStatus | undefined>>({}) // 流式期间的即时状态
  const [providers, setProviders] = useState<ProviderDef[]>([])
  const [bindings, setBindings] = useState<BindingDef[]>([])
  const [fallbackChain, setFallbackChain] = useState<string[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const activeConversation = conversations.find(c => c.id === activeConversationId) ?? conversations[0] ?? null
  const tasks = activeConversation?.tasks ?? []
  const messages = activeConversation?.messages ?? []
  const [streaming, setStreaming] = useState(false)
  const [approvals, setApprovals] = useState<ApprovalItem[]>([])  // 写/执行待审批队列（'ask' 策略）
  const [motion, setMotion] = useState<MotionLevel>(() => {
    try { return (localStorage.getItem('ah-motion') as MotionLevel) || 'rich' } catch { return 'rich' }
  })
  const [introVisible, setIntroVisible] = useState(true)
  const [introLeaving, setIntroLeaving] = useState(false)
  const introDone = useRef(false)

  /* 流式派发簿记 */
  const taskToMsg = useRef<Map<string, string>>(new Map())
  const taskToConversation = useRef<Map<string, string>>(new Map())
  const pendingMsgId = useRef<string | null>(null)
  const pendingConversationId = useRef<string | null>(null)
  const ignoredTasks = useRef<Set<string>>(new Set())
  const ignoredMsgs = useRef<Set<string>>(new Set())
  const activeTaskIds = useRef<Set<string>>(new Set())
  const localTaskId = useRef<Map<string, string>>(new Map()) // 后端 taskId → 本地任务行 id
  const currentMsgId = useRef<string | null>(null)
  const currentConversationId = useRef<string | null>(null)
  const cancelGen = useRef(0)
  const memoryReady = useRef(false)
  const [runtimeReady, setRuntimeReady] = useState(false)
  const orchestrateTasks = useRef<Set<string>>(new Set())  // 编排模式任务 id（其内部 agent 事件不渲染气泡）
  const collaborateTasks = useRef<Set<string>>(new Set())  // 协作模式任务 id（其内部 agent 事件由 collaborate:* 聚合）

  /* 动效档位 → html[data-motion] */
  useEffect(() => {
    document.documentElement.dataset.motion = motion
    try { localStorage.setItem('ah-motion', motion) } catch { /* noop */ }
  }, [motion])

  const updateConversation = useCallback((conversationId: string, updater: (conversation: ConversationItem) => ConversationItem) => {
    setConversations(prev => prev.map(conv => conv.id === conversationId ? updater(conv) : conv))
  }, [])

  const updateConversationMessages = useCallback((conversationId: string, updater: ListUpdater<ChatMessage>) => {
    updateConversation(conversationId, conv => {
      const nextMessages = typeof updater === 'function'
        ? (updater as (prev: ChatMessage[]) => ChatMessage[])(conv.messages)
        : updater
      return { ...conv, messages: nextMessages, updatedAt: Date.now() }
    })
  }, [updateConversation])

  const updateConversationTasks = useCallback((conversationId: string, updater: ListUpdater<TaskItem>) => {
    updateConversation(conversationId, conv => {
      const nextTasks = typeof updater === 'function'
        ? (updater as (prev: TaskItem[]) => TaskItem[])(conv.tasks)
        : updater
      return { ...conv, tasks: nextTasks, updatedAt: Date.now() }
    })
  }, [updateConversation])

  const updateTaskAcrossConversations = useCallback((updater: (tasks: TaskItem[]) => TaskItem[]) => {
    setConversations(prev => prev.map(conv => ({ ...conv, tasks: updater(conv.tasks), updatedAt: Date.now() })))
  }, [])

  const finishIntro = useCallback(() => {
    if (introDone.current) return
    introDone.current = true
    setIntroLeaving(true)
    window.setTimeout(() => setIntroVisible(false), INTRO_FADE_MS)
  }, [])

  const loadWorkspaces = useCallback(async () => {
    try {
      const list = await (window.electronAPI as any)?.workspaces?.list?.()
      const active = await (window.electronAPI as any)?.workspaces?.getActive?.()
      const nextList = Array.isArray(list) ? list as WorkspaceItem[] : []
      setWorkspaces(nextList)
      setActiveWorkspaceId(typeof active === 'string' && nextList.some(w => w.id === active) ? active : null)
    } catch {
      setWorkspaces([])
      setActiveWorkspaceId(null)
    }
  }, [])

  useEffect(() => {
    let alive = true
    const memoryApi = window.electronAPI?.memory
    if (!memoryApi?.loadState) {
      memoryReady.current = true
      setRuntimeReady(true)
      return () => { alive = false }
    }
    memoryApi.loadState()
      .then(state => {
        if (!alive) return
        const restored = normalizeConversations(state, typeof (state as any)?.activeWorkspaceId === 'string' ? (state as any).activeWorkspaceId : null)
        setConversations(restored.conversations)
        setActiveConversationId(restored.activeConversationId)
        if (typeof (state as any)?.activeWorkspaceId === 'string') setActiveWorkspaceId((state as any).activeWorkspaceId)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) {
          memoryReady.current = true
          setRuntimeReady(true)
        }
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!memoryReady.current) return
    const memoryApi = window.electronAPI?.memory
    if (!memoryApi?.saveState) return
    const timer = setTimeout(() => {
      memoryApi.saveState({
        messages,
        tasks,
        conversations,
        activeConversationId,
        activeWorkspaceId
      } as any).catch(() => {})
    }, 450)
    return () => clearTimeout(timer)
  }, [messages, tasks, conversations, activeConversationId, activeWorkspaceId])

  useEffect(() => { loadWorkspaces() }, [loadWorkspaces])

  useEffect(() => {
    const refresh = () => { loadWorkspaces() }
    window.addEventListener('orbit:workspaces-changed', refresh)
    return () => window.removeEventListener('orbit:workspaces-changed', refresh)
  }, [loadWorkspaces])

  useEffect(() => {
    if (!runtimeReady) return
    const currentConv = conversations.find(c => c.id === activeConversationId)
    if (currentConv && sameWorkspace(currentConv.workspaceId, activeWorkspaceId)) return
    const latest = latestConversationForWorkspace(conversations, activeWorkspaceId)
    if (latest) {
      setActiveConversationId(latest.id)
      return
    }
    const fresh = makeConversation(activeWorkspaceId)
    setConversations(prev => [fresh, ...prev])
    setActiveConversationId(fresh.id)
  }, [activeConversationId, activeWorkspaceId, conversations, runtimeReady])

  /* ---------- 数据加载 ---------- */
  const loadConfig = useCallback(async () => {
    try {
      const cfg = await window.electronAPI.providers.get()
      setProviders(cfg?.providers ?? [])
      setBindings(cfg?.routing?.bindings ?? [])
      setFallbackChain(cfg?.routing?.fallbackChain ?? [])
    } catch { /* main 进程未就绪 */ }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const st = await window.electronAPI.hub.getStatus()
      setHubRunning(!!st?.running)
      const m: Record<string, string> = {}
      for (const a of st?.agents ?? []) m[a.id] = a.status
      setHubAgents(m)
      if (st?.tasks) {
        const convId = activeConversationId
        if (!convId) return
        updateConversationTasks(convId, prev => {
          const known = new Set(prev.map(t => t.id))
          const fromHub: TaskItem[] = (st.tasks as any[])
            .filter(t => !known.has(t.id) && ![...localTaskId.current.values()].includes(t.id) && !taskToMsg.current.has(t.id))
            .map(t => ({
              id: t.id, text: t.text, mode: (t.mode || 'auto') as DispatchMode,
              status: t.status === 'pending' ? 'running' : t.status,
              agents: [], durationMs: null,
              createdAt: t.createdAt ? new Date(t.createdAt).toTimeString().slice(0, 5) : ''
            }))
          return fromHub.length ? [...prev, ...fromHub] : prev
        })
      }
    } catch { /* noop */ }
  }, [activeConversationId, updateConversationTasks])

  useEffect(() => {
    loadConfig()
    refreshStatus()
    window.electronAPI?.proxy?.info().then(info => {
      try {
        const u = new URL(info.url)
        setProxyHost(u.host)
      } catch { /* noop */ }
    }).catch(() => {})
    const poll = setInterval(refreshStatus, 8000)
    return () => clearInterval(poll)
  }, [loadConfig, refreshStatus])

  /* 深链 */
  useEffect(() => {
    const off = window.electronAPI?.app?.onDeepLink?.((link) => {
      if (link.action === 'tasks' || link.action === 'board') setPage('tasks')
      else if (link.action === 'settings') setPage('settings')
      else {
        setPage('chat')
        if (link.params.agent && AGENT_IDS.includes(link.params.agent)) setActiveAgent(link.params.agent)
      }
    })
    return off
  }, [])

  /* ---------- 流式事件 ---------- */
  useEffect(() => {
    const off = window.electronAPI?.hub?.onStream?.((e: any) => {
      const tid: string = e.taskId
      if (!tid || ignoredTasks.current.has(tid)) return
      const conversationId = taskToConversation.current.get(tid) || pendingConversationId.current || currentConversationId.current || activeConversationId
      if (conversationId && !taskToConversation.current.has(tid)) taskToConversation.current.set(tid, conversationId)

      // 写/执行审批请求：交给全局覆盖层弹窗，不依赖消息簿记（不入 msgId 流程）
      if (e.kind === 'approval' && e.request) {
        const req = e.request
        setApprovals(qs => qs.some(q => q.id === req.id) ? qs
          : [...qs, { id: req.id, taskId: tid, agentId: e.agentId, tool: req.tool, toolName: req.toolName, label: req.label, detail: req.detail }])
        return
      }

      let msgId = taskToMsg.current.get(tid)
      if (!msgId && pendingMsgId.current) {
        msgId = pendingMsgId.current
        taskToMsg.current.set(tid, msgId)
        activeTaskIds.current.add(tid)
      }
      if (!msgId || !conversationId || ignoredMsgs.current.has(msgId)) return
      const localId = localTaskId.current.get(tid) ?? tid

      // 协作模式：collaborate:* 事件经 reducer 聚合到该消息的 collaboration；内部 agent 流不渲染普通气泡
      if (typeof e.kind === 'string' && e.kind.startsWith('collaborate:')) {
        collaborateTasks.current.add(tid)
        updateConversationMessages(conversationId, ms => ms.map(m => m.id === msgId
          ? { ...m, collaboration: applyCollaborateEvent(m.collaboration, e) } : m))
        if (e.kind === 'collaborate:final' || e.kind === 'collaborate:error') {
          setBusyOverride(o => ({ ...o }))
          updateConversationTasks(conversationId, ts => ts.map(t => t.id === localId
            ? { ...t, results: { ...(t.results || {}), collaborate: e.content || t.results?.collaborate || '' }, ...(e.error ? { errors: { ...(t.errors || {}), collaborate: e.error } } : {}) } : t))
        }
        return
      }

      // 编排模式：orchestrate:* 事件经 reducer 聚合到该消息的 orchestration；标记该任务
      if (typeof e.kind === 'string' && e.kind.startsWith('orchestrate:')) {
        orchestrateTasks.current.add(tid)
        updateConversationMessages(conversationId, ms => ms.map(m => m.id === msgId
          ? { ...m, orchestration: applyOrchestrateEvent(m.orchestration, e) } : m))
        if (e.kind === 'orchestrate:final' || e.kind === 'orchestrate:error') {
          setBusyOverride(o => ({ ...o }))
          updateConversationTasks(conversationId, ts => ts.map(t => t.id === localId
            ? { ...t, results: { ...(t.results || {}), orchestrate: e.content || t.results?.orchestrate || '' } } : t))
        }
        return
      }
      // 编排/协作任务的内部 agent 事件不渲染为普通气泡
      if (orchestrateTasks.current.has(tid) || collaborateTasks.current.has(tid)) return

      if (e.kind === 'start') {
        setBusyOverride(o => ({ ...o, [e.agentId]: 'busy' }))
        updateConversationMessages(conversationId, ms => ms.map(m => {
          if (m.id !== msgId) return m
          if (m.replies.some(r => r.agentId === e.agentId)) return m
          return { ...m, replies: [...m.replies, { agentId: e.agentId, thinking: '', text: '', done: false }] }
        }))
        updateConversationTasks(conversationId, ts => ts.map(t => t.id === localId && !t.agents.includes(e.agentId)
          ? { ...t, agents: [...t.agents, e.agentId] } : t))
      } else if (e.kind === 'delta') {
        updateConversationMessages(conversationId, ms => ms.map(m => m.id === msgId
          ? {
              ...m,
              replies: m.replies.map(r => r.agentId === e.agentId
                ? (e.channel === 'thinking'
                    ? { ...r, thinking: r.thinking + e.text }
                    : { ...r, text: r.text + e.text })
                : r)
            }
          : m))
      } else if (e.kind === 'activity' && e.step) {
        // Track A/B：结构化活动步骤（工具调用/思考），按 step.id upsert 进对应 reply 的 steps[]
        updateConversationMessages(conversationId, ms => ms.map(m => {
          if (m.id !== msgId) return m
          const exists = m.replies.some(r => r.agentId === e.agentId)
          const replies = exists
            ? m.replies.map(r => r.agentId === e.agentId ? { ...r, steps: upsertStep(r.steps, e.step) } : r)
            : [...m.replies, { agentId: e.agentId, thinking: '', text: '', done: false, steps: upsertStep(undefined, e.step) }]
          return { ...m, replies }
        }))
        // 同时落进任务历史，重启后仍可复查 agent 做了什么
        updateConversationTasks(conversationId, ts => ts.map(t => t.id === localId
          ? { ...t, steps: { ...(t.steps || {}), [e.agentId]: upsertStep(t.steps?.[e.agentId], e.step) } }
          : t))
      } else if (e.kind === 'done') {
        setBusyOverride(o => ({ ...o, [e.agentId]: undefined }))
        updateConversationMessages(conversationId, ms => ms.map(m => m.id === msgId
          ? { ...m, replies: m.replies.map(r => r.agentId === e.agentId ? { ...r, done: true } : r) }
          : m))
        updateConversationTasks(conversationId, ts => ts.map(t => t.id === localId
          ? {
              ...t,
              results: { ...(t.results || {}), [e.agentId]: e.content },
              usage: e.usage ? { ...(t.usage || {}), [e.agentId]: { ...e.usage, modelId: e.modelId } } : t.usage
            }
          : t))
      } else if (e.kind === 'error') {
        setBusyOverride(o => ({ ...o, [e.agentId]: undefined }))
        updateConversationMessages(conversationId, ms => ms.map(m => m.id === msgId
          ? { ...m, replies: m.replies.map(r => r.agentId === e.agentId ? { ...r, done: true, error: e.error } : r) }
          : m))
        updateConversationTasks(conversationId, ts => ts.map(t => t.id === localId
          ? { ...t, errors: { ...(t.errors || {}), [e.agentId]: e.error } }
          : t))
      }
    })
    return off
  }, [activeConversationId, updateConversationMessages, updateConversationTasks])

  /* ---------- 派发 ---------- */
  const runDispatch = useCallback(async (conversationId: string, msgId: string, localId: string, text: string, mode: DispatchMode, targetAgent?: string, workspaceId?: string | null, runOptions: DispatchRunOptions = {}) => {
    pendingMsgId.current = msgId
    pendingConversationId.current = conversationId
    try {
      const task = await window.electronAPI.hub.dispatch(text, mode, targetAgent || undefined, {
        workspaceId: workspaceId ?? null,
        requirePlanApproval: mode === 'orchestrate' && !targetAgent,
        rounds: runOptions.rounds,
        participants: runOptions.participants
      })
      if (task?.id) {
        taskToMsg.current.set(task.id, msgId)
        taskToConversation.current.set(task.id, conversationId)
        localTaskId.current.set(task.id, localId)
        activeTaskIds.current.delete(task.id)
      }
      return task
    } finally {
      pendingMsgId.current = null
      pendingConversationId.current = null
    }
  }, [])

  const ensureConversationForWorkspace = useCallback((workspaceId: string | null, seedTitle = '新对话'): string => {
    const targetWorkspaceId = workspaceId ?? null
    const active = conversations.find(c => c.id === activeConversationId)
    if (active && sameWorkspace(active.workspaceId, targetWorkspaceId)) return active.id
    const latest = latestConversationForWorkspace(conversations, targetWorkspaceId)
    if (latest) {
      setActiveConversationId(latest.id)
      return latest.id
    }
    const fresh = makeConversation(targetWorkspaceId, seedTitle)
    setConversations(prev => [fresh, ...prev])
    setActiveConversationId(fresh.id)
    return fresh.id
  }, [activeConversationId, conversations])

  const onSend = useCallback(async (text: string, mode: DispatchMode, targetAgent: string | null, workspaceId?: string | null, runOptions: DispatchRunOptions = {}) => {
    if (streaming) return
    if (mode === 'chain' && !targetAgent) return
    // 预算软上限：本次会话用量（按 token 或估算费用口径）达上限时确认后才继续（A2/B1）
    const budget = getBudget()
    if (budget > 0) {
      const used = getBudgetMode() === 'cost'
        ? tasks.reduce((s, t) => s + (sumCost(t.usage) || 0), 0)
        : tasks.reduce((s, t) => s + sumTokens(t.usage), 0)
      if (used >= budget &&
          !window.confirm(tr('本次会话用量已达预算上限，仍要继续派发吗？', 'Session usage reached the budget limit. Dispatch anyway?'))) {
        return
      }
    }
    const targetWorkspaceId = workspaceId ?? activeWorkspaceId ?? null
    const conversationId = ensureConversationForWorkspace(targetWorkspaceId, shortConversationTitle(text))
    const msgId = 'm' + Date.now()
    const localId = 'local-' + Date.now()
    const gen = cancelGen.current
    const preTargets = targetAgent ? [targetAgent]
      : mode === 'broadcast' ? bindings.map(b => b.agentId)
      : [] // auto：由后端路由，start 事件补卡

    currentMsgId.current = msgId
    currentConversationId.current = conversationId
    updateConversation(conversationId, conv => {
      const firstUserMessage = conv.messages.length === 0
      return {
        ...conv,
        workspaceId: targetWorkspaceId,
        title: firstUserMessage || conv.title === '新对话' ? shortConversationTitle(text) : conv.title,
        messages: [...conv.messages, {
          id: msgId, role: 'user', text, mode, taskId: localId,
          replies: preTargets.map(a => ({ agentId: a, thinking: '', text: '', done: false }))
        }],
        tasks: [{
          id: localId, text, mode, status: 'running', agents: preTargets,
          durationMs: null, createdAt: nowHHMM(), results: {}, errors: {}
        }, ...conv.tasks],
        updatedAt: Date.now()
      }
    })
    setStreaming(true)
    const start = Date.now()

    const finalize = (status: TaskItem['status'], globalError?: string) => {
      updateConversationTasks(conversationId, ts => ts.map(t => t.id === localId
        ? { ...t, status, durationMs: Date.now() - start, ...(globalError ? { errors: { ...(t.errors || {}), 系统: globalError } } : {}) }
        : t))
      updateConversationMessages(conversationId, ms => ms.map(m => m.id === msgId
        ? {
            ...m,
            replies: m.replies.length === 0 && globalError
              ? [{ agentId: '系统', thinking: '', text: '', done: true, error: globalError }]
              : m.replies.map(r => r.done ? r : { ...r, done: true, error: r.error ?? globalError })
          }
        : m))
      currentMsgId.current = null
      currentConversationId.current = null
      setStreaming(false)
      refreshStatus()
    }

    try {
      const task = await runDispatch(conversationId, msgId, localId, text, mode, targetAgent || undefined, targetWorkspaceId, runOptions)
      if (cancelGen.current !== gen) return
      const errs = asRecord(task?.errors)
      const status: TaskItem['status'] = task?.status === 'failed' ? 'failed'
        : task?.status === 'cancelled' ? 'cancelled' : 'completed'
      finalize(status, task?.error || (status === 'failed' ? Object.values(errs)[0] : undefined))
    } catch (e: any) {
      if (cancelGen.current === gen) finalize('failed', e?.message || String(e))
    }
  }, [activeWorkspaceId, bindings, ensureConversationForWorkspace, refreshStatus, runDispatch, streaming, tasks, updateConversation, updateConversationMessages, updateConversationTasks])

  const onApprovalDecide = useCallback((item: ApprovalItem, approved: boolean, remember: boolean) => {
    if (remember) window.electronAPI?.agentic?.setApprovalOverride?.(item.agentId, item.tool, approved ? 'allow' : 'deny').catch(() => {})
    window.electronAPI?.agentic?.resolveApproval?.(item.id, approved).catch(() => {})
    setApprovals(qs => qs.filter(q => q.id !== item.id))
  }, [])

  const onApprovePlan = useCallback((taskId: string, approved: boolean) => {
    window.electronAPI?.hub?.approvePlan?.(taskId, approved).catch(() => {})
  }, [])

  const onCancel = useCallback(() => {
    cancelGen.current++
    for (const tid of activeTaskIds.current) {
      ignoredTasks.current.add(tid)
      window.electronAPI.hub.cancel(tid).catch(() => {})
    }
    activeTaskIds.current.clear()
    collaborateTasks.current.clear()
    orchestrateTasks.current.clear()
    if (currentMsgId.current) {
      ignoredMsgs.current.add(currentMsgId.current)
    }
    const convId = currentConversationId.current || activeConversationId
    const msgId = currentMsgId.current
    currentMsgId.current = null
    currentConversationId.current = null
    pendingMsgId.current = null
    pendingConversationId.current = null
    if (convId && msgId) {
      updateConversationMessages(convId, ms => ms.map(m => m.id === msgId ? {
        ...m,
        replies: m.replies.map(r => r.done ? r : { ...r, done: true, cancelled: true })
      } : m))
      updateConversationTasks(convId, ts => ts.map(t => t.status === 'running' && t.id.startsWith('local-')
        ? { ...t, status: 'cancelled' } : t))
    }
    setBusyOverride({})
    setStreaming(false)
    setApprovals([])   // 取消后后端已拒绝所有待决审批，前端弹窗一并清空
    refreshStatus()
  }, [activeConversationId, refreshStatus, updateConversationMessages, updateConversationTasks])

  const onCancelTask = useCallback((id: string) => {
    const backendIds = [...localTaskId.current.entries()].filter(([, l]) => l === id).map(([b]) => b)
    const targets = backendIds.length ? backendIds : [id]
    for (const tid of targets) {
      ignoredTasks.current.add(tid)
      window.electronAPI.hub.cancel(tid).catch(() => {})
    }
    updateTaskAcrossConversations(ts => ts.map(t => t.id === id ? { ...t, status: 'cancelled' } : t))
  }, [updateTaskAcrossConversations])

  /* ---------- 设置操作 ---------- */
  const onSetEnabled = useCallback(async (id: string, enabled: boolean) => {
    setProviders(ps => ps.map(p => p.id === id ? { ...p, enabled } : p))
    try { await window.electronAPI.providers.setEnabled(id, enabled) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onSetKey = useCallback(async (id: string, key: string) => {
    setProviders(ps => ps.map(p => p.id === id ? { ...p, apiKey: key, enabled: p.enabled || !!key } : p))
    try { await window.electronAPI.providers.setKey(id, key) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onSetBinding = useCallback(async (b: BindingDef) => {
    setBindings(bs => bs.map(x => x.agentId === b.agentId ? b : x))
    try { await window.electronAPI.routing.setBinding(b) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onSetFallback = useCallback(async (chain: string[]) => {
    setFallbackChain(chain)
    try { await window.electronAPI.routing.setFallback(chain) } catch { /* noop */ }
    loadConfig()
  }, [loadConfig])

  const onUpsertProvider = useCallback(async (p: any) => {
    try { await window.electronAPI.providers.upsert(p) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onDeleteProvider = useCallback(async (id: string) => {
    try { await window.electronAPI.providers.delete(id) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  /* ---------- Agent 展示状态 ----------
     off：HTTP 绑定的提供商未启用或无 Key（如 hermes/gemini）；stdio 绑定不受影响 */
  const agents: AgentMap = {}
  for (const id of AGENT_IDS) {
    const b = bindings.find(x => x.agentId === id)
    const prov = providers.find(p => p.id === b?.providerId)
    const isStdio = b?.protocol === 'stdio-plain'
    const providerUsable = !!prov && prov.enabled && !!prov.apiKey
    let st: AgentUIStatus
    if (isStdio && !b?.binary?.trim()) st = 'off'
    else if (!isStdio && b && !providerUsable) st = 'off'
    else {
      const hub = hubAgents[id]
      st = hub === 'busy' ? 'busy' : hub === 'error' ? 'error' : hub === 'offline' ? 'off' : 'idle'
    }
    const ov = busyOverride[id]
    if (ov && st !== 'off') st = ov
    agents[id] = { status: st }
  }

  const connectionSummary = summarizeAgentConnections({ agents, bindings, providers })

  const goChat = (agentId: string | null) => { setActiveAgent(agentId); setPage('chat') }
  const openSetup = (tab: SetupTab | 'appearance' = 'providers') => {
    setSettingsTab(tab)
    setPage('settings')
  }
  const selectWorkspace = useCallback(async (workspaceId: string | null) => {
    setActiveWorkspaceId(workspaceId)
    try { await (window.electronAPI as any)?.workspaces?.setActive?.(workspaceId) } catch { /* noop */ }
    const latest = latestConversationForWorkspace(conversations, workspaceId)
    if (latest) {
      setActiveConversationId(latest.id)
    } else {
      const fresh = makeConversation(workspaceId)
      setConversations(prev => [fresh, ...prev])
      setActiveConversationId(fresh.id)
    }
    setActiveAgent(null)
    setPage('chat')
  }, [conversations])

  const newConversation = useCallback((workspaceId: string | null = activeWorkspaceId) => {
    const conv = makeConversation(workspaceId ?? null)
    setConversations(prev => [conv, ...prev])
    setActiveConversationId(conv.id)
    setActiveWorkspaceId(workspaceId ?? null)
    try { (window.electronAPI as any)?.workspaces?.setActive?.(workspaceId ?? null) } catch { /* noop */ }
    setActiveAgent(null)
    setPage('chat')
  }, [activeWorkspaceId])

  const selectConversation = useCallback((conversationId: string) => {
    const conv = conversations.find(c => c.id === conversationId)
    if (!conv) return
    setActiveConversationId(conv.id)
    setActiveWorkspaceId(conv.workspaceId)
    try { (window.electronAPI as any)?.workspaces?.setActive?.(conv.workspaceId) } catch { /* noop */ }
    setActiveAgent(null)
    setPage('chat')
  }, [conversations])

  const deleteConversation = useCallback((conversationId: string) => {
    const target = conversations.find(c => c.id === conversationId)
    if (!target) return
    if (target.tasks.some(t => t.status === 'running')) {
      window.alert(tr('这个对话还有运行中的任务，先停止任务后再删除。', 'This chat still has a running task. Stop it before deleting the chat.'))
      return
    }
    const ok = window.confirm(tr('删除这个对话？消息和任务记录会从侧栏移除，但不会删除工作区文件。', 'Delete this chat? Messages and task history will be removed from the sidebar, but workspace files will stay.'))
    if (!ok) return

    const remaining = conversations.filter(c => c.id !== conversationId)
    let nextConversations = remaining
    let nextActiveConversationId = activeConversationId
    let nextWorkspaceId = activeWorkspaceId
    const activeStillExists = !!nextActiveConversationId && remaining.some(c => c.id === nextActiveConversationId)

    if (activeConversationId === conversationId || !activeStillExists) {
      const next = latestConversationForWorkspace(remaining, target.workspaceId)
        ?? latestConversationForWorkspace(remaining, activeWorkspaceId)
        ?? remaining[0]
      if (next) {
        nextActiveConversationId = next.id
        nextWorkspaceId = next.workspaceId
      } else {
        const fresh = makeConversation(target.workspaceId ?? activeWorkspaceId ?? null)
        nextConversations = [fresh]
        nextActiveConversationId = fresh.id
        nextWorkspaceId = fresh.workspaceId
      }
    }

    taskToConversation.current.forEach((convId, taskId) => {
      if (convId === conversationId) taskToConversation.current.delete(taskId)
    })
    if (currentConversationId.current === conversationId) currentConversationId.current = nextActiveConversationId
    if (pendingConversationId.current === conversationId) pendingConversationId.current = null

    setConversations(nextConversations)
    setActiveConversationId(nextActiveConversationId)
    setActiveWorkspaceId(nextWorkspaceId ?? null)
    try { (window.electronAPI as any)?.workspaces?.setActive?.(nextWorkspaceId ?? null) } catch { /* noop */ }
    setActiveAgent(null)
    setPage('chat')
  }, [activeConversationId, activeWorkspaceId, conversations])

  const lang = useLang() // 语言切换时整树重挂载（key），组件内 tr() 直接生效

  return (
    <>
      <div className="ah-backdrop"><OrbitAurora /></div>
      <div key={lang} className={'orbit-app-shell' + (introVisible ? ' orbit-app-shell-intro' : '')} style={{ position: 'relative', zIndex: 1, height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Titlebar search={search} onSearch={v => { setSearch(v); if (v && page !== 'tasks') setPage('tasks') }} hubRunning={hubRunning} />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <Sidebar page={page} setPage={setPage} agents={agents}
            activeAgent={activeAgent} setActiveAgent={setActiveAgent}
            providerCount={providers.length || 4} proxyHost={proxyHost}
            workspaces={workspaces} activeWorkspaceId={activeWorkspaceId}
            conversations={conversations} activeConversationId={activeConversationId}
            onNewConversation={newConversation}
            onSelectWorkspace={selectWorkspace}
            onSelectConversation={selectConversation}
            onDeleteConversation={deleteConversation} />
          <div style={{ flex: 1, minWidth: 0, padding: '0 18px 14px 16px', overflowY: page === 'chat' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
            <Enter key={page} style={page === 'chat' ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}>
              {page === 'home' && <HomeScreen agents={agents} bindings={bindings} providers={providers} tasks={tasks} goChat={goChat}
                connectionSummary={connectionSummary} openSetup={openSetup} />}
              {page === 'chat' && <ChatScreen activeAgent={activeAgent} setActiveAgent={setActiveAgent}
                messages={messages} streaming={streaming} onSend={onSend} onCancel={onCancel}
                onApprovePlan={onApprovePlan}
                workspaceId={activeWorkspaceId} workspaces={workspaces} pickWorkspace={selectWorkspace}
                connectionSummary={connectionSummary} openSetup={openSetup} />}
              {page === 'tasks' && <TasksScreen tasks={tasks} search={search} onCancelTask={onCancelTask}
                openSetup={openSetup} />}
              {page === 'settings' && <SettingsScreen providers={providers} bindings={bindings}
                onSetEnabled={onSetEnabled} onSetKey={onSetKey} onSetBinding={onSetBinding}
                fallbackChain={fallbackChain} onSetFallback={onSetFallback} onReload={loadConfig}
                onUpsertProvider={onUpsertProvider} onDeleteProvider={onDeleteProvider}
                motion={motion} setMotion={setMotion} initialTab={settingsTab}
                connectionSummary={connectionSummary} goChat={goChat} openSetup={openSetup} />}
            </Enter>
          </div>
        </div>
      </div>
      {introVisible && <OrbitIntroSplash leaving={introLeaving} onDone={finishIntro} />}
      <ApprovalDialog items={approvals} onDecide={onApprovalDecide} />
    </>
  )
}
