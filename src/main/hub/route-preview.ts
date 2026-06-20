import { AgentRegistry } from "./registry"
import { KeywordRouter, RouterContext } from "./router"

export function routePreview(
  text: string,
  registry: AgentRegistry,
  router = new KeywordRouter(),
  context?: RouterContext
): Array<{ id: string; score: number }> {
  return router.routeScores(text || "", registry.getAll(), context)
}
