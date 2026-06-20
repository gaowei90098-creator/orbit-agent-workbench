/* ============================================================
   AgentHub 玻璃拟态 UI — 设置页：提供商 / 路由 / 外观
   所有修改即时调 providers:* / routing:setBinding 并刷新 hub:status
   ============================================================ */

import React, { useState, useEffect, useCallback } from 'react'
import { Icon, IC, AgentMark, Enter, Seg, SectionTitle, Switch } from '../glass/ui'
import {
  AGENT_META,
  AGENT_IDS,
  DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID,
  EXECUTION_AGENT_IDS,
  MAIN_AGENT_ID,
  NOTIFICATION_BRIDGE_STORAGE_KEY,
  USER_BRIDGE_AGENT_IDS,
  DEFAULT_STDIO_ARGS,
  BindingDef,
  ProviderDef
} from '../glass/meta'
import { tr, agentDesc, getLang, setLang, Lang } from '../glass/i18n'
import { ConnectionSummary, SetupTab } from '../glass/connection-status'
import { SkillsTab } from './Skills' // AgentHub skills (Claude-B 新增)

export type MotionLevel = 'off' | 'subtle' | 'rich'
// 技能页是新增的本地标签，不属于 SetupTab；本组件内联合扩展（Claude-B 新增）
type TabKey = SetupTab | 'appearance' | 'skills'

export function SettingsScreen({ providers, bindings, onSetEnabled, onSetKey, onSetBinding, fallbackChain, onSetFallback, onReload, onUpsertProvider, onDeleteProvider, motion, setMotion, initialTab, connectionSummary, goChat }: {
  providers: ProviderDef[]
  bindings: BindingDef[]
  onSetEnabled: (id: string, enabled: boolean) => void
  onSetKey: (id: string, key: string) => void
  onSetBinding: (b: BindingDef) => void
  fallbackChain: string[]
  onSetFallback: (chain: string[]) => void
  onReload: () => void
  onUpsertProvider: (p: any) => void
  onDeleteProvider: (id: string) => void
  motion: MotionLevel
  setMotion: (m: MotionLevel) => void
  initialTab: SetupTab | 'appearance'
  connectionSummary: ConnectionSummary
  goChat: (agentId: string | null) => void
  openSetup: (tab?: SetupTab | 'appearance') => void
}) {
  const [tab, setTab] = useState<TabKey>(initialTab)
  useEffect(() => setTab(initialTab), [initialTab])
  return (
    <div data-screen-label="设置" style={{ padding: '6px 4px 30px' }}>
      <SectionTitle right={
        <Seg value={tab} onChange={v => setTab(v as TabKey)} options={[
          { value: 'providers', label: tr('提供商', 'Providers') }, { value: 'routing', label: tr('路由', 'Routing') },
          { value: 'workspaces', label: tr('工作区', 'Workspaces') },
          { value: 'skills', label: tr('技能', 'Skills') },
          { value: 'proxy', label: tr('代理', 'Proxy') }, { value: 'sites', label: tr('Agent 官网', 'Agent sites') },
          { value: 'appearance', label: tr('外观', 'Appearance') }
        ]} />
      }>{tr('设置', 'Settings')}</SectionTitle>
      <SetupNextStep summary={connectionSummary} onTab={setTab} goChat={goChat} />
      {tab === 'providers' && <ProvidersTab providers={providers} onSetEnabled={onSetEnabled} onSetKey={onSetKey} onReload={onReload}
        onUpsert={onUpsertProvider} onDelete={onDeleteProvider} />}
      {tab === 'routing' && <RoutingTab providers={providers} bindings={bindings} onSetBinding={onSetBinding} onTab={setTab} />}
      {tab === 'workspaces' && <WorkspacesTab />}
      {tab === 'skills' && <SkillsTab />}
      {tab === 'proxy' && <ProxyTab providers={providers} fallbackChain={fallbackChain} onSetFallback={onSetFallback} />}
      {tab === 'sites' && <AgentSitesTab />}
      {tab === 'appearance' && <AppearanceTab motion={motion} setMotion={setMotion} />}
    </div>
  )
}

function SetupNextStep({ summary, onTab, goChat }: {
  summary: ConnectionSummary
  onTab: (tab: SetupTab | 'appearance') => void
  goChat: (agentId: string | null) => void
}) {
  const readyAgent = summary.items.find(item =>
    (item.agentId === MAIN_AGENT_ID || EXECUTION_AGENT_IDS.includes(item.agentId)) && item.state === 'usable'
  )?.agentId ?? null
  const next = summary.items.find(item => item.action)
  return (
    <Enter className="glass" style={{ padding: 16, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{
        width: 34, height: 34, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: readyAgent ? 'var(--mint-soft)' : 'rgba(232,179,77,0.12)',
        color: readyAgent ? 'var(--mint)' : 'var(--st-busy)'
      }}>
        <Icon d={readyAgent ? IC.check : IC.bolt} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>
          {readyAgent ? tr('推荐下一步：发送一条试跑任务', 'Recommended next step: send a test task') : tr('推荐下一步：完成一个 Agent 连接', 'Recommended next step: connect one agent')}
        </div>
        <div className="ah-hint" style={{ lineHeight: 1.55 }}>
          {readyAgent
            ? tr('已有可用 Agent。试跑成功后，再继续补齐其他 Provider Key 或本地 CLI 路径。', 'At least one agent is ready. After a successful test, fill in the remaining provider keys or local CLI paths.')
            : next
            ? tr(next.detailZh, next.detailEn)
            : tr('先从 Provider Key 或 StdIO CLI 路径开始，完成后即可回到会话页派发。', 'Start with a provider key or StdIO CLI path, then return to Chat to dispatch.')}
        </div>
      </div>
      {next?.action && (
        <button className="ah-btn sm primary" onClick={() => onTab(next.action!.tab)}>
          {tr(next.action.labelZh, next.action.labelEn)}
        </button>
      )}
      <button className="ah-btn sm" disabled={!readyAgent} onClick={() => goChat(readyAgent)}>
        <Icon d={IC.send} size={13} /> {tr('去试跑', 'Run test')}
      </button>
    </Enter>
  )
}

/* ---------- Agent 官网 ---------- */
const AGENT_SITES: Array<{ id: string; site: string; install?: string; note?: { zh: string; en: string } }> = [
  { id: 'codex', site: 'https://openai.com/codex', install: 'npm install -g @openai/codex' },
  { id: 'claude', site: 'https://claude.com/claude-code', install: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'hermes', site: 'https://nousresearch.com', note: { zh: 'Hermes Agent 发行方官网，以官方发布渠道为准', en: 'Publisher site — follow official release channels' } }
]

function AgentSitesTab() {
  const open = (url: string) => { window.electronAPI?.app?.openExternal?.(url) }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
      <div className="ah-hint" style={{ padding: '0 4px' }}>
        {tr('已适配 Agent 的官方安装入口；安装后到「路由」里即可自动检测并接入。', 'Official install pages for supported agents. After installing, they are auto-detected under Routing.')}
      </div>
      {AGENT_SITES.map((s, i) => {
        const meta = AGENT_META[s.id]
        if (!meta) return null
        return (
          <Enter key={s.id} delay={i * 50} className="glass hover-glow" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <AgentMark id={s.id} size={36} radius={10} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 700 }}>{meta.name}</div>
              <div className="ah-hint">{agentDesc(s.id, meta.desc)}{s.note ? ' · ' + tr(s.note.zh, s.note.en) : ''}</div>
            </div>
            {s.install && (
              <span className="ah-chip" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{s.install}</span>
            )}
            <button className="ah-btn sm primary" onClick={() => open(s.site)}>
              <Icon d={IC.link} size={13} /> {s.site.replace(/^https?:\/\//, '')}
            </button>
          </Enter>
        )
      })}
      <Enter delay={320} className="glass" style={{ padding: 18, textAlign: 'center' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{tr('想要更多 Agent？请踹：', 'Want more agents? Kick us at:')}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="ah-btn sm" onClick={() => open('mailto:2674648836@qq.com')}>
            {tr('QQ邮箱', 'QQ Mail')}: 2674648836@qq.com
          </button>
          <button className="ah-btn sm" onClick={() => open('mailto:AgentHubask@Gmail.com')}>
            Gmail: AgentHubask@Gmail.com
          </button>
        </div>
      </Enter>
    </div>
  )
}

/* ---------- 提供商 ---------- */
const KIND_CAPS: Record<string, any> = {
  'openai-compatible': { protocol: 'chat_completions', stream: true, nativeThinking: false, budgetTokens: false, toolCalls: true, systemPrompt: true },
  'anthropic': { protocol: 'messages', stream: true, nativeThinking: true, budgetTokens: true, toolCalls: true, systemPrompt: true },
  'gemini': { protocol: 'generate_content', stream: true, nativeThinking: true, budgetTokens: true, toolCalls: true, systemPrompt: true }
}

const MODEL_PLACEHOLDER: Record<string, string> = {
  'openai-compatible': 'gpt-4o / deepseek-chat / qwen-plus',
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-flash'
}

function manualModel(modelId: string, kind = 'openai-compatible') {
  const id = modelId.trim().replace(/^models\//, '')
  return {
    id,
    label: id,
    contextWindow: kind === 'gemini' ? 1_000_000 : kind === 'anthropic' ? 200_000 : 128_000,
    supportsTools: true,
    supportsVision: kind !== 'openai-compatible',
    supportsThinking: kind === 'anthropic' || kind === 'gemini',
    maxThinkingLevel: kind === 'anthropic' ? 'xhigh' : kind === 'gemini' ? 'high' : undefined,
    defaultThinkingLevel: kind === 'anthropic' || kind === 'gemini' ? 'medium' : undefined,
    description: 'Manual model ID'
  }
}

function ProvidersTab({ providers, onSetEnabled, onSetKey, onReload, onUpsert, onDelete }: {
  providers: ProviderDef[]
  onSetEnabled: (id: string, enabled: boolean) => void
  onSetKey: (id: string, key: string) => void
  onReload: () => void
  onUpsert: (p: any) => void
  onDelete: (id: string) => void
}) {
  const [checking, setChecking] = useState<Record<string, boolean>>({})
  const [health, setHealth] = useState<Record<string, { reachable: boolean; status?: 'ok' | 'unauthorized' | 'error' | 'unreachable'; latencyMs?: number; error?: string }>>({})
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [fetching, setFetching] = useState<Record<string, boolean>>({})
  const [fetchMsg, setFetchMsg] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({})

  const checkHealth = async (id: string) => {
    setChecking(c => ({ ...c, [id]: true }))
    try {
      const h = await window.electronAPI.providers.health(id)
      setHealth(hs => ({ ...hs, [id]: h }))
    } catch (e: any) {
      setHealth(hs => ({ ...hs, [id]: { reachable: false, status: 'unreachable', error: e?.message || '检查失败' } }))
    } finally {
      setChecking(c => ({ ...c, [id]: false }))
    }
  }

  const fetchModels = async (id: string) => {
    setFetching(f => ({ ...f, [id]: true }))
    try {
      const r = await window.electronAPI.providers.fetchModels(id)
      setFetchMsg(m => ({ ...m, [id]: r.ok ? { ok: true, text: tr(`已更新 ${r.count} 个模型`, `Updated ${r.count} models`) } : { ok: false, text: r.error || tr('获取失败', 'Fetch failed') } }))
      if (r.ok) onReload()
    } catch (e: any) {
      setFetchMsg(m => ({ ...m, [id]: { ok: false, text: e?.message || tr('获取失败', 'Fetch failed') } }))
    } finally {
      setFetching(f => ({ ...f, [id]: false }))
    }
  }

  /* 自定义提供商表单 */
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', baseUrl: 'https://', apiKey: '', kind: 'openai-compatible', modelId: '' })
  const [urls, setUrls] = useState<Record<string, string>>({})

  const saveDraft = async () => {
    const modelId = draft.modelId.trim().replace(/^models\//, '')
    if (!draft.name.trim() || !/^https?:\/\//.test(draft.baseUrl) || !modelId) return
    const id = 'custom-' + Date.now()
    onUpsert({
      id,
      name: draft.name.trim(),
      kind: draft.kind,
      baseUrl: draft.baseUrl.trim().replace(/\/$/, ''),
      apiKey: draft.apiKey.trim(),
      enabled: !!draft.apiKey.trim(),
      builtIn: false,
      models: [manualModel(modelId, draft.kind)],
      capabilities: KIND_CAPS[draft.kind] || KIND_CAPS['openai-compatible'],
      defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true }
    })
    setAdding(false)
    setDraft({ name: '', baseUrl: 'https://', apiKey: '', kind: 'openai-compatible', modelId: '' })
    if (draft.apiKey.trim()) {
      // 建好后自动拉模型列表
      setTimeout(() => fetchModels(id), 600)
    }
  }

  const commitUrl = (p: ProviderDef) => {
    const v = urls[p.id]
    if (v !== undefined && v.trim() && v !== p.baseUrl) {
      onUpsert({ ...p, baseUrl: v.trim().replace(/\/$/, '') })
    }
  }

  const commitKey = (p: ProviderDef) => {
    const v = keys[p.id]
    if (v !== undefined && v !== p.apiKey) onSetKey(p.id, v)
  }

  const addManualModel = (p: ProviderDef) => {
    const modelId = (modelInputs[p.id] || '').trim().replace(/^models\//, '')
    if (!modelId) return
    if (p.models.some(m => m.id === modelId)) {
      setModelInputs(inputs => ({ ...inputs, [p.id]: '' }))
      return
    }
    onUpsert({ ...p, models: [...p.models, manualModel(modelId, p.kind)] })
    setModelInputs(inputs => ({ ...inputs, [p.id]: '' }))
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
      {providers.map((p, i) => {
        const h = health[p.id] ?? p.health
        return (
          <Enter key={p.id} delay={i * 60} className="glass hover-glow" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 13, opacity: p.enabled ? 1 : 0.65 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.08)', fontWeight: 700, fontSize: 14
              }}>{p.name.slice(0, 1)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name} <span className="ah-hint">{p.builtIn ? tr('内置', 'Built-in') : tr('自定义', 'Custom')}</span></div>
                {p.builtIn
                  ? <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.baseUrl}>{p.baseUrl}</div>
                  : <input className="ah-input mono" style={{ fontSize: 10.5, padding: '2px 7px', marginTop: 2 }}
                      value={urls[p.id] ?? p.baseUrl}
                      onChange={e => setUrls(u => ({ ...u, [p.id]: e.target.value }))}
                      onBlur={() => commitUrl(p)}
                      onKeyDown={e => { if (e.key === 'Enter') commitUrl(p) }} />}
              </div>
              <Switch on={p.enabled} onChange={v => onSetEnabled(p.id, v)} />
            </div>

            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>API Key</div>
              <input className="ah-input mono" type="text"
                value={keys[p.id] ?? p.apiKey}
                placeholder="sk-…"
                onChange={e => setKeys(ks => ({ ...ks, [p.id]: e.target.value }))}
                onBlur={() => commitKey(p)}
                onKeyDown={e => { if (e.key === 'Enter') commitKey(p) }} />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {p.models.slice(0, 10).map(m => <span key={m.id} className="ah-chip">{m.label}</span>)}
              {p.models.length > 10 && <span className="ah-chip" title={p.models.slice(10).map(m => m.label).join('、')}>+{p.models.length - 10}</span>}
              {p.models.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--st-busy)' }}>{tr('未设置模型名，路由会不可用', 'No model ID set; routing cannot use this provider')}</span>
              )}
            </div>

            {!p.builtIn && (
              <div>
                <div className="ah-label" style={{ marginBottom: 5 }}>{tr('手动添加模型名称', 'Manual model ID')}</div>
                <div style={{ display: 'flex', gap: 7 }}>
                  <input className="ah-input mono" style={{ flex: 1 }}
                    value={modelInputs[p.id] ?? ''}
                    placeholder={MODEL_PLACEHOLDER[p.kind] || MODEL_PLACEHOLDER['openai-compatible']}
                    onChange={e => setModelInputs(inputs => ({ ...inputs, [p.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') addManualModel(p) }} />
                  <button className="ah-btn sm" disabled={!modelInputs[p.id]?.trim()} onClick={() => addManualModel(p)}>
                    <Icon d={IC.plus} size={13} /> {tr('添加', 'Add')}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="ah-btn sm" onClick={() => checkHealth(p.id)} disabled={!!checking[p.id]}>
                <Icon d={IC.pulse} size={13} /> {checking[p.id] ? tr('检测中…', 'Checking…') : tr('健康检查', 'Health check')}
              </button>
              <button className="ah-btn sm" onClick={() => fetchModels(p.id)} disabled={!!fetching[p.id] || !(keys[p.id] ?? p.apiKey)}>
                <Icon d={IC.refresh} size={13} /> {fetching[p.id] ? tr('获取中…', 'Fetching…') : tr('获取模型', 'Fetch models')}
              </button>
              {h && (h.reachable
                ? <span style={{ fontSize: 12, color: 'var(--mint)', display: 'flex', alignItems: 'center', gap: 6 }}><span className="ah-dot idle"></span>{tr('可达', 'Reachable')} · {h.latencyMs}ms</span>
                : h.status === 'unauthorized'
                ? <span style={{ fontSize: 12, color: 'var(--st-busy)', display: 'flex', alignItems: 'center', gap: 6 }}><span className="ah-dot" style={{ background: 'var(--st-busy)' }}></span>{h.error || tr('鉴权失败', 'Unauthorized')}</span>
                : <span style={{ fontSize: 12, color: 'var(--st-error)', display: 'flex', alignItems: 'center', gap: 6 }}><span className="ah-dot error"></span>{h.error || tr('不可达', 'Unreachable')}</span>)}
              {fetchMsg[p.id] && (
                <span style={{ fontSize: 12, color: fetchMsg[p.id].ok ? 'var(--mint)' : 'var(--st-error)' }}>{fetchMsg[p.id].text}</span>
              )}
              {!p.builtIn && (
                <button className="ah-btn sm danger" style={{ marginLeft: 'auto' }}
                  onClick={() => { if (window.confirm(tr(`删除提供商「${p.name}」？相关路由绑定会一并清理。`, `Delete provider "${p.name}"? Related routing bindings will be cleaned up.`))) onDelete(p.id) }}>
                  {tr('删除', 'Delete')}
                </button>
              )}
            </div>
          </Enter>
        )
      })}

      {/* 添加自定义提供商 */}
      {adding ? (
        <Enter className="glass" style={{ gridColumn: '1 / -1', padding: 18, display: 'flex', flexDirection: 'column', gap: 13, borderColor: 'var(--mint-line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--mint-soft)', color: 'var(--mint)'
            }}><Icon d={IC.plus} size={17} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{tr('新建自定义提供商', 'New custom provider')}</div>
              <div className="ah-hint">{tr('任意 OpenAI 兼容中转 / Anthropic / Gemini 端点；创建后即可用于路由绑定、桌面接管与故障转移', 'Any OpenAI-compatible relay / Anthropic / Gemini endpoint; usable for routing, takeover and failover once created')}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) minmax(220px, 1fr) minmax(220px, 1.4fr)', gap: 10 }}>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>{tr('名称', 'Name')}</div>
              <input className="ah-input" value={draft.name} placeholder={tr('如 我的中转站', 'e.g. My relay')}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
            </div>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>{tr('协议', 'Protocol')}</div>
              <select className="ah-select" style={{ width: '100%' }} value={draft.kind}
                onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))}>
                <option value="openai-compatible">{tr('OpenAI 兼容（chat/completions）', 'OpenAI-compatible (chat/completions)')}</option>
                <option value="anthropic">Anthropic（messages）</option>
                <option value="gemini">Gemini（generateContent）</option>
              </select>
            </div>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>API Key <span className="ah-hint">{tr('可稍后再填', 'optional for now')}</span></div>
              <input className="ah-input mono" value={draft.apiKey} placeholder="sk-…"
                onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))} />
            </div>
          </div>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>{tr('模型名称 / Model ID', 'Model ID')} <span className="ah-hint">{tr('必填，必须和中转站支持的模型名完全一致', 'required; must exactly match the relay/provider model name')}</span></div>
            <input className="ah-input mono" value={draft.modelId} placeholder={MODEL_PLACEHOLDER[draft.kind] || MODEL_PLACEHOLDER['openai-compatible']}
              onChange={e => setDraft(d => ({ ...d, modelId: e.target.value }))} />
          </div>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>{tr('Base URL / 完整接口地址', 'Base URL / full endpoint')}</div>
            <input className="ah-input mono" value={draft.baseUrl} placeholder="https://api.example.com/v1 或 https://api.example.com/v1/chat/completions"
              onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ah-btn sm" onClick={() => setAdding(false)}>{tr('取消', 'Cancel')}</button>
            <button className="ah-btn sm primary" disabled={!draft.name.trim() || !/^https?:\/\/./.test(draft.baseUrl) || !draft.modelId.trim()}
              onClick={saveDraft}>
              <Icon d={IC.check} size={13} /> {draft.apiKey.trim() ? tr('创建并获取模型', 'Create & fetch models') : tr('创建', 'Create')}
            </button>
          </div>
        </Enter>
      ) : (
        <Enter className="glass hover-glow" style={{
          padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 9, cursor: 'pointer', borderStyle: 'dashed', color: 'var(--tx-3)', minHeight: 180,
          transition: 'border-color 0.2s, color 0.2s'
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--mint-line)'; e.currentTarget.style.color = 'var(--tx-2)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--glass-border)'; e.currentTarget.style.color = 'var(--tx-3)' }}
          onClick={() => setAdding(true)}>
          <span style={{
            width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.06)', border: '1px dashed var(--glass-border)'
          }}><Icon d={IC.plus} size={17} /></span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{tr('添加自定义提供商', 'Add custom provider')}</span>
          <span className="ah-hint">{tr('OpenAI 兼容中转 · Anthropic · Gemini', 'OpenAI-compatible relay · Anthropic · Gemini')}</span>
        </Enter>
      )}
    </div>
  )
}

/* ---------- 路由 ---------- */
const THINK_OPTS_FN = () => [
  { value: 'off', label: tr('关闭', 'Off') },
  { value: 'auto', label: tr('自动', 'Auto') },
  { value: 'enabled', label: tr('开启', 'On') }
]
const LEVEL_OPTS = ['minimal', 'low', 'medium', 'high', 'xhigh']

interface BinaryCandidate { source: 'desktop' | 'terminal'; label: string; path: string }

function RoutingTab({ providers, bindings, onSetBinding, onTab }: {
  providers: ProviderDef[]
  bindings: BindingDef[]
  onSetBinding: (b: BindingDef) => void
  onTab: (tab: SetupTab | 'appearance') => void
}) {
  const [located, setLocated] = useState<Record<string, BinaryCandidate[]>>({})
  useEffect(() => {
    window.electronAPI?.agents?.locate().then(setLocated).catch(() => {})
  }, [])
  const patch = (agentId: string, fn: (b: BindingDef) => BindingDef) => {
    const cur = bindings.find(b => b.agentId === agentId)
    if (cur) onSetBinding(fn({ ...cur, thinking: { ...cur.thinking } }))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <EvoMapMcpCard />
      <NotificationBridgeSelector />
      <AgenticEnableBanner bindings={bindings} located={located} onSetBinding={onSetBinding} onTab={onTab} />
      <div className="ah-hint" style={{ padding: '0 4px' }}>
        {tr('每个 Agent 可绑定到 HTTP 提供商（模型即点即切、实时生效），或切换为 StdIO 直连本地 CLI 子进程；终端版与桌面版同时安装时在 StdIO 的「使用版本」里选择。',
            'Bind each agent to an HTTP provider (models switch instantly), or use StdIO to drive the local CLI directly; pick terminal vs desktop builds under "Version" when both are installed.')}
      </div>
      {[...bindings].sort((a, b) => Number(b.agentId === MAIN_AGENT_ID) - Number(a.agentId === MAIN_AGENT_ID)).map((b, i) => <Enter key={b.agentId} delay={i * 60}>
        <BindingRow b={b} providers={providers} patch={patch} candidates={located[b.agentId] ?? []} />
      </Enter>)}
    </div>
  )
}

type EvoMapStatus = {
  connected?: boolean
  reason?: string
  tokenSource?: string
  tokenError?: string
  lastError?: { stage?: string; message?: string; at?: number } | null
  pendingCount?: number
  clientId?: string
  mcpEndpoint?: string
  authorizationEndpoint?: string
  scopes?: string
  expiresAt?: number
  authorizeUrl?: string
}

type EvoMapProbe = {
  ok?: boolean
  status?: string
  summary?: string
  toolCount?: number
  itemCount?: number
  reason?: string
}

const EVOMAP_LOCAL = 'http://127.0.0.1:9527'

function EvoMapMcpCard() {
  const [status, setStatus] = useState<EvoMapStatus | null>(null)
  const [probe, setProbe] = useState<EvoMapProbe | null>(null)
  const [loading, setLoading] = useState(false)
  const [probing, setProbing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${EVOMAP_LOCAL}/oauth/evomap/status`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus(await res.json())
    } catch (e: any) {
      setStatus(null)
      setError(e?.message || tr('无法读取 EvoMap 状态', 'Unable to read EvoMap status'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 15000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const openConnect = () => {
    const url = status?.authorizeUrl || `${EVOMAP_LOCAL}/oauth/evomap/start`
    const opened = window.electronAPI?.app?.openExternal?.(url)
    if (opened && typeof opened.catch === 'function') opened.catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
    else window.open(url, '_blank', 'noopener,noreferrer')
  }

  const openDocs = () => {
    const url = 'https://evomap.ai/learn/connect-ai-agent'
    const opened = window.electronAPI?.app?.openExternal?.(url)
    if (opened && typeof opened.catch === 'function') opened.catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
    else window.open(url, '_blank', 'noopener,noreferrer')
  }

  const runProbe = async () => {
    setProbing(true)
    setProbe(null)
    setError('')
    try {
      const q = encodeURIComponent('Orbit multi-agent orchestration EvoMap MCP')
      const res = await fetch(`${EVOMAP_LOCAL}/oauth/evomap/probe?q=${q}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setProbe(await res.json())
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('检测失败', 'Probe failed'))
    } finally {
      setProbing(false)
    }
  }

  const resetOAuth = async () => {
    const ok = window.confirm(tr('清除本机 EvoMap 授权状态和缓存，然后重新授权？', 'Clear local EvoMap auth state and cache, then reconnect?'))
    if (!ok) return
    setResetting(true)
    setError('')
    try {
      const res = await fetch(`${EVOMAP_LOCAL}/oauth/evomap/reset`, { method: 'POST', cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setProbe(null)
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('重置失败', 'Reset failed'))
    } finally {
      setResetting(false)
    }
  }

  const connected = !!status?.connected
  const expires = status?.expiresAt && status.expiresAt > Date.now()
    ? new Date(status.expiresAt).toLocaleString()
    : ''
  const reason = evoMapReasonText(status)
  const lastErrorText = status?.lastError?.message
    ? `${status.lastError.stage || 'oauth'}: ${status.lastError.message}`
    : ''

  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap', borderColor: connected ? 'color-mix(in srgb, var(--mint) 34%, var(--glass-border))' : 'color-mix(in srgb, var(--st-busy) 28%, var(--glass-border))' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: connected ? 'var(--mint-soft)' : 'rgba(232,179,77,0.12)', color: connected ? 'var(--mint)' : 'var(--st-busy)', flex: 'none' }}>
        <Icon d={connected ? IC.check : IC.link} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontWeight: 700 }}>{tr('EvoMap 自净化 MCP', 'EvoMap Self-Evolution MCP')}</div>
        <div className="ah-hint" style={{ lineHeight: 1.55 }}>
          {connected
            ? tr(`已连接 · ${status?.scopes || 'gene:read recipe:read reuse:query'}${expires ? ` · 到期 ${expires}` : ''}`, `Connected · ${status?.scopes || 'gene:read recipe:read reuse:query'}${expires ? ` · expires ${expires}` : ''}`)
            : reason}
          {status?.pendingCount ? tr(` · ${status.pendingCount} 个授权回调等待中`, ` · ${status.pendingCount} pending callback(s)`) : ''}
        </div>
        <div className="ah-hint" style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {status?.mcpEndpoint || 'https://evomap.ai/mcp'} · {status?.tokenSource || 'none'}
        </div>
        {lastErrorText && (
          <div className="ah-hint" style={{ marginTop: 6, lineHeight: 1.5, color: 'var(--st-error)' }}>
            {lastErrorText}
          </div>
        )}
        {status?.tokenError && (
          <div className="ah-hint" style={{ marginTop: 6, lineHeight: 1.5, color: 'var(--st-error)' }}>
            {status.tokenError}
          </div>
        )}
        {probe && (
          <div className="ah-hint" style={{ marginTop: 6, lineHeight: 1.5, color: probe.ok ? 'var(--mint)' : 'var(--tx-3)' }}>
            {probe.ok
              ? tr(`检测通过：${probe.summary || '已取得可用经验'} · ${probe.itemCount || 0} 项`, `Probe passed: ${probe.summary || 'usable context received'} · ${probe.itemCount || 0} items`)
              : tr(`检测结果：${probe.summary || probe.reason || probe.status || '未取得可用结果'}`, `Probe result: ${probe.summary || probe.reason || probe.status || 'no usable result'}`)}
          </div>
        )}
        {error && <div className="ah-hint" style={{ marginTop: 6, color: 'var(--st-error)' }}>{error}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="ah-btn sm" onClick={refresh} disabled={loading}>
          <Icon d={IC.refresh} size={13} /> {loading ? tr('刷新中', 'Refreshing') : tr('刷新', 'Refresh')}
        </button>
        <button className="ah-btn sm" onClick={runProbe} disabled={probing}>
          <Icon d={IC.pulse} size={13} /> {probing ? tr('检测中', 'Probing') : tr('检测 MCP', 'Probe MCP')}
        </button>
        <button className="ah-btn sm" onClick={openDocs}>
          <Icon d={IC.link} size={13} /> {tr('EvoMap 文档', 'EvoMap docs')}
        </button>
        <button className="ah-btn sm danger" onClick={resetOAuth} disabled={resetting}>
          <Icon d={IC.x} size={13} /> {resetting ? tr('重置中', 'Resetting') : tr('重置授权', 'Reset auth')}
        </button>
        <button className="ah-btn sm primary" onClick={openConnect}>
          <Icon d={IC.link} size={13} /> {connected ? tr('重新授权', 'Reconnect') : tr('连接 EvoMap', 'Connect EvoMap')}
        </button>
      </div>
    </Enter>
  )
}

function evoMapReasonText(status: EvoMapStatus | null): string {
  const reason = status?.reason || ''
  if (reason === 'token_unreadable') {
    return tr('本机旧 token 无法解密；请重置授权后重新连接。', 'Stored token cannot be decrypted on this Mac build; reset auth and reconnect.')
  }
  if (reason === 'expired') {
    return tr('授权已过期；请重新连接 EvoMap。', 'Authorization expired; reconnect EvoMap.')
  }
  if (reason === 'empty_token') {
    return tr('授权记录不完整；请重置授权后重新连接。', 'Authorization record is incomplete; reset auth and reconnect.')
  }
  return tr('未授权；主 Agent 会继续本地规划，但不会注入 EvoMap Gene / Capsule / Recipe。', 'Not authorized; the main Agent will continue local planning without EvoMap Gene / Capsule / Recipe context.')
}

function NotificationBridgeSelector() {
  const [choice, setChoice] = useState(DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID)
  useEffect(() => {
    let alive = true
    window.electronAPI?.store?.get(NOTIFICATION_BRIDGE_STORAGE_KEY)
      .then(value => {
        if (alive && typeof value === 'string' && USER_BRIDGE_AGENT_IDS.includes(value)) setChoice(value)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const pick = (agentId: string) => {
    if (!USER_BRIDGE_AGENT_IDS.includes(agentId)) return
    setChoice(agentId)
    window.electronAPI?.store?.set(NOTIFICATION_BRIDGE_STORAGE_KEY, agentId).catch(() => {})
  }

  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap', borderColor: 'color-mix(in srgb, var(--mint) 34%, var(--glass-border))' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--mint-soft)', color: 'var(--mint)', flex: 'none' }}>
        <Icon d={IC.send} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontWeight: 700 }}>{tr('用户通报通道', 'User progress bridge')}</div>
        <div className="ah-hint" style={{ lineHeight: 1.55 }}>
          {tr('Hermes 只负责通知用户、接收远程要求和确认回传；Orbit 的执行计划不会把代码、部署或数据库写入任务派给它。',
              'Hermes only notifies the user, receives remote requests, and relays approvals; Orbit will not assign code, deploy, or database work to it.')}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AgentMark id={choice} size={26} radius={7} />
          <span className="ah-label">{AGENT_META[choice]?.name ?? choice}</span>
        </div>
        <Seg value={choice} onChange={pick}
          options={USER_BRIDGE_AGENT_IDS.map(id => ({ value: id, label: AGENT_META[id]?.name ?? id }))} />
      </div>
    </Enter>
  )
}

/* 一键开启 agentic：把"检测到本机 CLI 但仍走 HTTP"的 agent 翻成 stdio-plain 直连，
   binary 留空(auto 用首选安装)、args 留空(用主进程 adapter 的 agentic 默认参数：
   codex `exec --json --sandbox danger-full-access …` / claude `--print --permission-mode acceptEdits`)，
   从"会描述行动"升级到"真在工作区读写文件、跑命令"，过程经 Phase 0 步骤卡呈现。 */
function AgenticEnableBanner({ bindings, located, onSetBinding, onTab }: {
  bindings: BindingDef[]
  located: Record<string, BinaryCandidate[]>
  onSetBinding: (b: BindingDef) => void
  onTab: (tab: SetupTab | 'appearance') => void
}) {
  const [hasWorkspace, setHasWorkspace] = useState<boolean | null>(null)
  useEffect(() => {
    window.electronAPI?.workspaces?.list?.()
      .then((ws: Array<unknown>) => setHasWorkspace(Array.isArray(ws) && ws.length > 0))
      .catch(() => setHasWorkspace(null))
  }, [])

  const hasCli = (agentId: string) => (located[agentId]?.length ?? 0) > 0
  const isAgentic = (b: BindingDef) => b.protocol === 'stdio-plain'
  const eligible = bindings.filter(b => EXECUTION_AGENT_IDS.includes(b.agentId) && hasCli(b.agentId) && !isAgentic(b))
  const enabledCount = bindings.filter(b => EXECUTION_AGENT_IDS.includes(b.agentId) && isAgentic(b) && (hasCli(b.agentId) || !!b.binary)).length

  const enable = (b: BindingDef) => onSetBinding({ ...b, thinking: { ...b.thinking }, protocol: 'stdio-plain', binary: '', args: '' })

  if (eligible.length === 0) {
    if (enabledCount === 0) return null
    return (
      <div className="glass" style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.check} size={16} style={{ color: 'var(--st-idle)', flex: 'none' }} />
        <span className="ah-hint" style={{ color: 'var(--tx-2)' }}>
          {tr(`已为 ${enabledCount} 个本地 CLI 开启 agentic — 直连子进程，在工作区读写文件、跑命令，过程以步骤卡呈现。`,
              `Agentic enabled for ${enabledCount} local CLI — direct subprocess that reads/writes files and runs commands in the workspace, shown as step cards.`)}
        </span>
      </div>
    )
  }

  return (
    <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 11, borderColor: 'color-mix(in srgb, var(--ag-codex) 40%, var(--glass-border))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.bolt} size={18} style={{ color: 'var(--ag-codex)', flex: 'none' }} />
        <div style={{ fontWeight: 700 }}>{tr('开启 agentic 能力', 'Turn on agentic capability')}</div>
      </div>
      <div className="ah-hint" style={{ lineHeight: 1.6 }}>
        {tr('默认走 HTTP 时 Agent 只会"描述"该怎么做。检测到本机已装下面这些 CLI——一键切到直连模式后，它们能真正在工作区读写文件、运行命令，每一步以折叠步骤卡实时呈现。',
            'On HTTP, agents only "describe" what to do. These CLIs are installed locally — one click switches them to direct mode so they actually read/write files and run commands in your workspace, with every step shown as a collapsible card.')}
      </div>
      {hasWorkspace === false && (
        <div className="ah-hint" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--st-busy)' }}>
          <Icon d={IC.folder} size={14} style={{ flex: 'none' }} />
          <span>{tr('还没有工作区。不设也能跑（用主目录），但建议先指定一个项目目录让 agent 在里面动手。', 'No workspace yet. It still runs (in your home dir), but pointing it at a project folder is recommended.')}</span>
          <button className="ah-btn sm" onClick={() => onTab('workspaces')}>{tr('去设置工作区', 'Set workspace')}</button>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {eligible.map(b => (
          <button key={b.agentId} className="ah-btn sm" onClick={() => enable(b)}>
            <Icon d={IC.bolt} size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
            {tr(`开启 ${AGENT_META[b.agentId]?.name ?? b.agentId}`, `Enable ${AGENT_META[b.agentId]?.name ?? b.agentId}`)}
          </button>
        ))}
        {eligible.length > 1 && (
          <button className="ah-btn sm primary" onClick={() => eligible.forEach(enable)}>
            {tr(`全部开启（${eligible.length}）`, `Enable all (${eligible.length})`)}
          </button>
        )}
      </div>
      <div className="ah-hint" style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
        {tr('需对应 CLI 已在本机登录（如 claude / codex 各自的 login）；未登录时派发会返回"去登录"提示。随时可在下方切回 HTTP。',
            'Requires each CLI to be logged in locally (e.g. claude / codex login); otherwise dispatch returns a "please log in" hint. You can switch back to HTTP below anytime.')}
      </div>
    </div>
  )
}

function BindingRow({ b, providers, patch, candidates }: {
  b: BindingDef
  providers: ProviderDef[]
  patch: (agentId: string, fn: (b: BindingDef) => BindingDef) => void
  candidates: BinaryCandidate[]
}) {
  const meta = AGENT_META[b.agentId]
  const prov = providers.find(p => p.id === b.providerId)
  const stdioSupported = b.agentId !== MAIN_AGENT_ID && b.agentId in AGENT_META
  const acpSupported = ['hermes'].includes(b.agentId)
  const isStdio = b.protocol === 'stdio-plain'
  const isAcp = b.protocol === 'acp'
  const [binary, setBinary] = useState<string | null>(null)
  const [args, setArgs] = useState<string | null>(null)
  const [customMode, setCustomMode] = useState(false)
  const temperature = b.temperature ?? 0.3
  if (!meta) return null

  const commitBinary = () => {
    if (binary !== null && binary !== (b.binary || '')) patch(b.agentId, x => ({ ...x, binary: binary }))
  }
  const commitArgs = () => {
    if (args !== null && args !== (b.args || '')) patch(b.agentId, x => ({ ...x, args: args }))
  }

  /* StdIO「使用版本」子选项：自动（首选）/ 各检测到的安装 / 自定义路径 */
  const matched = candidates.find(c => c.path.toLowerCase() === (b.binary || '').toLowerCase())
  const versionValue = customMode ? '__custom__'
    : !b.binary ? '__auto__'
    : matched ? matched.path
    : '__custom__'
  const pickVersion = (v: string) => {
    if (v === '__custom__') { setCustomMode(true); return }
    setCustomMode(false)
    setBinary(null)
    if (v === '__auto__') patch(b.agentId, x => ({ ...x, binary: '' }))
    else patch(b.agentId, x => ({ ...x, binary: v }))
  }

  /* HTTP 模型快切：仅列已配置（启用且有 Key）的供应商，按组分列，选中即生效 */
  const configured = providers.filter(p => p.enabled && p.apiKey && p.models.length > 0)
  const currentConfigured = configured.some(p => p.id === b.providerId)
  const pickModel = (v: string) => {
    const i = v.indexOf('/')
    if (i < 0) return
    patch(b.agentId, x => ({ ...x, providerId: v.slice(0, i), modelId: v.slice(i + 1) }))
  }

  return (
    <div className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <AgentMark id={b.agentId} size={36} radius={10} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{meta.name}</div>
          <div className="ah-hint">
            {agentDesc(b.agentId, meta.desc)}
            {b.agentId === MAIN_AGENT_ID && <span style={{ color: 'var(--mint)' }}> · {tr('负责拆分、派发、监督、汇总', 'plans, dispatches, supervises, synthesizes')}</span>}
            {USER_BRIDGE_AGENT_IDS.includes(b.agentId) && <span style={{ color: 'var(--mint)' }}> · {tr('用户通知/远程指令通道，不进执行池', 'user notification / remote-instruction bridge, excluded from execution pool')}</span>}
          </div>
        </div>
        <span className="ah-label">{tr('后端', 'Backend')}</span>
        <Seg value={b.protocol || 'http'}
          disabledKeys={[...(stdioSupported ? [] : ['stdio-plain']), ...(acpSupported ? [] : ['acp'])]}
          onChange={v => patch(b.agentId, x => ({ ...x, protocol: v as BindingDef['protocol'] }))}
          options={[{ value: 'http', label: 'HTTP' }, { value: 'stdio-plain', label: 'StdIO' }, { value: 'acp', label: 'ACP' }]} />
      </div>

      {(isStdio || isAcp) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>{tr('使用版本', 'Version')} <span className="ah-hint">{tr('终端版/桌面版自动检测，已去重', 'terminal/desktop builds auto-detected, deduped')}</span></div>
              <select className="ah-select" style={{ width: '100%' }} value={versionValue} onChange={e => pickVersion(e.target.value)}>
                <option value="__auto__">{candidates[0] ? tr(`自动（首选 ${candidates[0].label}）`, `Auto (prefers ${candidates[0].label})`) : tr('自动（未检测到安装）', 'Auto (none detected)')}</option>
                {candidates.map(c => (
                  <option key={c.path} value={c.path}>{c.label} · {c.path.length > 40 ? '…' + c.path.slice(-38) : c.path}</option>
                ))}
                <option value="__custom__">{tr('自定义路径…', 'Custom path…')}</option>
              </select>
            </div>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>{tr('附加参数', 'Extra args')} <span className="ah-hint">{isAcp ? tr('acp 子命令参数（留空用默认）', 'acp subcommand flags (blank = default)') : tr(`{prompt} 占位符=作参数，否则走 stdin`, `{prompt} placeholder = as argv, otherwise stdin`)}</span></div>
              <input className="ah-input mono" value={args ?? b.args ?? ''}
                placeholder={isAcp ? 'acp' : (DEFAULT_STDIO_ARGS[b.agentId] || '')}
                onChange={e => setArgs(e.target.value)}
                onBlur={commitArgs}
                onKeyDown={e => { if (e.key === 'Enter') commitArgs() }} />
            </div>
          </div>
          {(customMode || (versionValue === '__custom__')) && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Icon d={IC.terminal} size={16} style={{ color: meta.colorRaw, alignSelf: 'center' }} />
              <input className="ah-input mono" value={binary ?? b.binary ?? ''}
                placeholder="C:\Users\…\codex.exe"
                onChange={e => setBinary(e.target.value)}
                onBlur={commitBinary}
                onKeyDown={e => { if (e.key === 'Enter') commitBinary() }} />
            </div>
          )}
          <div className="ah-hint">
            {isAcp
              ? tr('ACP 模式：spawn 常驻 Agent Client Protocol server（JSON-RPC over stdio），工具/文件/思考等结构化活动直接呈现为步骤卡；附加参数为 acp 子命令参数（留空用默认）。提供商/模型设置不生效。',
                   'ACP mode: spawns a persistent Agent Client Protocol server (JSON-RPC over stdio); structured activity (tools/files/thoughts) renders as step cards. Extra args are acp subcommand flags (blank = default). Provider/model settings do not apply.')
              : tr('派发将 spawn 本地子进程，stdout 实时回流为流式输出；提供商/模型设置在 StdIO 模式下不生效。',
                'Dispatch spawns a local child process; stdout streams back live. Provider/model settings do not apply in StdIO mode.')}
            {candidates.length > 0
              ? tr(` 检测到 ${candidates.length} 个安装${matched ? `，当前使用：${matched.label}` : b.binary ? '' : `，自动使用 ${candidates[0].label}`}。`,
                   ` ${candidates.length} install(s) detected${matched ? `, using: ${matched.label}` : b.binary ? '' : `, auto-using ${candidates[0].label}`}.`)
              : tr(' 未检测到本机安装，请选「自定义路径…」手动填写。', ' No local install detected — pick "Custom path…" and fill it in.')}
          </div>
        </div>
      ) : (
        <div>
          <div className="ah-label" style={{ marginBottom: 5 }}>
            {tr('模型快切', 'Model quick-switch')} <span className="ah-hint">{tr('仅列已配置的供应商，选中即实时生效（重建路由并刷新状态）', 'configured providers only; applies instantly on select')}</span>
          </div>
          <select className="ah-select" style={{ width: '100%' }}
            value={b.providerId + '/' + b.modelId}
            onChange={e => pickModel(e.target.value)}>
            {configured.map(p => (
              <optgroup key={p.id} label={p.name}>
                {p.models.map(m => <option key={m.id} value={p.id + '/' + m.id}>{m.label}</option>)}
              </optgroup>
            ))}
            {!currentConfigured && prov && (
              <optgroup label={prov.name + tr('（未配置 Key）', ' (no key)')}>
                {prov.models.map(m => <option key={m.id} value={prov.id + '/' + m.id}>{m.label}</option>)}
              </optgroup>
            )}
            {configured.length === 0 && !prov && <option value="">{tr('无可用供应商 — 先到「提供商」配置 Key', 'No providers configured — add a key under Providers')}</option>}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span className="ah-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon d={IC.brain} size={14} />{tr('思考', 'Thinking')}</span>
        <Seg value={b.thinking.mode} onChange={v => patch(b.agentId, x => ({ ...x, thinking: { ...x.thinking, mode: v as BindingDef['thinking']['mode'] } }))} options={THINK_OPTS_FN()} />
        {b.thinking.mode !== 'off' && (
          <select className="ah-select" value={b.thinking.level}
            onChange={e => patch(b.agentId, x => ({ ...x, thinking: { ...x.thinking, level: e.target.value } }))}>
            {LEVEL_OPTS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }}></div>
        <span className="ah-label">{tr('随机性', 'Randomness')} {temperature.toFixed(1)}</span>
        <input type="range" className="ah-range" style={{ width: 110 }} min="0" max="2" step="0.1" value={temperature}
          title={tr('采样温度：越低越严谨稳定，越高越发散有创意', 'Sampling temperature: lower = steadier, higher = more creative')}
          onChange={e => patch(b.agentId, x => ({ ...x, temperature: parseFloat(e.target.value) }))} />
      </div>
    </div>
  )
}

/* ---------- 工作区 ---------- */
interface WorkspaceItem {
  id: string
  name: string
  rootPath: string
  createdAt: number
  updatedAt: number
}

function WorkspacesTab() {
  const [list, setList] = useState<WorkspaceItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; name: string; rootPath: string; isNew: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      const [l, a] = await Promise.all([
        window.electronAPI?.workspaces?.list?.() as Promise<WorkspaceItem[] | undefined>,
        window.electronAPI?.workspaces?.getActive?.() as Promise<string | null | undefined>
      ])
      if (Array.isArray(l)) setList(l)
      setActiveId(typeof a === 'string' ? a : null)
    } catch (e: any) { setErr(e?.message || '加载失败') }
  }
  useEffect(() => { refresh() }, [])
  const notifyWorkspacesChanged = () => {
    try { window.dispatchEvent(new CustomEvent('orbit:workspaces-changed')) } catch { /* noop */ }
  }

  const startNew = () => { setEditing({ id: null, name: '', rootPath: '', isNew: true }); setErr(null) }
  const startEdit = (w: WorkspaceItem) => { setEditing({ id: w.id, name: w.name, rootPath: w.rootPath, isNew: false }); setErr(null) }
  const pickFolder = async () => {
    try {
      const p = await (window.electronAPI as any)?.app?.pickFolder?.()
      if (p && editing) setEditing({ ...editing, rootPath: p })
    } catch { /* noop */ }
  }
  const save = async () => {
    if (!editing || !editing.name.trim() || !editing.rootPath.trim()) { setErr('名称和路径不能为空'); return }
    setBusy(true); setErr(null)
    try {
      if (editing.isNew) {
        const ws = await (window.electronAPI as any)?.workspaces?.create?.({ name: editing.name.trim(), rootPath: editing.rootPath.trim() })
        if (ws?.id) await (window.electronAPI as any)?.workspaces?.setActive?.(ws.id)
      } else if (editing.id) {
        await (window.electronAPI as any)?.workspaces?.update?.(editing.id, { name: editing.name.trim(), rootPath: editing.rootPath.trim() })
      }
      setEditing(null)
      await refresh()
      notifyWorkspacesChanged()
    } catch (e: any) {
      const code = e?.code
      setErr(code === 'WORKSPACE_PATH_INVALID' ? '路径不存在或不是目录' : (e?.message || '保存失败'))
    } finally { setBusy(false) }
  }
  const setActive = async (id: string) => {
    try { await (window.electronAPI as any)?.workspaces?.setActive?.(id); setActiveId(id); notifyWorkspacesChanged() } catch (e: any) {
      setErr(e?.message || '设置当前工作区失败')
    }
  }
  const remove = async (w: WorkspaceItem) => {
    if (!window.confirm(tr(`删除工作区「${w.name}」？该操作不影响磁盘上的项目文件。`, `Delete workspace "${w.name}"? Files on disk are not affected.`))) return
    try { await (window.electronAPI as any)?.workspaces?.remove?.(w.id); await refresh(); notifyWorkspacesChanged() } catch (e: any) {
      setErr(e?.message || '删除失败')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
      <div className="ah-hint" style={{ padding: '0 4px' }}>
        {tr('工作区 = agent 派发时的工作目录（cwd）与项目上下文。多个 agent 可共享同一工作区；在 Chat 顶部或此处切换，agent 将真正在项目里执行命令、读写文件。',
            'A workspace is the working directory and project context used when dispatching to an agent. Multiple agents can share the same workspace; switch it from Chat or here, and the agent will actually run commands and edit files in your project.')}
      </div>

      <Enter className="glass" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{tr('新建工作区', 'New workspace')}</div>
          <div className="ah-hint">{tr('挑一个项目根目录，agent 将从这里开始工作', 'Pick a project root; the agent will work from here')}</div>
        </div>
        <button className="ah-btn sm primary" onClick={startNew}><Icon d={IC.plus} size={13} />{tr('新建', 'New')}</button>
      </Enter>

      {editing && (
        <Enter className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, borderColor: 'var(--mint-line)' }}>
          <div style={{ fontWeight: 700 }}>{editing.isNew ? tr('新建工作区', 'New workspace') : tr('编辑工作区', 'Edit workspace')}</div>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>{tr('名称', 'Name')}</div>
            <input className="ah-input" autoFocus value={editing.name}
              placeholder={tr('如 我的项目', 'e.g. My project')}
              onChange={e => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>{tr('项目根目录', 'Project root')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="ah-input mono" style={{ flex: 1, fontSize: 12 }} value={editing.rootPath}
                placeholder="D:\Projects\my-app"
                onChange={e => setEditing({ ...editing, rootPath: e.target.value })} />
              <button className="ah-btn sm" onClick={pickFolder} type="button">
                <Icon d={IC.folder} size={13} />{tr('选择文件夹…', 'Browse…')}
              </button>
            </div>
            <div className="ah-hint" style={{ marginTop: 6 }}>
              {tr('Codex 会以 danger-full-access 非交互模式运行，并把当前工作区作为 -C 根目录；Claude Code 会以 acceptEdits 模式运行（自动接受文件编辑）。',
                  'Codex runs non-interactively with danger-full-access and uses the selected workspace as -C root; Claude Code runs in acceptEdits (auto-accepts edits).')}
            </div>
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--st-error)' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ah-btn sm" disabled={busy} onClick={() => { setEditing(null); setErr(null) }}>{tr('取消', 'Cancel')}</button>
            <button className="ah-btn sm primary" disabled={busy} onClick={save}><Icon d={IC.check} size={13} />{tr('保存', 'Save')}</button>
          </div>
        </Enter>
      )}

      {list.length === 0 && !editing && (
        <Enter delay={60} className="glass" style={{ padding: 24, textAlign: 'center', color: 'var(--tx-3)' }}>
          <Icon d={IC.folder} size={28} sw={1.2} />
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>{tr('还没有工作区', 'No workspaces yet')}</div>
          <div className="ah-hint" style={{ marginTop: 4 }}>{tr('新建一个工作区，让 agent 在你的项目里工作', 'Create one so the agent can work in your project')}</div>
        </Enter>
      )}

      {list.map((w, i) => (
        <Enter key={w.id} delay={i * 40} className="glass" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: activeId === w.id ? 'var(--mint-soft)' : 'rgba(255,255,255,0.06)',
            color: activeId === w.id ? 'var(--mint)' : 'var(--tx-2)'
          }}>
            <Icon d={IC.folder} size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700 }}>{w.name}{activeId === w.id && <span className="ah-chip mint" style={{ marginLeft: 8, fontSize: 10 }}>{tr('当前', 'Active')}</span>}</div>
            <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.rootPath}>{w.rootPath}</div>
          </div>
          {activeId !== w.id && <button className="ah-btn sm" onClick={() => setActive(w.id)}>{tr('设为当前', 'Set active')}</button>}
          <button className="ah-btn sm" onClick={() => startEdit(w)}><Icon d={IC.pencil} size={13} />{tr('编辑', 'Edit')}</button>
          <button className="ah-btn sm danger" onClick={() => remove(w)}><Icon d={IC.trash} size={13} />{tr('删除', 'Delete')}</button>
        </Enter>
      ))}

      {/* editing 不在时也展示全局错误（setActive/remove 失败） */}
      {!editing && err && (
        <div className="glass" style={{ padding: '10px 14px', color: 'var(--st-error)', fontSize: 12 }}>{err}</div>
      )}
    </div>
  )
}

/* ---------- 本地路由代理 ---------- */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button className="ah-btn sm" style={{ flex: 'none' }} onClick={async () => {
      try { await navigator.clipboard.writeText(text) } catch { /* noop */ }
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }}>
      <Icon d={copied ? IC.check : IC.copy} size={13} style={copied ? { color: 'var(--mint)' } : undefined} />
      {copied ? tr('已复制', 'Copied') : tr('复制', 'Copy')}
    </button>
  )
}

function MonoBlock({ text }: { text: string }) {
  return (
    <pre style={{
      background: 'rgba(0,0,0,0.32)', border: '1px solid var(--glass-border)', borderRadius: 9,
      padding: '9px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, overflowX: 'auto',
      whiteSpace: 'pre', color: 'var(--tx-2)', flex: 1, minWidth: 0
    }}>{text}</pre>
  )
}

interface TkState {
  supported: boolean
  configPath: string
  configExists: boolean
  takenOver: boolean
  model: string | null
  current: string | null
}

function ProxyTab({ providers, fallbackChain, onSetFallback }: {
  providers: ProviderDef[]
  fallbackChain: string[]
  onSetFallback: (chain: string[]) => void
}) {
  const [info, setInfo] = useState<{ openaiUrl: string; anthropicUrl: string; running: boolean } | null>(null)
  const [tk, setTk] = useState<Record<string, TkState>>({})
  const [tkModel, setTkModel] = useState<Record<string, string>>({})
  const [tkBusy, setTkBusy] = useState<string | null>(null)
  const [tkErr, setTkErr] = useState<string | null>(null)
  const [outProxy, setOutProxy] = useState('')
  const [outProxyInput, setOutProxyInput] = useState('')
  const [outProxySaved, setOutProxySaved] = useState(false)

  const loadTk = () => { window.electronAPI?.takeover?.status().then(setTk).catch(() => {}) }
  useEffect(() => {
    window.electronAPI?.proxy?.info().then(i => setInfo({
      openaiUrl: i.openaiUrl || i.url,
      anthropicUrl: i.anthropicUrl || i.url.replace(/\/v1$/, ''),
      running: i.running
    })).catch(() => {})
    loadTk()
    window.electronAPI?.network?.getProxy?.().then(v => { setOutProxy(v || ''); setOutProxyInput(v || '') }).catch(() => {})
  }, [])

  const saveOutProxy = async () => {
    try {
      const saved = (await window.electronAPI?.network?.setProxy?.(outProxyInput.trim())) ?? ''
      setOutProxy(saved); setOutProxyInput(saved)
      setOutProxySaved(true); setTimeout(() => setOutProxySaved(false), 1400)
    } catch { /* noop */ }
  }
  const openaiUrl = info?.openaiUrl ?? 'http://127.0.0.1:9528/v1'
  const anthropicUrl = info?.anthropicUrl ?? 'http://127.0.0.1:9528'

  const modelOptions = providers.filter(p => p.enabled && p.apiKey)
    .flatMap(p => p.models.map(m => ({ value: p.id + '/' + m.id, label: p.name + ' · ' + m.label })))

  const tkApply = async (app: string) => {
    const ref = tkModel[app] || tk[app]?.model || modelOptions[0]?.value
    if (!ref) return
    setTkBusy(app); setTkErr(null)
    try {
      await window.electronAPI.takeover.apply(app, ref)
      loadTk()
    } catch (e: any) {
      setTkErr(e?.message || '接管失败')
    } finally { setTkBusy(null) }
  }

  const tkRestore = async (app: string) => {
    setTkBusy(app); setTkErr(null)
    try {
      await window.electronAPI.takeover.restore(app)
      loadTk()
    } catch (e: any) {
      setTkErr(e?.message || '恢复失败')
    } finally { setTkBusy(null) }
  }

  const toggleFallback = (id: string) => {
    onSetFallback(fallbackChain.includes(id) ? fallbackChain.filter(x => x !== id) : [...fallbackChain, id])
  }

  const claudeSnippet = `$env:ANTHROPIC_BASE_URL = "${anthropicUrl}"\n$env:ANTHROPIC_AUTH_TOKEN = "agenthub"\nclaude`
  const codexSnippet = `# ~/.codex/config.toml\nmodel_provider = "agenthub"\nmodel = "deepseek/deepseek-chat"\n\n[model_providers.agenthub]\nname = "AgentHub Proxy"\nbase_url = "${openaiUrl}"\nwire_api = "chat"`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
      {/* 出站代理 */}
      <Enter className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={'ah-dot ' + (outProxy ? 'idle' : 'off')}></span>
          <div style={{ fontWeight: 700 }}>{tr('出站代理', 'Outbound proxy')}</div>
          <span className="ah-hint">{tr('Orbit 访问 Provider / 健康检查时经此代理。被墙或代理用 fake-ip 时必填（如 Shadowrocket/Clash 的本地端口）。留空 = 直连。', 'Orbit routes provider requests through this proxy. Required when the provider is blocked or your proxy uses fake-ip (e.g. Shadowrocket/Clash local port). Empty = direct.')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input className="ah-input mono" style={{ flex: 1 }} placeholder="127.0.0.1:1082"
            value={outProxyInput} onChange={e => setOutProxyInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveOutProxy() }} />
          <button className="ah-btn sm primary" style={{ flex: 'none' }} onClick={saveOutProxy}>
            {outProxySaved ? tr('已保存', 'Saved') : tr('保存', 'Save')}
          </button>
        </div>
        <div className="ah-hint">{tr('支持 host:port、http://host:port、socks5://host:port；保存后立即生效，无需重启。', 'Accepts host:port, http://host:port, or socks5://host:port. Applies immediately, no restart needed.')}</div>
      </Enter>

      {/* 接入地址 */}
      <Enter className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={'ah-dot ' + (info?.running === false ? 'error' : 'idle')}></span>
          <div style={{ fontWeight: 700 }}>{tr('本地路由代理', 'Local routing proxy')}</div>
          <span className="ah-hint">{tr('协议转换：OpenAI / Anthropic 入站 → 任意厂商出站（DeepSeek、Gemini 等）', 'Protocol conversion: OpenAI / Anthropic inbound → any provider outbound')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="ah-label" style={{ width: 130, flex: 'none' }}>{tr('OpenAI 兼容', 'OpenAI-compatible')}</span>
          <MonoBlock text={openaiUrl} />
          <CopyBtn text={openaiUrl} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="ah-label" style={{ width: 130, flex: 'none' }}>{tr('Anthropic 兼容', 'Anthropic-compatible')}</span>
          <MonoBlock text={anthropicUrl} />
          <CopyBtn text={anthropicUrl} />
        </div>
        <div className="ah-hint">
          {tr('模型名支持 provider/model（如 deepseek/deepseek-chat）精确指路，或 agent/codex 走该 Agent 的路由绑定；未知模型名自动走默认路由（/v1/messages → claude 绑定，/v1/chat/completions → codex 绑定）。',
              'Model names accept provider/model (e.g. deepseek/deepseek-chat) or agent/codex to use that agent\'s binding; unknown names fall back to the default route (/v1/messages → claude, /v1/chat/completions → codex).')}
        </div>
      </Enter>

      {/* 故障转移 */}
      <Enter delay={60} className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700 }}>{tr('故障转移链', 'Failover chain')}</div>
        <div className="ah-hint">
          {tr('首选厂商请求失败（且尚未回流任何内容）时，按以下顺序自动重试；同一厂商连续失败 3 次将熔断 60 秒。点击厂商加入/移出。',
              'When the primary provider fails (before any output), retry in this order; 3 consecutive failures trip a 60s circuit breaker. Click providers to add/remove.')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {providers.filter(p => p.enabled && p.apiKey).map(p => {
            const idx = fallbackChain.indexOf(p.id)
            const active = idx >= 0
            return (
              <button key={p.id} onClick={() => toggleFallback(p.id)} className="ah-chip" style={{
                cursor: 'pointer', font: 'inherit', fontSize: 11.5, border: '1px solid',
                borderColor: active ? 'var(--mint-line)' : 'rgba(255,255,255,0.08)',
                color: active ? 'var(--mint)' : 'var(--tx-2)',
                background: active ? 'var(--mint-soft)' : 'rgba(255,255,255,0.05)'
              }}>
                {active && <span style={{ fontWeight: 700 }}>{idx + 1}</span>}{p.name}
              </button>
            )
          })}
          {providers.filter(p => p.enabled && p.apiKey).length === 0 &&
            <span className="ah-hint">{tr('暂无可用厂商 — 先在「提供商」里配置 API Key', 'No providers available — configure an API key first')}</span>}
        </div>
      </Enter>

      {/* 实时接管桌面 Agent */}
      <Enter delay={90} className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 700 }}>{tr('桌面 Agent 接管', 'Desktop agent takeover')}</div>
          <span className="ah-hint">{tr('改写应用 live 配置指向本地代理；之后换模型只需点「更新」，立刻生效', 'Rewrites the app\'s live config to point at the local proxy; switching models later is just "Update"')}</span>
        </div>
        {(['codex', 'claude', 'hermes'] as const).map(app => {
          const s = tk[app]
          const meta = AGENT_META[app]
          const cfgLabel = {
            codex: '~/.codex/config.toml', claude: '~/.claude/settings.json',
            hermes: '~/.hermes/config.yaml'
          }[app]
          return (
            <div key={app} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <AgentMark id={app} size={28} radius={8} />
              <div style={{ width: 150, flex: 'none' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.name}</div>
                <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }} title={s?.configPath}>
                  {cfgLabel}
                </div>
              </div>
              {s?.takenOver
                ? <span className="ah-chip mint">{tr('已接管', 'Taken over')} · <span style={{ fontFamily: 'var(--font-mono)' }}>{s.model || tr('默认路由', 'default route')}</span></span>
                : <span className="ah-chip">{tr('未接管', 'Not taken over')}{s?.current ? tr(` · 当前 ${s.current}`, ` · current ${s.current}`) : ''}</span>}
              <div style={{ flex: 1 }}></div>
              <select className="ah-select" style={{ maxWidth: 260 }}
                value={tkModel[app] || s?.model || modelOptions[0]?.value || ''}
                onChange={e => setTkModel(m => ({ ...m, [app]: e.target.value }))}>
                {modelOptions.length === 0 && <option value="">{tr('无可用模型 — 先配置提供商', 'No models — configure a provider first')}</option>}
                {modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button className="ah-btn sm primary" disabled={tkBusy === app || modelOptions.length === 0}
                onClick={() => tkApply(app)}>
                {tkBusy === app ? tr('写入中…', 'Writing…') : s?.takenOver ? tr('更新', 'Update') : tr('接管', 'Take over')}
              </button>
              {s?.takenOver && (
                <button className="ah-btn sm danger" disabled={tkBusy === app} onClick={() => tkRestore(app)}>{tr('恢复', 'Restore')}</button>
              )}
            </div>
          )
        })}
        {tkErr && <div style={{ fontSize: 12, color: 'var(--st-error)' }}>{tkErr}</div>}
        <div className="ah-hint">
          {tr('首次接管会备份原配置（同目录 .agenthub-bak），「恢复」精确还原原值。Codex / Hermes 对新会话生效；Claude Code 对新启动的会话生效。接管不影响会话页的 StdIO 直连派发。',
              'First takeover backs up the original config (.agenthub-bak alongside); "Restore" reverts exactly. Codex/Hermes apply to new sessions; Claude Code to newly started sessions. StdIO dispatch in Chat is unaffected.')}
        </div>
      </Enter>

      {/* 接管示例（手动方式） */}
      <Enter delay={120} className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>{tr('手动接管示例', 'Manual takeover snippets')}</div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className="ah-label">{tr('Claude Code → 任意厂商', 'Claude Code → any provider')}</span>
            <span className="ah-hint">{tr('（PowerShell；token 任意非空值即可）', '(PowerShell; any non-empty token works)')}</span>
            <div style={{ flex: 1 }}></div>
            <CopyBtn text={claudeSnippet} />
          </div>
          <MonoBlock text={claudeSnippet} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className="ah-label">{tr('Codex → 任意厂商', 'Codex → any provider')}</span>
            <span className="ah-hint">{tr('（写入 ~/.codex/config.toml）', '(written to ~/.codex/config.toml)')}</span>
            <div style={{ flex: 1 }}></div>
            <CopyBtn text={codexSnippet} />
          </div>
          <MonoBlock text={codexSnippet} />
        </div>
        <div className="ah-hint">
          {tr('说明：代理目前转换文本内容与思考流（reasoning/thinking 双向映射），工具调用（tool use）透传尚未实现——接管后 CLI 的纯问答可用，涉及本地工具的代理任务建议仍走官方协议或 StdIO 直连。',
              'Note: the proxy converts text and thinking streams; tool-use passthrough is not implemented yet — plain Q&A works after takeover, but agentic tool tasks should stay on the official protocol or StdIO.')}
        </div>
      </Enter>
    </div>
  )
}

/* ---------- 外观 / 动效 / 语言 ---------- */
const MOTION_LEVELS: Array<{ value: MotionLevel; zh: string; en: string; descZh: string; descEn: string }> = [
  { value: 'off', zh: '关闭', en: 'Off', descZh: '无任何动画与过渡。适合低性能设备或偏好静态界面。', descEn: 'No animations or transitions. Best for low-end devices or a static UI.' },
  { value: 'subtle', zh: '简洁', en: 'Subtle', descZh: '仅保留短促淡入与状态脉冲，无交错延迟、无装饰性动画。', descEn: 'Short fades and status pulses only — no stagger, no decorative motion.' },
  { value: 'rich', zh: '丰富', en: 'Rich', descZh: '卡片交错入场、背景光斑漂移、悬浮辉光、弹性微交互、折叠过渡。', descEn: 'Staggered entrances, drifting backdrop blobs, hover glow, springy micro-interactions.' }
]

function AppearanceTab({ motion, setMotion }: { motion: MotionLevel; setMotion: (m: MotionLevel) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      {/* 语言 */}
      <Enter className="glass" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{tr('界面语言', 'Interface language')}</div>
          <div className="ah-hint">{tr('切换整个界面的显示语言，即时生效', 'Switch the display language of the entire UI, applies instantly')}</div>
        </div>
        <Seg value={getLang()} onChange={v => setLang(v as Lang)}
          options={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }]} />
      </Enter>

      <Enter delay={50} className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{tr('动效与动画', 'Motion & animation')}</div>
            <div className="ah-hint">{tr('控制全局过渡、入场动画与装饰性动效的强度，即时生效', 'Controls transitions, entrances and decorative motion globally, applies instantly')}</div>
          </div>
          <Seg value={motion} onChange={v => setMotion(v as MotionLevel)}
            options={MOTION_LEVELS.map(l => ({ value: l.value, label: tr(l.zh, l.en) }))} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {MOTION_LEVELS.map(l => (
            <div key={l.value} onClick={() => setMotion(l.value)} style={{
              padding: '11px 13px', borderRadius: 12, cursor: 'pointer',
              background: motion === l.value ? 'var(--mint-soft)' : 'rgba(0,0,0,0.18)',
              border: '1px solid ' + (motion === l.value ? 'var(--mint-line)' : 'var(--glass-border)'),
              transition: 'background 0.2s, border-color 0.2s'
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: motion === l.value ? 'var(--mint)' : 'var(--tx-1)', marginBottom: 3 }}>{tr(l.zh, l.en)}</div>
              <div className="ah-hint" style={{ lineHeight: 1.5 }}>{tr(l.descZh, l.descEn)}</div>
            </div>
          ))}
        </div>
        {/* 实时预览：切档重播入场 */}
        <div>
          <div className="ah-label" style={{ marginBottom: 8 }}>{tr('预览（切换档位会重播入场动画）', 'Preview (switching replays the entrance)')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {AGENT_IDS.map((id, i) => (
              <Enter key={motion + id} delay={i * 70} className="glass hover-glow" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 9 }}>
                <AgentMark id={id} size={26} radius={7} />
                <span style={{ fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{AGENT_META[id].name}</span>
                <span className="ah-dot busy" style={{ marginLeft: 'auto' }}></span>
              </Enter>
            ))}
          </div>
        </div>
      </Enter>
    </div>
  )
}
