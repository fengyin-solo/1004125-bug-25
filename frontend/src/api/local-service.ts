import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, getSeedReport, listRows, resetRows, resumeSeedLoad, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 行李转运的到达结论（终态）：出现这些状态时要同步到航班保障清单。
const ARRIVAL_CONCLUSIONS = new Set(['已到达', '异常滞留'])

// 示例数据装载的报告与续做入口，页面统一从这里拿，不直接碰数据层。
export { getSeedReport, resumeSeedLoad }

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  let syncNote = ''
  if (key === 'baggage' && ARRIVAL_CONCLUSIONS.has(target)) {
    const synced = syncArrivalToFlightOps(updated, target)
    if (synced.length > 0) {
      syncNote = `；航班保障 ${synced.join('、')} 已同步到达结论`
    }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${syncNote}` }
}

/**
 * 跨模块联动：行李转运给出到达结论后，把同一航班的航班保障清单同步掉——
 * 保障节点写上到达结论（已到达带上到达转盘），保障状态跟着转运结论走。
 */
function syncArrivalToFlightOps(baggage: EntryRow, target: string): string[] {
  const flightNo = String(baggage['关联航班'] ?? '').trim()
  if (!flightNo) {
    return []
  }
  const node =
    target === '已到达'
      ? `行李已到达（转盘 ${String(baggage['到达转盘'] ?? '—')}）`
      : '行李异常滞留'
  const rows = listRows('flight_ops')
  let touched = false
  const next = rows.map((row) => {
    if (String(row['航班号'] ?? '').trim() !== flightNo) {
      return row
    }
    touched = true
    return { ...row, '保障节点': node, '保障状态': `行李${target}` }
  })
  if (touched) {
    saveRows('flight_ops', next)
  }
  return touched ? [flightNo] : []
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
