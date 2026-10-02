<template>
  <section class="page" data-module="duty">
    <header class="page-head">
      <div>
        <h2>值班值守与交接班台账</h2>
        <p class="page-desc">按值班班次分栏记录值班人员、交班时间与交接事项；状态按「签收 → 接班 → 办结」逐段推进，跳级一律拦下。</p>
      </div>
    </header>

    <div class="clock-bar">
      <label class="clock-input">
        <span>统一交班时间（各登记入口共用这一份）</span>
        <input
          v-model="clockLocal"
          :type="clockValid ? 'datetime-local' : 'text'"
          placeholder="YYYY-MM-DD HH:mm"
          @change="saveClock"
        />
      </label>
      <span class="clock-value">当前生效：{{ clock.handoverTime || '尚未设置' }}</span>
      <button class="btn" type="button" @click="setClockNow">取当前时间</button>
      <span v-if="clockMessage" class="error-text">{{ clockMessage }}</span>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">值班班次</span>
        <strong class="stat-value">{{ columns.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已交接班次</span>
        <strong class="stat-value">{{ columns.filter((c) => c.registered).length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待下一班签收</span>
        <strong class="stat-value">{{ pendingItems.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">在办事项</span>
        <strong class="stat-value">{{ activeCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已办结事项</span>
        <strong class="stat-value">{{ doneCount }}</strong>
      </article>
    </div>

    <p v-if="message" class="error-text">{{ message }}</p>

    <div class="board">
      <section v-for="column in columns" :key="column.班次" class="shift-column">
        <header class="shift-head">
          <strong>{{ column.班次 }}</strong>
          <span class="shift-person">值班：{{ column.值班人员 }}</span>
          <span v-if="column.registered" class="shift-time">交班：{{ column.交班时间 }}</span>
          <span v-else class="shift-time empty">本班尚未登记交接</span>
        </header>

        <article v-for="item in column.items" :key="item.id" class="handover-card" :class="{ abnormal: item.abnormal }">
          <p class="handover-text">{{ item.交接事项 }}</p>
          <p class="handover-meta">
            <span class="status-tag" :data-status="item.status">{{ item.status }}</span>
            <span>交班人：{{ item.交班人 }}</span>
            <span v-if="item.签收人">签收人：{{ item.签收人 }}</span>
            <span v-if="item.接班时间">接班：{{ item.接班时间 }}</span>
            <span v-if="item.办结时间">办结：{{ item.办结时间 }}</span>
          </p>
          <p v-if="invalidTime(item)" class="handover-warn">交班时间「{{ item.交班时间 }}」为无效值，需退回重填</p>
          <div v-if="invalidTime(item)" class="card-row">
            <input v-model="corrections[item.id]" type="text" placeholder="YYYY-MM-DD HH:mm" />
            <button class="link" type="button" @click="correct(item)">改填时间</button>
          </div>
          <div v-else class="card-row">
            <button
              v-for="action in availableActions(item)"
              :key="action"
              class="link"
              type="button"
              @click="advance(action, item)"
            >
              {{ action }}
            </button>
            <RouterLink v-if="item.status === '已办结'" class="link" to="/patrol">
              查看巡查待办 {{ item.跟进巡查编号 }}
            </RouterLink>
          </div>
        </article>

        <button v-if="!column.registered" class="btn block-btn" type="button" @click="openRegister(column)">
          登记本班交接事项
        </button>

        <form v-if="registeringShift === column.班次" class="register-box" @submit.prevent="submitRegister(column)">
          <p class="register-time">交班时间（取自统一时钟）：<strong>{{ clockText }}</strong></p>
          <textarea v-model="registerText" rows="4" placeholder="逐条填写交接事项，每行一条"></textarea>
          <input v-model="registerPerson" :placeholder="`交班人（默认 ${column.值班人员}）`" />
          <div class="card-row">
            <button class="btn primary" type="submit">提交交接登记</button>
            <button class="btn ghost" type="button" @click="cancelRegister">取消</button>
          </div>
        </form>
      </section>

      <section class="shift-column pending-column">
        <header class="shift-head">
          <strong>待下一班签收</strong>
          <span class="shift-person">还没被下一班签收的交接事项</span>
        </header>
        <article v-for="item in pendingItems" :key="`pending-${item.id}`" class="handover-card" :class="{ abnormal: item.abnormal }">
          <p class="handover-source">来源班次：{{ item.班次 }}（{{ item.值班人员 }}）</p>
          <p class="handover-text">{{ item.交接事项 }}</p>
          <p class="handover-meta">
            <span>交班时间：{{ item.交班时间 }}</span>
            <span v-if="invalidTime(item)" class="handover-warn">无效值，退回重填</span>
          </p>
          <div v-if="invalidTime(item)" class="card-row">
            <input v-model="corrections[item.id]" type="text" placeholder="YYYY-MM-DD HH:mm" />
            <button class="link" type="button" @click="correct(item)">改填时间</button>
          </div>
          <div v-else class="card-row">
            <button class="link" type="button" @click="advance('签收', item)">签收</button>
          </div>
        </article>
        <p v-if="!pendingItems.length" class="empty-state">暂无待签收事项</p>
      </section>
    </div>

    <footer class="page-foot">
      <span>台账数据保存在本机浏览器；办结的交接事项会自动回写一条群测群防巡查待跟进事项。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  advanceHandover,
  correctHandoverTime,
  parseHandoverTime,
  registerHandover,
  shiftColumns,
  unacknowledgedHandovers,
} from '@/api/duty-service'
import { useDutyClockStore } from '@/stores/duty-clock'
import { NEXT_HANDOVER_ACTION } from '@/data/duty-types'
import type { HandoverRow, ShiftColumn } from '@/data/duty-types'

const clock = useDutyClockStore()
const clockLocal = ref(toLocalInput(clock.handoverTime))
const clockMessage = ref('')
// 生效中的交班时间有效才用时间选择器；存量被改成无效值时退回文本框重填。
const clockValid = computed(() => !clock.handoverTime || parseHandoverTime(clock.handoverTime).ok)

const columns = ref<ShiftColumn[]>([])
const pendingItems = ref<HandoverRow[]>([])
const message = ref('')
const corrections = reactive<Record<number, string>>({})

const registeringShift = ref('')
const registerText = ref('')
const registerPerson = ref('')

const activeCount = computed(() =>
  columns.value.reduce(
    (sum, column) => sum + column.items.filter((item) => item.status !== '已办结').length,
    0,
  ),
)
const doneCount = computed(() =>
  columns.value.reduce(
    (sum, column) => sum + column.items.filter((item) => item.status === '已办结').length,
    0,
  ),
)
const clockText = computed(() => (clock.handoverTime || '尚未设置，提交时将被退回'))

function toLocalInput(value: string): string {
  return value.replace(' ', 'T')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function setClockNow() {
  const d = new Date()
  clockLocal.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  saveClock()
}

function saveClock() {
  clockMessage.value = ''
  const raw = clockLocal.value.replace('T', ' ')
  const parsed = parseHandoverTime(raw)
  if (!parsed.ok) {
    clockMessage.value = parsed.message
    return
  }
  clock.setHandoverTime(parsed.value)
}

function invalidTime(item: HandoverRow): boolean {
  return !parseHandoverTime(String(item.交班时间)).ok
}

function availableActions(item: HandoverRow): string[] {
  const action = NEXT_HANDOVER_ACTION[item.status]
  return action ? [action] : []
}

function openRegister(column: ShiftColumn) {
  registeringShift.value = column.班次
  registerText.value = ''
  registerPerson.value = ''
  message.value = ''
}

function cancelRegister() {
  registeringShift.value = ''
}

function submitRegister(column: ShiftColumn) {
  message.value = ''
  if (!clock.handoverTime) {
    message.value = '统一交班时间尚未设置，请先在顶部设置后再登记'
    return
  }
  const texts = registerText.value.split('\n').map((line) => line.trim()).filter(Boolean)
  const result = registerHandover(column.班次, clock.handoverTime, texts, registerPerson.value)
  if (!result.ok) {
    message.value = result.message
    return
  }
  registeringShift.value = ''
  reload()
}

function advance(action: string, item: HandoverRow) {
  message.value = ''
  const result = advanceHandover(Number(item.id), action)
  if (!result.ok) {
    message.value = result.message
    return
  }
  reload()
}

function correct(item: HandoverRow) {
  message.value = ''
  const raw = corrections[item.id] ?? ''
  const result = correctHandoverTime(Number(item.id), raw)
  if (!result.ok) {
    message.value = result.message
    return
  }
  reload()
}

function reload() {
  columns.value = shiftColumns()
  pendingItems.value = unacknowledgedHandovers()
  for (const item of pendingItems.value) {
    if (corrections[item.id] === undefined) {
      corrections[item.id] = toLocalInput(String(item.交班时间))
    }
  }
  // 校验统一时钟本身是否仍有效（外部改动时兜底）。
  if (clock.handoverTime && !parseHandoverTime(clock.handoverTime).ok) {
    clockMessage.value = '统一交班时间为无效值，请在顶部重填'
  }
}

onMounted(() => {
  reload()
})
</script>
