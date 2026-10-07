import { MODULE_BY_KEY, MODULES } from './modules'
import { SEED_ROWS, SEED_VERSION } from './seed'
import type {
  BootstrapResult,
  EntryRow,
  ModuleMeta,
  StorageLike,
  StoreSnapshot,
} from './types'

// 行级依赖：装载前必须能在目标模块里找到对应业务键。
// 行李转运的「关联航班」必须存在于航班保障的「航班号」里，两个模块共用同一批航班。
const ROW_DEPENDENCIES = [
  {
    module: 'baggage',
    field: '关联航班',
    dependsOn: { module: 'flight_ops', field: '航班号' },
  },
] as const

export type SeedSource = {
  seedRows: Record<string, EntryRow[]>
  seedVersion: number
}

const DEFAULT_SOURCE: SeedSource = { seedRows: SEED_ROWS, seedVersion: SEED_VERSION }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 每个模块用第一个字段（编号类字段）作为业务键，装载、去重、收敛都按它对齐。 */
function businessKey(meta: ModuleMeta): string {
  return meta.fields[0]
}

/** 装载顺序：被依赖的模块先装（flight_ops 先于 baggage），其余保持登记顺序。 */
export function seedLoadOrder(): ModuleMeta[] {
  const before = new Map<string, Set<string>>()
  for (const rule of ROW_DEPENDENCIES) {
    const deps = before.get(rule.module) ?? new Set<string>()
    deps.add(rule.dependsOn.module)
    before.set(rule.module, deps)
  }
  const byKey = new Map(MODULES.map((meta) => [meta.key, meta]))
  const ordered: ModuleMeta[] = []
  const done = new Set<string>()
  const visiting = new Set<string>()
  const visit = (meta: ModuleMeta) => {
    if (done.has(meta.key) || visiting.has(meta.key)) {
      return
    }
    visiting.add(meta.key)
    for (const dep of before.get(meta.key) ?? []) {
      const depMeta = byKey.get(dep)
      if (depMeta) {
        visit(depMeta)
      }
    }
    visiting.delete(meta.key)
    done.add(meta.key)
    ordered.push(meta)
  }
  for (const meta of MODULES) {
    visit(meta)
  }
  return ordered
}

function dedupeRows(meta: ModuleMeta, rows: EntryRow[]): EntryRow[] {
  const key = businessKey(meta)
  const seen = new Set<string>()
  const result: EntryRow[] = []
  for (const row of rows) {
    const mark = String(row[key] ?? row.id)
    if (seen.has(mark)) {
      continue
    }
    seen.add(mark)
    result.push(row)
  }
  return result
}

/** 读取持久化内容：识别 v2 结构；旧版裸数据（模块 → 行数组）按 v1 迁移；损坏则当作空仓。 */
function readSnapshot(storage: StorageLike, key: string): StoreSnapshot | null {
  const raw = storage.getItem(key)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoreSnapshot> & Record<string, unknown>
    if (parsed && typeof parsed.version === 'number' && parsed.rows && typeof parsed.rows === 'object') {
      return {
        version: parsed.version,
        cursor: parsed.cursor ?? null,
        rows: parsed.rows as Record<string, EntryRow[]>,
      }
    }
    return { version: 1, cursor: { module: 0, row: 0 }, rows: parsed as Record<string, EntryRow[]> }
  } catch {
    return null
  }
}

function dependencyError(
  meta: ModuleMeta,
  rowIndex: number,
  row: EntryRow,
  rule: (typeof ROW_DEPENDENCIES)[number],
): string {
  const key = businessKey(meta)
  const depMeta = MODULE_BY_KEY.get(rule.dependsOn.module)
  const depName = depMeta ? depMeta.name : rule.dependsOn.module
  const need = String(row[rule.field] ?? '')
  return (
    `${meta.name} 第 ${rowIndex + 1} 行（${key} ${String(row[key])}）依赖缺失：` +
    `${depName}中没有 ${rule.dependsOn.field}「${need}」。` +
    `装载停在该行，下次启动将从该行续做；请检查示例数据或先重置${depName}模块。`
  )
}

/** 校验一行的依赖是否已就位。 */
function findMissingDependency(
  meta: ModuleMeta,
  rowIndex: number,
  row: EntryRow,
  rows: Record<string, EntryRow[]>,
): string | null {
  for (const rule of ROW_DEPENDENCIES) {
    if (rule.module !== meta.key) {
      continue
    }
    const need = String(row[rule.field] ?? '')
    const pool = rows[rule.dependsOn.module] ?? []
    const found = pool.some((item) => String(item[rule.dependsOn.field] ?? '') === need)
    if (!found) {
      return dependencyError(meta, rowIndex, row, rule)
    }
  }
  return null
}

/** 幂等 upsert：按业务键覆盖，重复装载不会多出行。 */
function upsertRow(meta: ModuleMeta, rows: EntryRow[], row: EntryRow): void {
  const key = businessKey(meta)
  const mark = String(row[key])
  const at = rows.findIndex((item) => String(item[key]) === mark)
  if (at >= 0) {
    rows[at] = row
  } else {
    rows.push(row)
  }
}

/**
 * 统一的数据库初始化：本地开发与部署构建都走这里，只有这一份播种逻辑。
 * - 幂等：按业务键 upsert，反复装载不会多出记录；
 * - 断点续做：每装一行推进一次断点并落盘，中断后下次从异常行继续；
 * - 依赖校验：缺依赖时停在该行并说明缺什么；
 * - 版本收敛：数据版本不一致时以种子为准（同键覆盖、废键清除），重建后不残留旧状态。
 */
export function bootstrapStore(
  storage: StorageLike,
  storageKey: string,
  source: SeedSource = DEFAULT_SOURCE,
): BootstrapResult {
  const order = seedLoadOrder()
  const persist = (snapshot: StoreSnapshot) => {
    storage.setItem(storageKey, JSON.stringify(snapshot))
  }

  let snapshot = readSnapshot(storage, storageKey)
  let resumed = false
  if (!snapshot) {
    snapshot = { version: source.seedVersion, cursor: { module: 0, row: 0 }, rows: {} }
  } else if (snapshot.version === source.seedVersion && snapshot.cursor === null) {
    // 已是最新版本且装载完整，直接复用，不重跑播种。
    return { ok: true, snapshot, resumed: false }
  } else if (snapshot.version === source.seedVersion && snapshot.cursor) {
    // 上次装载中断：从断点续做。
    resumed = true
    if (snapshot.cursor.module >= order.length) {
      snapshot.cursor = { module: 0, row: 0 }
    }
  } else {
    // 版本不一致（含旧版裸数据）：迁移受管模块、按业务键去重，然后整库按种子收敛。
    const migrated: Record<string, EntryRow[]> = {}
    for (const meta of order) {
      const legacy = snapshot.rows[meta.key]
      if (Array.isArray(legacy)) {
        migrated[meta.key] = dedupeRows(meta, legacy)
      }
    }
    snapshot = { version: source.seedVersion, cursor: { module: 0, row: 0 }, rows: migrated }
  }

  const cursor = snapshot.cursor ?? { module: 0, row: 0 }

  // 续做时先把断点之前的模块快速对齐一遍：依赖修复（比如补回缺失的航班）才能生效。
  if (resumed && cursor.module > 0) {
    for (let mi = 0; mi < cursor.module; mi += 1) {
      const meta = order[mi]
      const rows = (snapshot.rows[meta.key] ??= [])
      const seedRows = source.seedRows[meta.key] ?? []
      for (let ri = 0; ri < seedRows.length; ri += 1) {
        const row = clone(seedRows[ri])
        const missing = findMissingDependency(meta, ri, row, snapshot.rows)
        if (missing) {
          snapshot.cursor = { module: mi, row: ri }
          persist(snapshot)
          return { ok: false, snapshot, resumed, error: missing }
        }
        upsertRow(meta, rows, row)
      }
    }
    persist(snapshot)
  }

  // 主装载循环：从断点开始逐模块逐行 upsert，每行落盘一次断点。
  for (let mi = cursor.module; mi < order.length; mi += 1) {
    const meta = order[mi]
    const rows = (snapshot.rows[meta.key] ??= [])
    const seedRows = source.seedRows[meta.key] ?? []
    const startRow = mi === cursor.module ? cursor.row : 0
    for (let ri = startRow; ri < seedRows.length; ri += 1) {
      const row = clone(seedRows[ri])
      const missing = findMissingDependency(meta, ri, row, snapshot.rows)
      if (missing) {
        snapshot.cursor = { module: mi, row: ri }
        persist(snapshot)
        return { ok: false, snapshot, resumed, error: missing }
      }
      upsertRow(meta, rows, row)
      snapshot.cursor = { module: mi, row: ri + 1 }
      persist(snapshot)
    }
  }

  // 收敛：清掉不在种子里的旧行（例如旧版本残留的转运状态），保证重建后看到的是当前种子。
  for (const meta of order) {
    const key = businessKey(meta)
    const keep = new Set((source.seedRows[meta.key] ?? []).map((row) => String(row[key])))
    snapshot.rows[meta.key] = (snapshot.rows[meta.key] ?? []).filter((row) =>
      keep.has(String(row[key])),
    )
  }
  snapshot.version = source.seedVersion
  snapshot.cursor = null
  persist(snapshot)
  return { ok: true, snapshot, resumed }
}
