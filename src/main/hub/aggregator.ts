import { agentName } from './agents'

export interface AggregatedResult {
  taskId: string
  results: Array<{
    agentId: string
    agentName: string
    content: string
    confidence: number
  }>
  summary: string
  timestamp: Date
}

export class Aggregator {
  aggregate(taskId: string, results: Map<string, string>): AggregatedResult {
    const entries = Array.from(results.entries()).map(([agentId, content]) => ({
      agentId,
      agentName: this.getAgentName(agentId),
      content,
      confidence: this.calculateConfidence(content)
    }))

    return {
      taskId,
      results: entries.sort((a, b) => b.confidence - a.confidence),
      summary: this.buildSummary(entries),
      timestamp: new Date()
    }
  }

  private calculateConfidence(content: string): number {
    if (!content || content.length < 10) return 0
    if (content.includes('error') || content.includes('Error')) return 0.3
    if (content.includes('```') || content.includes('---')) return 0.8
    return 0.6
  }

  private buildSummary(entries: Array<{ agentId: string; agentName: string; content: string; confidence: number }>): string {
    if (entries.length === 0) return 'No results'
    const best = entries[0]
    const preview = best.content.slice(0, 200)
    return '**' + best.agentName + '** (' + Math.round(best.confidence * 100) + '% 置信度):\n' + preview
  }

  private getAgentName(id: string): string {
    return agentName(id)
  }
}
