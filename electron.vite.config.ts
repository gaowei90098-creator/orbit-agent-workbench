import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [
      // 仅开发(serve)生效：放行 Vite/React Fast Refresh 注入的 inline 预置脚本，
      // 否则 index.html 的 CSP（script-src 'self'）会拦截它，导致 React 不挂载、渲染黑屏。
      // 生产构建（loadFile）不注入该脚本，CSP 保持严格，安全性不受影响。
      {
        name: 'dev-csp-relax',
        apply: 'serve',
        transformIndexHtml: (html: string) =>
          html.replace(
            "script-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
          )
      },
      react(),
      tailwindcss()
    ]
  }
})
