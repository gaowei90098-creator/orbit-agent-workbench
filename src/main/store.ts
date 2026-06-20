import { app, safeStorage } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { randomBytes } from 'crypto'

const ENC_PREFIX = 'enc:v1:'

/**
 * 用 OS 级 safeStorage（Windows DPAPI / macOS Keychain / Linux libsecret）加密密钥后落盘。
 * 幂等：已加密的值原样返回，避免重复加密。safeStorage 不可用时回退明文（不阻断功能）。
 * 注意：safeStorage 须在 app ready 后调用。
 */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (plain.startsWith(ENC_PREFIX)) return plain
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
    }
  } catch { /* 回退明文 */ }
  return plain
}

/** 解密 encryptSecret 的产物；旧明文（无前缀）原样返回；解密失败返回空串（视为未配置，提示重填）。 */
export function decryptSecret(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith(ENC_PREFIX)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

class AppStore {
  private data: Record<string, any> = {}
  private filePath: string = ''
  private initialized: boolean = false

  init(): void {
    if (this.initialized) return
    try {
      const userDataPath = app.getPath('userData')
      this.filePath = join(userDataPath, 'config.json')
      this.load()
      this.initialized = true
    } catch (e) {
      console.error('[Store] Init failed:', e)
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      }
    } catch {}
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
    } catch {}
  }

  get(key: string, defaultValue?: any): any {
    this.init()
    return this.data[key] !== undefined ? this.data[key] : defaultValue
  }

  set(key: string, value: any): void {
    this.init()
    this.data[key] = value
    this.save()
  }

  getAll(): Record<string, any> {
    this.init()
    return { ...this.data }
  }
}

const appStore = new AppStore()
export { appStore as store }

const TOKEN_KEY = 'local.token'

/**
 * 每安装一份的本机令牌：用于 Hub WebSocket(9527) 连接鉴权等本机内部场景。
 * 首次调用时生成并持久化。仅本机使用，不外发。
 */
export function getLocalToken(): string {
  let t = appStore.get(TOKEN_KEY)
  if (!t || typeof t !== 'string') {
    t = randomBytes(24).toString('hex')
    appStore.set(TOKEN_KEY, t)
  }
  return t
}
