import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      electron: fileURLToPath(new URL('./test/electron-stub.ts', import.meta.url))
    }
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.git/**',
      '**/.claude/**',
      '**/reference_repos/**'
    ]
  }
})
