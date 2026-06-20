/* ============================================================
   AgentHub 玻璃拟态 UI — 技能(Skill)页
   三块：能力矩阵（确认每个 agent 真实能力）/ 技能目录（增删 + 全部安装）/
   安装矩阵（单格=单独安装，行列「全部」=集体安装）。
   ============================================================ */

import React, { useState, useEffect, useCallback } from 'react'
import { Icon, IC, Enter, AgentMark, Switch, Seg } from '../glass/ui'
import { AGENT_META } from '../glass/meta'
import { tr } from '../glass/i18n'

type Pol = 'allow' | 'ask' | 'deny'
interface ApprovalCfg {
  version: 1
  default: { write: Pol; exec: Pol }
  overrides: Record<string, { write?: Pol; exec?: Pol }>
}

interface SkillDef {
  id: string; name: string; description: string; instructions: string
  tags: string[]; source: string; createdAt: number; updatedAt: number
}
interface CapState {
  agentId: string; name: string; protocol: 'http' | 'stdio-plain' | 'acp'
  nativeCli: boolean; httpAgentic: boolean; capabilities: string[]
}
type Installs = Record<string, string[]>

const CAP_ORDER = ['fs-read', 'fs-write', 'exec', 'agentic-loop', 'skills'] as const
const CAP_LABEL: Record<string, { zh: string; en: string }> = {
  'fs-read': { zh: '读文件', en: 'Read files' },
  'fs-write': { zh: '写文件', en: 'Write files' },
  'exec': { zh: '执行命令', en: 'Run commands' },
  'agentic-loop': { zh: '多步自驱', en: 'Agentic loop' },
  'skills': { zh: '技能', en: 'Skills' }
}

const api = () => (window as any).electronAPI

export function SkillsTab() {
  const [caps, setCaps] = useState<CapState[]>([])
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [installs, setInstalls] = useState<Installs>({})
  const [mode, setMode] = useState<'all' | 'selected'>('all')
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [c, s, i, m] = await Promise.all([
        api()?.agentic?.capabilities?.() as Promise<CapState[]>,
        api()?.skills?.list?.() as Promise<SkillDef[]>,
        api()?.skills?.getInstalls?.() as Promise<Installs>,
        api()?.agentic?.getMode?.() as Promise<'all' | 'selected'>
      ])
      if (Array.isArray(c)) setCaps(c)
      if (Array.isArray(s)) setSkills(s)
      setInstalls(i && typeof i === 'object' ? i : {})
      if (m === 'all' || m === 'selected') setMode(m)
    } catch (e: any) { setErr(e?.message || 'load failed') }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const agentIds = caps.map(c => c.agentId)

  const setAgentic = async (agentId: string, on: boolean) => {
    try { await api()?.agentic?.setEnabled?.(agentId, on); await refresh() } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const setAgenticMode = async (m: 'all' | 'selected') => {
    try { await api()?.agentic?.setMode?.(m); await refresh() } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const editSkill = async (id: string, patch: { name: string; description: string; instructions: string; tags: string[] }) => {
    try { await api()?.skills?.update?.(id, patch); await refresh() } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const isInstalled = (agentId: string, skillId: string) => (installs[agentId] || []).includes(skillId)
  const toggleInstall = async (agentId: string, skillId: string) => {
    try {
      if (isInstalled(agentId, skillId)) await api()?.skills?.uninstall?.(agentId, skillId)
      else await api()?.skills?.install?.(agentId, skillId)
      const i = await api()?.skills?.getInstalls?.(); setInstalls(i || {})
    } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const installAllForSkill = async (skillId: string, on: boolean) => {
    try { await api()?.skills?.[on ? 'install' : 'uninstall']?.('*', skillId); const i = await api()?.skills?.getInstalls?.(); setInstalls(i || {}) }
    catch (e: any) { setErr(e?.message || 'failed') }
  }
  const installAllForAgent = async (agentId: string, on: boolean) => {
    try {
      for (const s of skills) await api()?.skills?.[on ? 'install' : 'uninstall']?.(agentId, s.id)
      const i = await api()?.skills?.getInstalls?.(); setInstalls(i || {})
    } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const removeSkill = async (id: string, name: string) => {
    if (!window.confirm(tr(`删除技能「${name}」？已安装的 agent 会一并卸载。`, `Delete skill "${name}"? It will be uninstalled from all agents.`))) return
    try { await api()?.skills?.remove?.(id); await refresh() } catch (e: any) { setErr(e?.message || 'failed') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ah-hint" style={{ padding: '0 4px' }}>
        {tr('技能 = 一段注入给 agent 的指令包。可给单个 agent 装（点格子），或一键给全部 agent 装。开启「Agentic」后，HTTP 接入的模型也能像 codex/claude 一样在工作区读写文件、跑命令。',
            'A skill is an instruction pack injected into an agent. Install it per-agent (click a cell) or for all at once. Turn on "Agentic" so HTTP models also read/write files and run commands in the workspace, like codex/claude.')}
      </div>

      <CapabilityMatrix caps={caps} onToggleAgentic={setAgentic} mode={mode} onSetMode={setAgenticMode} />

      {caps.length > 0 && <ApprovalPolicyPanel caps={caps} />}

      <SkillCatalog skills={skills} onChanged={refresh} onRemove={removeSkill} onEdit={editSkill}
        onInstallAll={installAllForSkill} installs={installs} agentIds={agentIds} />

      {skills.length > 0 && agentIds.length > 0 && (
        <InstallMatrix skills={skills} caps={caps} isInstalled={isInstalled}
          onToggle={toggleInstall} onInstallAllForSkill={installAllForSkill} onInstallAllForAgent={installAllForAgent} />
      )}

      {err && <div className="glass" style={{ padding: '10px 14px', color: 'var(--st-error)', fontSize: 12 }}>{err}</div>}
    </div>
  )
}

/* ---------- 能力矩阵 ---------- */
function CapabilityMatrix({ caps, onToggleAgentic, mode, onSetMode }: {
  caps: CapState[]; onToggleAgentic: (id: string, on: boolean) => void
  mode: 'all' | 'selected'; onSetMode: (m: 'all' | 'selected') => void
}) {
  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.pulse} size={17} style={{ color: 'var(--ag-codex)' }} />
        <div style={{ fontWeight: 700 }}>{tr('能力矩阵', 'Capability matrix')}</div>
        <span className="ah-hint">{tr('确认每个接入 agent 的真实 agent 能力', 'confirm what each connected agent can really do')}</span>
        <div style={{ flex: 1 }} />
        <span className="ah-hint" style={{ fontSize: 11.5 }} title={tr('开启后所有 HTTP agent 默认具备 agentic（可逐个关闭）；关闭则改为按需启用', 'On: every HTTP agent is agentic by default (toggle off individually). Off: enable per agent.')}>
          {tr('默认全员 Agentic', 'Agentic for all')}
        </span>
        <Switch on={mode === 'all'} onChange={v => onSetMode(v ? 'all' : 'selected')} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: 'var(--tx-3)', textAlign: 'left' }}>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>Agent</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{tr('后端', 'Backend')}</th>
              {CAP_ORDER.map(c => (
                <th key={c} style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' }}>{tr(CAP_LABEL[c].zh, CAP_LABEL[c].en)}</th>
              ))}
              <th style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'center' }}>Agentic</th>
            </tr>
          </thead>
          <tbody>
            {caps.map(a => (
              <tr key={a.agentId} style={{ borderTop: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {AGENT_META[a.agentId] ? <AgentMark id={a.agentId} size={22} radius={6} /> : null}
                    <span style={{ fontWeight: 600 }}>{AGENT_META[a.agentId]?.name || a.name}</span>
                  </span>
                </td>
                <td style={{ padding: '8px 10px' }}>
                  <span className="ah-chip" style={{ fontSize: 10.5 }}>{a.protocol === 'acp' ? 'ACP' : a.protocol === 'stdio-plain' ? (a.nativeCli ? 'StdIO·CLI' : 'StdIO') : 'HTTP'}</span>
                </td>
                {CAP_ORDER.map(c => (
                  <td key={c} style={{ padding: '8px 10px', textAlign: 'center' }}>
                    {a.capabilities.includes(c)
                      ? <Icon d={IC.check} size={15} style={{ color: 'var(--mint)' }} />
                      : <span style={{ color: 'var(--tx-3)' }}>·</span>}
                  </td>
                ))}
                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                  {a.protocol === 'http'
                    ? <span style={{ display: 'inline-flex' }}><Switch on={a.httpAgentic} onChange={v => onToggleAgentic(a.agentId, v)} /></span>
                    : <span className="ah-hint" title={tr('stdio 原生 agentic', 'native stdio agentic')}>{tr('原生', 'native')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ah-hint" style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
        {tr('开启 Agentic 需该 agent 走 HTTP 绑定；建议先在「设置 → 工作区」指定一个项目目录，否则只读（禁止写文件/执行命令）。',
            'Enabling Agentic requires an HTTP binding; set a workspace under Settings → Workspaces first, otherwise it stays read-only (no writes / no command execution).')}
      </div>
    </Enter>
  )
}

/* ---------- 审批策略（写/执行门禁） ---------- */
function ApprovalPolicyPanel({ caps }: { caps: CapState[] }) {
  const [cfg, setCfg] = useState<ApprovalCfg | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const c = await api()?.agentic?.getApprovalConfig?.() as ApprovalCfg
      if (c && c.default) setCfg(c)
    } catch (e: any) { setErr(e?.message || 'load failed') }
  }, [])
  useEffect(() => { load() }, [load])
  if (!cfg) return null

  const setDefault = async (tool: 'write' | 'exec', policy: Pol) => {
    try { await api()?.agentic?.setApprovalDefault?.(tool, policy); await load() } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const setOverride = async (agentId: string, tool: 'write' | 'exec', policy: Pol | null) => {
    try { await api()?.agentic?.setApprovalOverride?.(agentId, tool, policy); await load() } catch (e: any) { setErr(e?.message || 'failed') }
  }

  const POL_OPTS = [
    { value: 'allow', label: tr('允许', 'Allow') },
    { value: 'ask', label: tr('询问', 'Ask') },
    { value: 'deny', label: tr('拒绝', 'Deny') }
  ]
  const OVR_OPTS = [{ value: 'default', label: tr('默认', 'Default') }, ...POL_OPTS]

  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} delay={90}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.bolt} size={17} style={{ color: '#f5b45a' }} />
        <div style={{ fontWeight: 700 }}>{tr('审批策略', 'Approval policy')}</div>
        <span className="ah-hint">{tr('agentic 写文件 / 执行命令前的放行规则', 'gate writes & command execution in the agentic loop')}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="ah-label">{tr('全局默认', 'Global default')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 92, fontSize: 12.5 }}>{tr('写文件', 'Write files')}</span>
          <Seg options={POL_OPTS} value={cfg.default.write} onChange={v => setDefault('write', v as Pol)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 92, fontSize: 12.5 }}>{tr('执行命令', 'Run commands')}</span>
          <Seg options={POL_OPTS} value={cfg.default.exec} onChange={v => setDefault('exec', v as Pol)} />
        </div>
      </div>

      <div className="ah-label" style={{ marginTop: 4 }}>{tr('按 Agent 覆盖', 'Per-agent overrides')}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: 'var(--tx-3)', textAlign: 'left' }}>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>Agent</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{tr('写文件', 'Write')}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{tr('执行命令', 'Exec')}</th>
            </tr>
          </thead>
          <tbody>
            {caps.map(a => {
              const o = cfg.overrides[a.agentId] || {}
              return (
                <tr key={a.agentId} style={{ borderTop: '1px solid var(--glass-border)' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {AGENT_META[a.agentId] ? <AgentMark id={a.agentId} size={22} radius={6} /> : null}
                      <span style={{ fontWeight: 600 }}>{AGENT_META[a.agentId]?.name || a.name}</span>
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <Seg options={OVR_OPTS} value={o.write ?? 'default'} onChange={v => setOverride(a.agentId, 'write', v === 'default' ? null : (v as Pol))} />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <Seg options={OVR_OPTS} value={o.exec ?? 'default'} onChange={v => setOverride(a.agentId, 'exec', v === 'default' ? null : (v as Pol))} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="ah-hint" style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
        {tr('「询问」会在运行时弹窗逐次审批；「拒绝」直接挡下并告知模型。只读（读/列文件）永不受限。默认全部「允许」，与旧版行为一致。',
            'Ask prompts you at run time; Deny blocks and tells the model. Read-only tools are never gated. Defaults to Allow (same as before).')}
      </div>
      {err && <div style={{ color: 'var(--st-error)', fontSize: 12 }}>{err}</div>}
    </Enter>
  )
}

/* ---------- 技能目录 + 添加 ---------- */
function SkillCatalog({ skills, onChanged, onRemove, onEdit, onInstallAll, installs, agentIds }: {
  skills: SkillDef[]; onChanged: () => void; onRemove: (id: string, name: string) => void
  onEdit: (id: string, patch: { name: string; description: string; instructions: string; tags: string[] }) => void
  onInstallAll: (skillId: string, on: boolean) => void; installs: Installs; agentIds: string[]
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '', tags: '' })
  const [builtins, setBuiltins] = useState<Array<{ name: string; description?: string; instructions: string; tags?: string[]; source?: string }>>([])

  useEffect(() => { api()?.skills?.builtins?.().then((b: any) => setBuiltins(Array.isArray(b) ? b : [])).catch(() => {}) }, [])

  const resetForm = () => { setDraft({ name: '', description: '', instructions: '', tags: '' }); setEditingId(null); setAdding(false) }
  const startAdd = () => { setEditingId(null); setDraft({ name: '', description: '', instructions: '', tags: '' }); setAdding(v => editingId ? true : !v) }
  const startEdit = (s: SkillDef) => {
    setEditingId(s.id)
    setDraft({ name: s.name, description: s.description, instructions: s.instructions, tags: (s.tags || []).join(', ') })
    setAdding(true)
  }

  const installedCount = (skillId: string) => agentIds.filter(a => (installs[a] || []).includes(skillId)).length
  const save = async () => {
    if (!draft.name.trim() || !draft.instructions.trim()) return
    const patch = {
      name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions,
      tags: draft.tags.split(',').map(t => t.trim()).filter(Boolean)
    }
    if (editingId) onEdit(editingId, patch)
    else await api()?.skills?.add?.({ ...patch, source: 'paste' })
    resetForm(); if (!editingId) onChanged()
  }
  const addBuiltin = async (b: typeof builtins[0]) => { await api()?.skills?.add?.(b); onChanged() }

  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} delay={60}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.bolt} size={17} style={{ color: 'var(--ag-claude)' }} />
        <div style={{ fontWeight: 700 }}>{tr('技能目录', 'Skill catalog')}</div>
        <span className="ah-hint">{skills.length} {tr('个技能', 'skills')}</span>
        <div style={{ flex: 1 }} />
        <button className="ah-btn sm primary" onClick={startAdd}>
          <Icon d={IC.plus} size={13} /> {tr('添加技能', 'Add skill')}
        </button>
      </div>

      {adding && (
        <div className="glass" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'var(--mint-line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
            <Icon d={editingId ? IC.pencil : IC.plus} size={14} style={{ color: 'var(--mint)' }} />
            {editingId ? tr('编辑技能', 'Edit skill') : tr('新建技能', 'New skill')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>{tr('名称', 'Name')}</div>
              <input className="ah-input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder={tr('如 代码审查', 'e.g. Code review')} />
            </div>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>{tr('标签（逗号分隔）', 'Tags (comma-separated)')}</div>
              <input className="ah-input" value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))}
                placeholder="review, coding" />
            </div>
          </div>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>{tr('一行描述', 'One-line description')}</div>
            <input className="ah-input" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
          </div>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>{tr('指令正文（SKILL.md 风格，会注入给 agent）', 'Instructions (SKILL.md style, injected to the agent)')}</div>
            <textarea className="ah-input mono" style={{ minHeight: 120, resize: 'vertical', width: '100%' }}
              value={draft.instructions} onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))}
              placeholder={tr('When the user asks for X, do Y…', 'When the user asks for X, do Y…')} />
          </div>
          {builtins.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="ah-label">{tr('内置模板', 'Templates')}:</span>
              {builtins.map((b, i) => (
                <button key={i} className="ah-btn sm" onClick={() => addBuiltin(b)} title={b.description}>
                  <Icon d={IC.plus} size={12} /> {b.name}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ah-btn sm" onClick={resetForm}>{tr('取消', 'Cancel')}</button>
            <button className="ah-btn sm primary" disabled={!draft.name.trim() || !draft.instructions.trim()} onClick={save}>
              <Icon d={IC.check} size={13} /> {editingId ? tr('保存', 'Save') : tr('创建', 'Create')}
            </button>
          </div>
        </div>
      )}

      {skills.length === 0 && !adding && (
        <div className="ah-hint" style={{ padding: '12px 4px', textAlign: 'center' }}>
          {tr('还没有技能。点「添加技能」粘贴一段 SKILL.md，或用内置模板。', 'No skills yet. Click "Add skill" to paste a SKILL.md, or use a template.')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {skills.map(s => {
          const n = installedCount(s.id)
          const allOn = n >= agentIds.length && agentIds.length > 0
          return (
            <div key={s.id} className="glass" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <button className="ah-btn sm" onClick={() => startEdit(s)} title={tr('编辑', 'Edit')}><Icon d={IC.pencil} size={13} /></button>
                <button className="ah-btn sm danger" onClick={() => onRemove(s.id, s.name)} title={tr('删除', 'Delete')}><Icon d={IC.trash} size={13} /></button>
              </div>
              {s.description && <div className="ah-hint" style={{ lineHeight: 1.5 }}>{s.description}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {s.tags.map(t => <span key={t} className="ah-chip" style={{ fontSize: 10 }}>{t}</span>)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <span className="ah-hint">{tr(`已装 ${n}/${agentIds.length}`, `${n}/${agentIds.length} agents`)}</span>
                <div style={{ flex: 1 }} />
                <button className="ah-btn sm" onClick={() => onInstallAll(s.id, !allOn)}>
                  {allOn ? tr('全部卸载', 'Uninstall all') : tr('全部安装', 'Install all')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </Enter>
  )
}

/* ---------- 安装矩阵（agent×skill） ---------- */
function InstallMatrix({ skills, caps, isInstalled, onToggle, onInstallAllForSkill, onInstallAllForAgent }: {
  skills: SkillDef[]; caps: CapState[]
  isInstalled: (agentId: string, skillId: string) => boolean
  onToggle: (agentId: string, skillId: string) => void
  onInstallAllForSkill: (skillId: string, on: boolean) => void
  onInstallAllForAgent: (agentId: string, on: boolean) => void
}) {
  const agentAllOn = (agentId: string) => skills.every(s => isInstalled(agentId, s.id))
  const skillAllOn = (skillId: string) => caps.every(c => isInstalled(c.agentId, skillId))
  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} delay={120}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.tasks} size={17} style={{ color: 'var(--ag-openclaw)' }} />
        <div style={{ fontWeight: 700 }}>{tr('安装矩阵', 'Install matrix')}</div>
        <span className="ah-hint">{tr('点格子=单独装，行/列「全部」=集体装', 'click a cell to install one; use row/column "all" for bulk')}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--tx-3)', fontWeight: 600 }}>{tr('技能 \\ Agent', 'Skill \\ Agent')}</th>
              {caps.map(c => (
                <th key={c.agentId} style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    {AGENT_META[c.agentId] ? <AgentMark id={c.agentId} size={22} radius={6} /> : <span style={{ fontWeight: 600 }}>{c.name}</span>}
                    <button className="ah-btn sm" style={{ padding: '1px 6px', fontSize: 10 }} onClick={() => onInstallAllForAgent(c.agentId, !agentAllOn(c.agentId))}>
                      {agentAllOn(c.agentId) ? tr('清空', 'clear') : tr('全部', 'all')}
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skills.map(s => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <button className="ah-btn sm" style={{ padding: '1px 6px', fontSize: 10 }} onClick={() => onInstallAllForSkill(s.id, !skillAllOn(s.id))}>
                      {skillAllOn(s.id) ? tr('清空', 'clear') : tr('全部', 'all')}
                    </button>
                  </div>
                </td>
                {caps.map(c => {
                  const on = isInstalled(c.agentId, s.id)
                  return (
                    <td key={c.agentId} style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <button onClick={() => onToggle(c.agentId, s.id)} title={on ? tr('点按卸载', 'click to uninstall') : tr('点按安装', 'click to install')}
                        style={{
                          width: 24, height: 24, borderRadius: 7, cursor: 'pointer',
                          border: '1px solid ' + (on ? 'var(--mint-line)' : 'var(--glass-border)'),
                          background: on ? 'var(--mint-soft)' : 'transparent',
                          color: on ? 'var(--mint)' : 'var(--tx-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                        {on ? <Icon d={IC.check} size={14} /> : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Enter>
  )
}
