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

/** 示例数据装载在某一行发现依赖缺失时，记录下来的异常行信息。 */
export type SeedIssue = {
  module: string
  moduleName: string
  rowId: number
  label: string
  missing: string
  message: string
}

/** 一次示例数据装载的结果：反复装载幂等，失败时 checkpoint 指向异常行。 */
export type SeedReport = {
  ok: boolean
  version: string
  loaded: number
  skipped: number
  resumedFrom: string | null
  issues: SeedIssue[]
}

/** 装载游标：失败后记住异常行，下次装载从这一行续做。 */
export type SeedCheckpoint = {
  module: string
  rowId: number
}
