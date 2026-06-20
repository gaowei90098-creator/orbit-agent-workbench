// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    // 产物、依赖、设计稿、旧 jsx 原型、配置文件不参与 lint
    ignores: [
      'out/**',
      'dist/**',
      'build/**',
      'node_modules/**',
      'AgentHub UI设计/**',
      'scripts/**',
      '**/*.jsx',
      '**/*.config.{js,mjs,ts}',
      'src/renderer/vite.config.mjs',
      'src/main/hub/__tests__/mock-codex.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Electron/适配器代码大量使用 any 与动态对象，关掉以降低噪音
      '@typescript-eslint/no-explicit-any': 'off',
      // 未用变量降为警告，并放行下划线前缀
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // server.ts 用 require('ws')
      '@typescript-eslint/no-require-imports': 'off',
      // 允许带说明的 @ts-ignore（禁止裸用）
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description', minimumDescriptionLength: 3 }],
      // 适配器/派发里把 this 别名到局部是有意为之
      '@typescript-eslint/no-this-alias': 'off',
      // 空 catch 在清理/容错路径里常见
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // 解构中只要还有变量被重赋值就不强制 const
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
)
