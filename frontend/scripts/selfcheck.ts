/**
 * 数据层自检：不依赖浏览器，直接验证初始化的关键行为。
 * 跑法：npm run selfcheck（esbuild 打包后用 node 执行）。
 *
 * 覆盖：
 *  1. 首次装载：全部模块播种完成、断点清空；
 *  2. 反复装载：多次执行不多出记录；
 *  3. 断点续做：从中断位置继续，已装载行不重复；
 *  4. 依赖缺失：停在异常行并说明缺什么，修复后从该行续做成功；
 *  5. 版本迁移：旧版残留状态被种子收敛、废行清除；
 *  6. 跨模块同步：行李确认到达后，航班保障清单同步到达结论；
 *  7. 同步依赖缺失：目标航班不存在时，消息里说明未同步原因。
 */
import { runAction } from '../src/api/local-service'
import { bootstrapStore, seedLoadOrder } from '../src/data/bootstrap'
import { listRows, saveRows } from '../src/data/local-store'
import { SEED_ROWS, SEED_VERSION } from '../src/data/seed'
import type { EntryRow, StorageLike, StoreSnapshot } from '../src/data/types'

const KEY = 'selfcheck:entries'

function memoryStorage(): StorageLike {
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
}

let failures = 0
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`ok   - ${name}`)
  } else {
    failures += 1
    console.error(`FAIL - ${name}${extra ? `：${extra}` : ''}`)
  }
}

function readSnapshot(storage: StorageLike): StoreSnapshot {
  return JSON.parse(storage.getItem(KEY) as string) as StoreSnapshot
}

// ---------- 1. 首次装载 ----------
{
  const storage = memoryStorage()
  const result = bootstrapStore(storage, KEY)
  const baggage = result.snapshot.rows['baggage'] ?? []
  const flights = (result.snapshot.rows['flight_ops'] ?? []).map((row) => String(row['航班号']))
  check('首次装载成功', result.ok && result.snapshot.cursor === null)
  check('数据版本写入', result.snapshot.version === SEED_VERSION)
  check('行李转运播种 3 行', baggage.length === 3)
  check(
    '行李件数与到达转盘是可用值',
    baggage[0]?.['行李件数'] === 126 && baggage[0]?.['到达转盘'] === 'C5',
    JSON.stringify(baggage[0]),
  )
  check(
    '关联航班都能在航班保障里找到',
    baggage.every((row) => flights.includes(String(row['关联航班']))),
  )
}

// ---------- 2. 反复装载不多出记录 ----------
{
  const storage = memoryStorage()
  bootstrapStore(storage, KEY)
  const first = JSON.stringify(readSnapshot(storage).rows)
  for (let i = 0; i < 3; i += 1) {
    bootstrapStore(storage, KEY)
  }
  const after = readSnapshot(storage)
  const baggage = after.rows['baggage'] ?? []
  const ids = baggage.map((row) => String(row['转运编号']))
  check('反复装载后行数不变', baggage.length === 3, `实际 ${baggage.length}`)
  check('转运编号无重复', new Set(ids).size === ids.length)
  check('反复装载后数据稳定', JSON.stringify(after.rows) === first)
}

// ---------- 3. 断点续做 ----------
{
  const storage = memoryStorage()
  bootstrapStore(storage, KEY)
  const snapshot = readSnapshot(storage)
  const order = seedLoadOrder()
  const baggageIndex = order.findIndex((meta) => meta.key === 'baggage')
  // 模拟上次装载中断：断点停在行李转运第 2 行，且只装进去第 1 行
  snapshot.cursor = { module: baggageIndex, row: 1 }
  snapshot.rows['baggage'] = snapshot.rows['baggage'].slice(0, 1)
  storage.setItem(KEY, JSON.stringify(snapshot))

  const result = bootstrapStore(storage, KEY)
  const baggage = result.snapshot.rows['baggage'] ?? []
  const ids = baggage.map((row) => String(row['转运编号']))
  check('中断后续做成功', result.ok && result.resumed)
  check('续做后行数正确且无重复', baggage.length === 3 && new Set(ids).size === 3, ids.join(','))
  check('续做后断点清空', result.snapshot.cursor === null)
}

// ---------- 4. 依赖缺失：停在异常行并说明，修复后续做 ----------
{
  const storage = memoryStorage()
  const brokenFlights = (SEED_ROWS['flight_ops'] ?? []).filter(
    (row) => row['航班号'] !== 'MU5112',
  )
  const broken = {
    seedRows: { ...SEED_ROWS, flight_ops: brokenFlights },
    seedVersion: SEED_VERSION,
  }
  const failed = bootstrapStore(storage, KEY, broken)
  const order = seedLoadOrder()
  const baggageIndex = order.findIndex((meta) => meta.key === 'baggage')
  check('依赖缺失时装载失败', !failed.ok)
  check(
    '失败说明点名缺失的依赖',
    Boolean(failed.error?.includes('依赖缺失')) &&
      Boolean(failed.error?.includes('MU5112')) &&
      Boolean(failed.error?.includes('BAGG-0002')),
    failed.error,
  )
  check(
    '断点停在异常行',
    failed.snapshot.cursor?.module === baggageIndex && failed.snapshot.cursor?.row === 1,
    JSON.stringify(failed.snapshot.cursor),
  )

  const fixed = bootstrapStore(storage, KEY)
  const flights = (fixed.snapshot.rows['flight_ops'] ?? []).map((row) => String(row['航班号']))
  check('修复依赖后从异常行续做成功', fixed.ok && fixed.resumed)
  check('续做后航班补齐', flights.includes('MU5112'))
  check('续做后行李转运无重复', (fixed.snapshot.rows['baggage'] ?? []).length === 3)
}

// ---------- 5. 版本迁移：旧状态收敛、废行清除 ----------
{
  const storage = memoryStorage()
  const legacy: Record<string, EntryRow[]> = {
    baggage: [
      { ...SEED_ROWS['baggage'][0], status: '异常滞留', 转运状态: '异常滞留' },
      { ...SEED_ROWS['baggage'][2], id: 99, 转运编号: 'BAGG-9999' },
    ],
    flight_ops: [{ ...SEED_ROWS['flight_ops'][0], 航班号: '航班保障样例1' }],
  }
  storage.setItem(KEY, JSON.stringify(legacy))

  const result = bootstrapStore(storage, KEY)
  const baggage = result.snapshot.rows['baggage'] ?? []
  const flights = (result.snapshot.rows['flight_ops'] ?? []).map((row) => String(row['航班号']))
  const stale = baggage.find((row) => String(row['转运编号']) === 'BAGG-0001')
  check('旧版数据迁移成功', result.ok && result.snapshot.version === SEED_VERSION)
  check('旧转运状态被种子收敛', stale?.status === '待卸机', String(stale?.status))
  check('废行被清除', !baggage.some((row) => String(row['转运编号']) === 'BAGG-9999'))
  check('行李转运仍是 3 行', baggage.length === 3)
  check('旧航班号被替换', flights.includes('CA1831') && !flights.includes('航班保障样例1'))
}

// ---------- 6. 跨模块同步：到达结论进航班保障清单 ----------
{
  const unload = runAction('baggage', 1, '开始卸机')
  const arrive = runAction('baggage', 1, '确认到达')
  const flight = listRows('flight_ops').find((row) => String(row['航班号']) === 'CA1831')
  check('确认到达动作成功', unload.ok && arrive.ok)
  check('动作消息包含同步说明', arrive.message.includes('已同步'), arrive.message)
  check(
    '航班保障清单同步到达结论',
    flight?.['保障节点'] === '行李已到达' && flight?.['保障状态'] === '行李已到达',
    JSON.stringify(flight),
  )
}

// ---------- 7. 同步依赖缺失：说明未同步原因 ----------
{
  saveRows('flight_ops', [])
  const result = runAction('baggage', 2, '确认到达')
  check('目标航班缺失时动作本身成功', result.ok)
  check(
    '消息说明未同步与依赖缺失',
    result.message.includes('未同步') && result.message.includes('依赖缺失'),
    result.message,
  )
}

if (failures > 0) {
  console.error(`\n${failures} 项自检未通过`)
  process.exit(1)
}
console.log('\n全部自检通过')
