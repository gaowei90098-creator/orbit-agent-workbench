import { createRequire } from 'node:module'

const requireRuntime = createRequire(__filename)

requireRuntime('./orbit-runtime.cjs')
