import { MODULES } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow, ModuleMeta, SeedCheckpoint, SeedIssue, SeedReport } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 初始化只有这一条路：版本指纹 + 幂等装载 + 异常行游标，本地开发与部署构建完全一致。
const STORAGE_KEY = 'airport-ground-handling:entries'
const VERSION_KEY = 'airport-ground-handling:seed-version'
const CHECKPOINT_KEY = 'airport-ground-handling:seed-checkpoint'
const REPORT_KEY = 'airport-ground-handling:seed-report'

// 装载顺序：航班保障（flight_ops）是其他模块的依赖——关联航班/涉及航班必须能对应到
// 航班号——所以它永远最先装载，其余模块保持登记顺序。
const LOAD_ORDER: ModuleMeta[] = [...MODULES].sort(
  (a, b) => Number(b.key === 'flight_ops') - Number(a.key === 'flight_ops'),
)

// 依赖字段：这些字段的值必须出现在航班保障的航班号里，否则算依赖缺失。
const FLIGHT_REF_FIELDS = ['关联航班', '涉及航班']

// 版本指纹：应用版本 + 依赖版本（vite define 注入）+ 示例数据内容。
// 任一变化（比如依赖版本变化后重建）指纹就变，下次打开自动重新播种，
// 不会把上一版的旧转运状态再显示出来。
export const SEED_VERSION = [
  __APP_VERSION__,
  __DEP_FINGERPRINT__,
  hashText(JSON.stringify(SEED_ROWS)),
].join('+')

function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storage(): Storage | null {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
}

function readJson<T>(key: string): T | null {
  const store = storage()
  if (!store) {
    return null
  }
  const raw = store.getItem(key)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage()
  if (store) {
    store.setItem(key, JSON.stringify(value))
  }
}

function removeKey(key: string): void {
  const store = storage()
  if (store) {
    store.removeItem(key)
  }
}

function rowLabel(meta: ModuleMeta, row: EntryRow): string {
  return String(row[meta.fields[0]] ?? row.id)
}

function knownFlights(rows: Record<string, EntryRow[]>): Set<string> {
  const flights = new Set<string>()
  for (const row of rows['flight_ops'] ?? []) {
    const flightNo = String(row['航班号'] ?? '').trim()
    if (flightNo) {
      flights.add(flightNo)
    }
  }
  return flights
}

function missingDependency(row: EntryRow, flights: Set<string>): string | null {
  for (const field of FLIGHT_REF_FIELDS) {
    const value = String(row[field] ?? '').trim()
    if (value && !flights.has(value)) {
      return `航班保障里没有航班号「${value}」（${field} 依赖）`
    }
  }
  return null
}

/** 同一 id 只留一条：去重的同时保留浏览器里已有的版本。 */
function dedupeById(rows: EntryRow[]): EntryRow[] {
  const seen = new Set<number>()
  const result: EntryRow[] = []
  for (const row of rows) {
    const id = Number(row.id)
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    result.push(row)
  }
  return result
}

/**
 * 幂等装载：按 LOAD_ORDER 逐行 upsert 示例数据，反复执行不会多出记录。
 * 某一行依赖缺失时停在该异常行并记下游标；下次（或手动续做）从游标行继续，
 * 已装载的行靠 id 去重，不会重复播种。
 */
function runSeedLoad(
  base: Record<string, EntryRow[]>,
  checkpoint: SeedCheckpoint | null,
): { rows: Record<string, EntryRow[]>; report: SeedReport; checkpoint: SeedCheckpoint | null } {
  const working: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(base)) {
    working[key] = dedupeById(rows)
  }

  const tasks: { meta: ModuleMeta; row: EntryRow }[] = []
  for (const meta of LOAD_ORDER) {
    for (const row of SEED_ROWS[meta.key] ?? []) {
      tasks.push({ meta, row })
    }
  }

  const issues: SeedIssue[] = []
  let loaded = 0
  let skipped = 0
  let resumedFrom: string | null = null
  let nextCheckpoint: SeedCheckpoint | null = null
  let waitingForCheckpoint = checkpoint !== null

  for (let i = 0; i < tasks.length; i += 1) {
    const { meta, row } = tasks[i]
    if (waitingForCheckpoint) {
      const hit = meta.key === checkpoint!.module && Number(row.id) === checkpoint!.rowId
      if (!hit) {
        // 游标之前的行此前已经装载过，本次跳过
        skipped += 1
        continue
      }
      waitingForCheckpoint = false
      resumedFrom = `${meta.name}「${rowLabel(meta, row)}」`
    }
    const rows = working[meta.key] ?? []
    if (rows.some((item) => Number(item.id) === Number(row.id))) {
      continue
    }
    const missing = missingDependency(row, knownFlights(working))
    if (missing !== null) {
      const label = rowLabel(meta, row)
      issues.push({
        module: meta.key,
        moduleName: meta.name,
        rowId: Number(row.id),
        label,
        missing,
        message: `${meta.name}「${label}」装载中断：缺少依赖——${missing}。已停在该异常行，修复后从这一行续做，前面的记录不会重复装载。`,
      })
      nextCheckpoint = { module: meta.key, rowId: Number(row.id) }
      skipped += tasks.length - i
      break
    }
    working[meta.key] = [...rows, clone(row)]
    loaded += 1
  }

  if (waitingForCheckpoint) {
    // 游标指向的异常行已经不在示例数据里（比如换了版本），丢掉游标从头补齐
    return runSeedLoad(base, null)
  }

  const report: SeedReport = {
    ok: issues.length === 0,
    version: SEED_VERSION,
    loaded,
    skipped,
    resumedFrom,
    issues,
  }
  return { rows: working, report, checkpoint: nextCheckpoint }
}

function persist(rows: Record<string, EntryRow[]>, checkpoint: SeedCheckpoint | null, report: SeedReport): void {
  writeJson(STORAGE_KEY, rows)
  writeJson(VERSION_KEY, SEED_VERSION)
  writeJson(REPORT_KEY, report)
  if (checkpoint) {
    writeJson(CHECKPOINT_KEY, checkpoint)
  } else {
    removeKey(CHECKPOINT_KEY)
  }
}

/** 统一初始化入口：版本不一致（首装、升级、依赖变化重建）就整库重播，否则幂等补种并续做异常行。 */
function initializeStore(): Record<string, EntryRow[]> {
  const stored = readJson<Record<string, EntryRow[]>>(STORAGE_KEY)
  const storedVersion = readJson<string>(VERSION_KEY)
  const reseed = stored === null || storedVersion !== SEED_VERSION
  const base = reseed ? {} : stored
  const checkpoint = reseed ? null : readJson<SeedCheckpoint>(CHECKPOINT_KEY)
  const { rows, report, checkpoint: nextCheckpoint } = runSeedLoad(base, checkpoint)
  persist(rows, nextCheckpoint, report)
  lastReport = report
  return rows
}

let cache: Record<string, EntryRow[]> | null = null
let lastReport: SeedReport | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = initializeStore()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  writeJson(STORAGE_KEY, next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 最近一次示例数据装载的结果：依赖缺失、续做起点都在里面。 */
export function getSeedReport(): SeedReport {
  allRows()
  if (lastReport) {
    return lastReport
  }
  const stored = readJson<SeedReport>(REPORT_KEY)
  if (stored) {
    return stored
  }
  return { ok: true, version: SEED_VERSION, loaded: 0, skipped: 0, resumedFrom: null, issues: [] }
}

/** 失败后手动续做：从游标指向的异常行接着装载，已装载的行不会重复。 */
export function resumeSeedLoad(): SeedReport {
  const checkpoint = readJson<SeedCheckpoint>(CHECKPOINT_KEY)
  const { rows, report, checkpoint: nextCheckpoint } = runSeedLoad(allRows(), checkpoint)
  cache = rows
  persist(rows, nextCheckpoint, report)
  lastReport = report
  return report
}

export function storageKey(): string {
  return STORAGE_KEY
}
