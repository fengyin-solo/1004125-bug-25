<template>
  <section class="page" data-module="baggage">
    <header class="page-head">
      <div>
        <h2>行李转运管理</h2>
        <p class="page-desc">维护行李转运，围绕转运编号、关联航班、行李件数、出发转盘做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记行李转运</button>
        <button class="btn" type="button" @click="exportRows">导出行李转运清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无行李转运数据，可先登记行李转运</td>
        </tr>
      </tbody>
    </table>

    <section v-if="detailRow" class="detail-panel">
      <header class="detail-head">
        <h3>转运详情：{{ detailRow['转运编号'] }}</h3>
        <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
      </header>
      <dl class="detail-grid">
        <template v-for="column in columns" :key="column">
          <dt>{{ column }}</dt>
          <dd>{{ detailRow[column] ?? '—' }}</dd>
        </template>
        <dt>当前状态</dt>
        <dd>{{ detailRow.status }}</dd>
      </dl>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条行李转运记录</span>
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-if="infoMessage" class="info-text">{{ infoMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  initNotice,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('baggage')
const columns = ["转运编号", "关联航班", "行李件数", "出发转盘", "到达转盘", "装卸人员", "转运时长", "转运状态"]
const actions = ["开始卸机", "确认到达", "标记异常"]
const statuses = ["待卸机", "转运中", "已到达", "异常滞留"]
const stats = [{"label": "待卸机航班", "value": 0}, {"label": "转运中航班", "value": 0}, {"label": "异常滞留行李", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const notice = ref('')
const detailRow = ref<EntryRow | null>(null)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '行李转运登记入口尚未接入审批流'
}

// 详情直接引用列表里的同一行对象，行李件数、到达转盘等字段与列表永远同源。
function openDetail(row: EntryRow) {
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  infoMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (detailRow.value) {
      // 刷新后按编号重新绑定详情，保证详情与列表看到的是同一份数据
      const current = detailRow.value
      detailRow.value = rows.value.find((row) => Number(row.id) === Number(current.id)) ?? null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '行李转运列表读取失败'
  }
}

onMounted(() => {
  notice.value = initNotice() ?? ''
  reload()
})
</script>
