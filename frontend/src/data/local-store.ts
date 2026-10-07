import { bootstrapStore } from './bootstrap'
import { SEED_ROWS } from './seed'
import type { EntryRow, StorageLike, StoreSnapshot } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 初始化统一走 bootstrapStore：幂等、可断点续做，版本不一致时按种子收敛，
// 本地开发与部署构建不会再各自播种出两份数据。
const STORAGE_KEY = 'airport-ground-handling:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 无 window 的环境（自检脚本、SSR）用内存存储兜底，初始化逻辑保持一致。
const memoryStorage: StorageLike = (() => {
  const map = new Map<string, string>()
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
})()

function resolveStorage(): StorageLike {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  return memoryStorage
}

let cache: StoreSnapshot | null = null
let bootstrapError: string | null = null

function ensureStore(): StoreSnapshot {
  if (cache === null) {
    const result = bootstrapStore(resolveStorage(), STORAGE_KEY)
    cache = result.snapshot
    bootstrapError = result.ok ? null : (result.error ?? '数据初始化失败')
    if (!result.ok) {
      // 初始化失败不阻断页面：已装载的部分可用，失败原因交给页面展示。
      console.error(`[数据初始化] ${bootstrapError}`)
    }
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return ensureStore().rows
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const snapshot = ensureStore()
  snapshot.rows = { ...snapshot.rows, [key]: rows }
  resolveStorage().setItem(STORAGE_KEY, JSON.stringify(snapshot))
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 初始化失败（如依赖缺失）的说明，页面可拿去展示；正常时为 null。 */
export function storeNotice(): string | null {
  ensureStore()
  return bootstrapError
}

export function storageKey(): string {
  return STORAGE_KEY
}
