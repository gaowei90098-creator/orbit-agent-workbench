/**
 * Thinking capability helpers.
 * Pure functions for clamping/normalising ThinkingConfig.
 */

import type { ModelDefinition, ProviderDefinition, ThinkingConfig, ThinkingLevel, ThinkingMode } from "../providers/types"
import { THINKING_BUDGET_TOKENS, THINKING_LEVELS } from "../providers/presets"

export function normalizeThinking(t: ThinkingConfig | undefined, fallback: ThinkingConfig): ThinkingConfig {
  if (!t) return fallback
  const level: ThinkingLevel = t.level || fallback.level || "medium"
  return {
    mode: t.mode || "off",
    level,
    budgetTokens: t.budgetTokens ?? THINKING_BUDGET_TOKENS[level],
    collapseInUI: t.collapseInUI ?? true
  }
}

export function isThinkingAllowed(model: ModelDefinition, provider: ProviderDefinition, mode: ThinkingMode): boolean {
  if (mode === "off") return true
  return !!model.supportsThinking && provider.capabilities.nativeThinking
}

export function clampLevel(level: ThinkingLevel, model: ModelDefinition): ThinkingLevel {
  const order: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"]
  const max = model.maxThinkingLevel || "high"
  const lIdx = order.indexOf(level)
  const mIdx = order.indexOf(max)
  return lIdx > mIdx ? max : level
}

export function describeThinking(t: ThinkingConfig): string {
  if (t.mode === "off") return "Closed"
  const meta = THINKING_LEVELS.find(x => x.value === t.level)
  return (t.mode === "enabled" ? "ForceOn" : "Auto") + " | " + (meta ? meta.label : t.level) + " | " + (t.budgetTokens ?? THINKING_BUDGET_TOKENS[t.level]) + " tokens"
}

export { THINKING_LEVELS, THINKING_BUDGET_TOKENS }
