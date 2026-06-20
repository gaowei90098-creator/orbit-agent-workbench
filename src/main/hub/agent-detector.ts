/**
 * Real agent detection - no mock data.
 */
import { execFileSync } from "child_process";
import { getProviderManager } from "../providers/manager";
import { AGENTS, agentCaps, agentName } from "./agents";

export interface DetectedAgent {
  id: string;
  name: string;
  found: boolean;
  version?: string;
  path?: string;
  capabilities: string[];
  providerId?: string | null;
  modelId?: string | null;
  baseUrl?: string | null;
  reachable?: boolean;
  latencyMs?: number | null;
  error?: string | null;
}

// 已知 agent 的探测项派生自 manifest（有 probeBinary 的）；marvis 无 CLI 不参与探测。
// 额外的发现型 CLI（非 AgentHub 内置 agent）单列，用于扫描机器上还装了哪些工具。
const EXTRA_PROBES = [
  { id: "aider", name: "Aider", binary: "aider", caps: ["coding", "pair-programming"] },
  { id: "goose", name: "Goose", binary: "goose", caps: ["automation", "coding"] },
  { id: "gemini", name: "Gemini CLI", binary: "gemini", caps: ["analysis", "coding"] },
  { id: "copilot", name: "Copilot CLI", binary: "copilot", caps: ["coding", "cli"] }
];

const CLI_PROBES = [
  ...AGENTS.filter(a => a.probeBinary).map(a => ({ id: a.id, name: a.name, binary: a.probeBinary as string, caps: a.caps })),
  ...EXTRA_PROBES
];

function probe(probe: typeof CLI_PROBES[0]) {
  try {
    const out = execFileSync(probe.binary, ["--version"], {
      timeout: 3000,
      encoding: "utf-8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const version = out.trim().split(/\r?\n/)[0];
    let binaryPath = probe.binary;
    try {
      const locator = process.platform === "win32" ? "where" : "which";
      binaryPath = execFileSync(locator, [probe.binary], {
        timeout: 2000,
        encoding: "utf-8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"]
      }).trim().split(/\r?\n/)[0].trim();
    } catch {}
    return { id: probe.id, name: probe.name, found: true, version, path: binaryPath, capabilities: probe.caps };
  } catch {
    return { id: probe.id, name: probe.name, found: false, capabilities: probe.caps };
  }
}

export function detectAgents() {
  const mgr = getProviderManager();
  const bindings = mgr.getBindings();
  const agents = bindings.map(b => {
    const resolved = mgr.resolveBinding(b.agentId);
    const provider = resolved && resolved.provider;
    const health = provider && provider.health;
    return {
      id: b.agentId,
      name: agentName(b.agentId),
      found: !!provider && provider.enabled && !!provider.apiKey,
      capabilities: agentCaps(b.agentId),
      providerId: provider && provider.id,
      modelId: resolved && resolved.model.id,
      baseUrl: provider && provider.baseUrl,
      reachable: health && health.reachable,
      latencyMs: health && health.latencyMs,
      error: health && health.error
    };
  });
  return agents.concat(CLI_PROBES.map(probe) as any);
}

export async function detectAgentsAsync() {
  const mgr = getProviderManager();
  for (const p of mgr.getEnabledProviders()) {
    await mgr.checkProviderHealth(p.id);
  }
  return detectAgents();
}
