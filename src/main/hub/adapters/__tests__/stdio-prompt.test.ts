import { describe, it, expect } from 'vitest'
import { resolvePromptArg } from '../stdio-adapter'

/**
 * 多行提示词保真单测 — resolvePromptArg：
 *   - 直接 spawn（needsCommandShell=false）：保留换行；
 *   - 经 cmd.exe /c（needsCommandShell=true）：压平换行为空格（防破坏命令行解析）。
 */
describe('resolvePromptArg', () => {
  const multi = 'line one\nline two\r\nline three'

  it('直接 spawn 保留换行（.exe / 非 Windows）', () => {
    expect(resolvePromptArg(multi, false)).toBe(multi)
  })

  it('cmd.exe 路径压平换行为空格', () => {
    expect(resolvePromptArg(multi, true)).toBe('line one line two line three')
  })

  it('单行提示词两种路径不变', () => {
    expect(resolvePromptArg('hello', false)).toBe('hello')
    expect(resolvePromptArg('hello', true)).toBe('hello')
  })
})
