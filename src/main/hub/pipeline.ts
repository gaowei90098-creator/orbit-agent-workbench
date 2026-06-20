export interface Mod {
  name: string
  type: 'guard' | 'transform' | 'observe'
  handle(event: PipelineEvent): Promise<PipelineEvent | null>
}

export interface PipelineEvent {
  id: string
  type: string
  source: string
  target: string
  payload: any
  metadata: Record<string, any>
  timestamp: Date
}

export class EventPipeline {
  private mods: Mod[] = []

  register(mod: Mod): void {
    this.mods.push(mod)
  }

  async process(payload: any, sourceAgent: string): Promise<void> {
    let event: PipelineEvent = {
      id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      type: 'message',
      source: sourceAgent,
      target: 'hub',
      payload,
      metadata: {},
      timestamp: new Date()
    }

    for (const mod of this.mods.filter(m => m.type === 'guard')) {
      const result = await mod.handle(event)
      if (result === null) {
        console.log('[Pipeline] Guard mod ' + mod.name + ' blocked event')
        return
      }
      event = result
    }

    for (const mod of this.mods.filter(m => m.type === 'transform')) {
      const result = await mod.handle(event)
      if (result) event = result
    }

    for (const mod of this.mods.filter(m => m.type === 'observe')) {
      mod.handle(event).catch(() => {})
    }
  }

  getMods(): Mod[] {
    return [...this.mods]
  }
}
