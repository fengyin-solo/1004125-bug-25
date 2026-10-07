/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 存储适配器：浏览器里是 localStorage，自检脚本里是内存实现，初始化逻辑两边共用。 */
export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 装载断点：下一个待装载的位置（模块下标 + 行下标），null 表示全部装载完成。 */
export type SeedCursor = { module: number; row: number } | null

/** 持久化结构（v2）：带数据版本与装载断点，旧版裸数据会被迁移进来。 */
export type StoreSnapshot = {
  version: number
  cursor: SeedCursor
  rows: Record<string, EntryRow[]>
}

export type BootstrapResult = {
  ok: boolean
  snapshot: StoreSnapshot
  /** 本次是否从上次中断的断点续做 */
  resumed: boolean
  /** 失败原因（如依赖缺失），成功时为空 */
  error?: string
}
