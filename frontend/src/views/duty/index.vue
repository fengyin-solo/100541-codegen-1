<template>
  <section class="page" data-module="duty">
    <header class="page-head">
      <div>
        <h2>值班值守与交接班台账</h2>
        <p class="page-desc">
          汛期值班按班次登记交接，上一班签收登记、下一班签收接班、办结逐段推进；
          未签收事项单独挂账，办结结果回写群测群防巡查待办。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/patrol">前往群测群防巡查</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ 'stat-warn': item.warn }">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in stageSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-time">各入口统一交班时间：{{ sharedHandoverTime || '暂无登记' }}</span>
    </p>

    <form class="register-card" @submit.prevent="submitRegister">
      <div class="register-title">交班登记（同一值班日期+班次重复登记只更新，不会另挂一条）</div>
      <div class="register-grid">
        <label class="filter-item">
          <span>值班日期</span>
          <input v-model="form.dutyDate" placeholder="YYYY-MM-DD" />
        </label>
        <label class="filter-item">
          <span>值班班次</span>
          <select v-model="form.shift">
            <option value="白班">白班 08:00-20:00</option>
            <option value="夜班">夜班 20:00-次日08:00</option>
          </select>
        </label>
        <label class="filter-item">
          <span>值班人员（交班人）</span>
          <input v-model="form.dutyPerson" placeholder="上一班值班人员" />
        </label>
        <label class="filter-item">
          <span>交班时间</span>
          <input v-model="form.handoverTime" placeholder="YYYY-MM-DD HH:mm" />
        </label>
        <label class="filter-item filter-wide">
          <span>当班交接事项（多条用换行或分号隔开）</span>
          <textarea v-model="form.itemsText" rows="2" placeholder="逐条列出未办完、需下一班接续的事"></textarea>
        </label>
      </div>
      <div class="register-foot">
        <button class="btn primary" type="submit">登记交接</button>
        <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
      </div>
    </form>

    <div v-if="book.rejected.length" class="reject-panel">
      <div class="reject-title">存量迁移退回（{{ book.rejected.length }} 条）：交班时间无效，补正后回填</div>
      <div v-for="row in book.rejected" :key="row.tempId" class="reject-row">
        <div class="reject-info">
          <strong>{{ row.dutyDate }} {{ row.shift }} · {{ row.dutyPerson }}</strong>
          <span>原交班时间：「{{ row.handoverTime }}」— {{ row.reason }}</span>
          <span class="reject-items">{{ row.items.join('；') }}</span>
        </div>
        <div class="reject-form">
          <input v-model="refillTimes[row.tempId]" placeholder="补正交班时间 YYYY-MM-DD HH:mm" />
          <button class="btn primary" type="button" @click="submitRefill(row.tempId)">重填并回填</button>
        </div>
      </div>
    </div>

    <div class="duty-columns">
      <section v-for="column in columns" :key="column.key" class="duty-column" :class="column.key">
        <header class="column-head">
          <h3>{{ column.title }}</h3>
          <span class="column-count">{{ column.records.length }} 条</span>
        </header>
        <p v-if="column.hint" class="column-hint">{{ column.hint }}</p>

        <article v-for="record in column.records" :key="record.id" class="duty-card">
          <div class="duty-card-head">
            <span class="duty-id">#{{ record.id }}<em v-if="record.legacy">存量</em></span>
            <span class="duty-status" :class="`status-${statusOrder[record.status]}`">{{ record.status }}</span>
          </div>
          <dl class="duty-meta">
            <div><dt>值班班次</dt><dd>{{ record.dutyDate }} {{ record.shift }}</dd></div>
            <div><dt>值班人员</dt><dd>{{ record.dutyPerson }}</dd></div>
            <div><dt>交班时间</dt><dd>{{ record.handoverTime }}</dd></div>
            <div v-if="record.receivedBy"><dt>签收接班</dt><dd>{{ record.receivedBy }} · {{ record.receivedTime }}</dd></div>
            <div v-if="record.completedTime"><dt>办结时间</dt><dd>{{ record.completedTime }}</dd></div>
          </dl>
          <ul class="duty-items">
            <li v-for="(item, itemIndex) in record.items" :key="itemIndex">{{ item }}</li>
          </ul>
          <div v-if="record.status === '已办结'" class="duty-result">
            <p>办结结果：{{ record.result }}</p>
            <RouterLink class="link" to="/patrol">
              已回写群测群防巡查待办（PATR-{{ padId(record.patrolFollowupId ?? 0) }}）→
            </RouterLink>
          </div>
          <div v-if="record.status === '待签收'" class="duty-ops">
            <input v-model="receivers[record.id]" placeholder="接班人签收姓名" />
            <button class="btn primary" type="button" @click="receive(record)">下一班签收接班</button>
          </div>
          <div v-else-if="record.status === '已接班'" class="duty-ops">
            <input v-model="results[record.id]" placeholder="填写交接事项办结结果" />
            <button class="btn primary" type="button" @click="complete(record)">办结并回写巡查待办</button>
          </div>
        </article>

        <p v-if="!column.records.length" class="empty-state column-empty">暂无记录</p>
      </section>
    </div>

    <footer class="page-foot">
      <span>台账按值班日期、交班时间升序排列；存量记录保持迁移时的原有顺序</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  completeHandover,
  dutyStats,
  latestHandoverTime,
  loadDutyBook,
  receiveHandover,
  registerHandover,
  resubmitLegacy,
} from '@/api/duty-service'
import { DUTY_STATUSES } from '@/data/duty'
import type { DutyBook, DutyRecord, DutyStatus, ShiftKey } from '@/data/duty'

const blankForm = () => ({
  dutyDate: '',
  shift: '白班' as ShiftKey,
  dutyPerson: '',
  handoverTime: '',
  itemsText: '',
})

const book = ref<DutyBook>({ migrated: false, records: [], rejected: [] })
const form = reactive(blankForm())
const receivers = reactive<Record<number, string>>({})
const results = reactive<Record<number, string>>({})
const refillTimes = reactive<Record<number, string>>({})
const message = ref('')
const messageOk = ref(false)

const statusOrder: Record<DutyStatus, number> = { 待签收: 0, 已接班: 1, 已办结: 2 }

function sortRecords(rows: DutyRecord[]): DutyRecord[] {
  return [...rows].sort((a, b) =>
    `${a.dutyDate} ${a.handoverTime} ${a.id}`.localeCompare(`${b.dutyDate} ${b.handoverTime} ${b.id}`),
  )
}

const columns = computed(() => {
  const byShift = (shift: ShiftKey) =>
    sortRecords(book.value.records.filter((record) => record.shift === shift))
  const awaiting = sortRecords(book.value.records.filter((record) => record.status === '待签收'))
  return [
    { key: 'day', title: '白班 08:00-20:00', records: byShift('白班'), hint: '' },
    { key: 'night', title: '夜班 20:00-次日08:00', records: byShift('夜班'), hint: '' },
    {
      key: 'awaiting',
      title: '未被下一班签收',
      records: awaiting,
      hint: '上一班交班后尚未签收接班的交接事项，须逐件盯办，签收后即从本栏移出。',
    },
  ]
})

const stats = computed(() => dutyStats(book.value))
const statCards = computed(() => [
  { label: '值班班次', value: stats.value.shifts, warn: false },
  { label: '待签收', value: stats.value.awaiting, warn: stats.value.awaiting > 0 },
  { label: '已接班', value: stats.value.received, warn: false },
  { label: '已办结', value: stats.value.completed, warn: false },
  { label: '退回重填', value: stats.value.rejected, warn: stats.value.rejected > 0 },
])

const stageSummary = computed(() =>
  DUTY_STATUSES.map((status) => ({
    status,
    count: book.value.records.filter((record) => record.status === status).length,
  })),
)

const sharedHandoverTime = computed(() => latestHandoverTime())

function padId(id: number): string {
  return String(id).padStart(4, '0')
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function reload() {
  book.value = loadDutyBook()
}

function submitRegister() {
  const result = registerHandover({ ...form })
  notify(result.ok, result.message)
  if (result.ok && result.book) {
    book.value = result.book
    Object.assign(form, blankForm())
  }
}

function receive(record: DutyRecord) {
  const result = receiveHandover(record.id, receivers[record.id] ?? '')
  notify(result.ok, result.message)
  if (result.ok && result.book) {
    book.value = result.book
    receivers[record.id] = ''
  }
}

function complete(record: DutyRecord) {
  const result = completeHandover(record.id, results[record.id] ?? '')
  notify(result.ok, result.message)
  if (result.ok && result.book) {
    book.value = result.book
    results[record.id] = ''
  }
}

function submitRefill(tempId: number) {
  const result = resubmitLegacy(tempId, refillTimes[tempId] ?? '')
  notify(result.ok, result.message)
  if (result.ok && result.book) {
    book.value = result.book
    refillTimes[tempId] = ''
  }
}

reload()
</script>

<style scoped>
.stat-warn { color: #b42318; }
.legend-time { background: #e7f0ff; color: #1d4ed8; }
.ok-text { color: #15803d; }

.register-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.register-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
.register-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.filter-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.filter-item input,
.filter-item select,
.filter-item textarea,
.reject-form input,
.duty-ops input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font: inherit;
  font-size: 13px;
}
.filter-wide { grid-column: 1 / -1; }
.register-foot { display: flex; align-items: center; gap: 12px; margin-top: 10px; }

.reject-panel {
  background: #fef3f2;
  border: 1px solid #fda29b;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reject-title { font-size: 13px; font-weight: 600; color: #b42318; }
.reject-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
.reject-info { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.reject-items { color: var(--muted); }
.reject-form { display: flex; gap: 8px; align-items: center; }
.reject-form input { width: 240px; }

.duty-columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
.duty-column {
  background: #eef2f7;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  min-height: 120px;
}
.duty-column.awaiting { background: #fff7ed; border-color: #fdba74; }
.column-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.column-head h3 { font-size: 14px; margin: 0; }
.column-count { font-size: 12px; color: var(--muted); }
.column-hint { font-size: 12px; color: #9a3412; margin: 0 0 8px; }
.column-empty { background: transparent; }

.duty-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin-bottom: 10px; }
.duty-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.duty-id { font-size: 12px; color: var(--muted); font-weight: 600; }
.duty-id em {
  font-style: normal;
  background: #e0e7ff;
  color: #3730a3;
  border-radius: 4px;
  padding: 0 6px;
  margin-left: 6px;
  font-size: 11px;
}
.duty-status { font-size: 12px; border-radius: 999px; padding: 2px 10px; }
.status-0 { background: #ffedd5; color: #9a3412; }
.status-1 { background: #dbeafe; color: #1e40af; }
.status-2 { background: #dcfce7; color: #166534; }

.duty-meta { display: flex; flex-direction: column; gap: 3px; margin: 0 0 8px; }
.duty-meta div { display: flex; gap: 8px; font-size: 12px; }
.duty-meta dt { color: var(--muted); width: 64px; flex: none; }
.duty-meta dd { margin: 0; }
.duty-items { margin: 0 0 8px; padding-left: 18px; font-size: 13px; display: flex; flex-direction: column; gap: 3px; }
.duty-result { border-top: 1px dashed var(--border); padding-top: 8px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.duty-result p { margin: 0; }
.duty-ops { display: flex; gap: 6px; align-items: center; }
.duty-ops input { flex: 1; }
.duty-ops .btn { flex: none; }

@media (max-width: 1100px) {
  .duty-columns, .register-grid { grid-template-columns: 1fr; }
}
</style>
