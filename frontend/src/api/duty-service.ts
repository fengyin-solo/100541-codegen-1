// 值班台账的业务规则全在这一层：交班登记、签收接班、办结，状态只能逐段推进；
// 办结结果幂等回写到「群测群防巡查」的待办。
import { listRows, saveRows } from '@/data/local-store'
import {
  DUTY_STATUSES,
  DUTY_STORAGE_KEY,
  SHIFT_KEYS,
  formatNow,
  migrateLegacy,
  parseDutyDate,
  parseHandoverTime,
  splitHandoverItems,
  type DutyBook,
  type DutyRecord,
  type DutyStatus,
  type RejectedDutyRow,
  type ShiftKey,
} from '@/data/duty'
import type { ActionResult, EntryRow } from '@/data/types'

export interface DutyActionResult extends ActionResult {
  book?: DutyBook
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// localStorage 不可用（测试、隐私模式异常）时用内存兜底，至少同一会话内台账是连贯的。
let memoryBook: DutyBook | null = null

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

function readBook(): DutyBook {
  if (!storageAvailable()) {
    if (memoryBook === null) {
      memoryBook = migrateLegacy()
    }
    return memoryBook
  }
  const raw = window.localStorage.getItem(DUTY_STORAGE_KEY)
  if (!raw) {
    const book = migrateLegacy()
    window.localStorage.setItem(DUTY_STORAGE_KEY, JSON.stringify(book))
    return book
  }
  try {
    const parsed = JSON.parse(raw) as DutyBook
    if (!parsed || !Array.isArray(parsed.records) || !Array.isArray(parsed.rejected)) {
      throw new Error('台账结构不完整')
    }
    return parsed
  } catch {
    // 本地数据损坏时回到存量迁移结果，宁退不乱。
    const book = migrateLegacy()
    window.localStorage.setItem(DUTY_STORAGE_KEY, JSON.stringify(book))
    return book
  }
}

function persist(book: DutyBook): DutyBook {
  memoryBook = book
  if (storageAvailable()) {
    window.localStorage.setItem(DUTY_STORAGE_KEY, JSON.stringify(book))
  }
  return clone(book)
}

export function loadDutyBook(): DutyBook {
  return clone(readBook())
}

function nextId(records: DutyRecord[]): number {
  return records.reduce((max, record) => Math.max(max, record.id), 0) + 1
}

function findIndex(records: DutyRecord[], id: number): number {
  return records.findIndex((record) => record.id === id)
}

function assertStage(record: DutyRecord, expected: DutyStatus, verb: string): string | null {
  if (record.status === expected) {
    return null
  }
  const currentIndex = DUTY_STATUSES.indexOf(record.status)
  const expectedIndex = DUTY_STATUSES.indexOf(expected)
  if (currentIndex > expectedIndex) {
    return `该班次已经走到「${record.status}」，不能再${verb}`
  }
  // 落后于目标阶段就是跳级（例如「待签收」直接办结），一律拦下。
  return `状态不能跳级：当前「${record.status}」，须先完成「${expected}」`
}

export interface RegisterInput {
  dutyDate: string
  shift: string
  dutyPerson: string
  handoverTime: string
  itemsText: string
}

// 上一班交班登记。同一值班日期+班次只挂一条：重复登记走更新，绝不新增第二条。
export function registerHandover(input: RegisterInput): DutyActionResult {
  const dutyDate = parseDutyDate(input.dutyDate)
  if (!dutyDate) {
    return { ok: false, message: '值班日期无效，请按 YYYY-MM-DD 重新填写' }
  }
  const shift = input.shift as ShiftKey
  if (!SHIFT_KEYS.includes(shift)) {
    return { ok: false, message: '值班班次只支持白班或夜班' }
  }
  const dutyPerson = input.dutyPerson.trim()
  if (!dutyPerson) {
    return { ok: false, message: '值班人员（交班人）不能为空' }
  }
  // 交班时间落成无效值的一律退回重填。
  const handoverTime = parseHandoverTime(input.handoverTime)
  if (!handoverTime) {
    return { ok: false, message: '交班时间无效，请按 YYYY-MM-DD HH:mm 重新填写（例如 2026-09-28 20:00）' }
  }
  const items = splitHandoverItems(input.itemsText)
  if (items.length === 0) {
    return { ok: false, message: '至少登记一条当班交接事项' }
  }

  const book = readBook()
  const existing = book.records.find(
    (record) => record.dutyDate === dutyDate && record.shift === shift,
  )
  if (existing) {
    if (existing.status !== '待签收') {
      // 已经签收/办结的班次不能再回头改交接，避免前后台账各说各话。
      return {
        ok: false,
        message: `${dutyDate} ${shift}已${existing.status}，不能重复交班；同一班次只挂一条交接`,
      }
    }
    existing.dutyPerson = dutyPerson
    existing.handoverTime = handoverTime
    existing.items = items
    existing.legacy = false
    return { ok: true, message: '该班次已有交接，已按本次登记更新，仍只挂一条', book: persist(book) }
  }

  book.records.push({
    id: nextId(book.records),
    status: '待签收',
    pending: true,
    abnormal: false,
    legacy: false,
    dutyDate,
    shift,
    dutyPerson,
    handoverTime,
    items,
    receivedBy: '',
    receivedTime: '',
    completedTime: '',
    result: '',
    patrolFollowupId: null,
  })
  return { ok: true, message: '交班已登记，等待下一班签收', book: persist(book) }
}

// 下一班签收接班：只允许「待签收 → 已接班」。
export function receiveHandover(id: number, receivedBy: string): DutyActionResult {
  const receiver = receivedBy.trim()
  if (!receiver) {
    return { ok: false, message: '请填写签收接班人' }
  }
  const book = readBook()
  const index = findIndex(book.records, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的值班班次` }
  }
  const record = book.records[index]
  const blocked = assertStage(record, '待签收', '签收接班')
  if (blocked) {
    return { ok: false, message: blocked }
  }
  record.status = '已接班'
  record.pending = false
  record.receivedBy = receiver
  record.receivedTime = formatNow()
  return { ok: true, message: `${record.dutyDate} ${record.shift}已由${receiver}签收接班`, book: persist(book) }
}

// 办结：只允许「已接班 → 已办结」，并把交接结果回写成群测群防巡查的一条待跟进待办。
export function completeHandover(id: number, result: string): DutyActionResult {
  const summary = result.trim()
  if (!summary) {
    return { ok: false, message: '请填写办结结果' }
  }
  const book = readBook()
  const index = findIndex(book.records, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的值班班次` }
  }
  const record = book.records[index]
  const blocked = assertStage(record, '已接班', '办结')
  if (blocked) {
    return { ok: false, message: blocked }
  }

  record.status = '已办结'
  record.pending = false
  record.completedTime = formatNow()
  record.result = summary

  // 回写群测群防巡查待办：同一班次只追加一条，重复办结不会凭空多出第二项。
  if (record.patrolFollowupId === null) {
    const patrolRows = listRows('patrol')
    const followupId = nextPatrolId(patrolRows)
    patrolRows.push(buildPatrolFollowup(followupId, record))
    saveRows('patrol', patrolRows)
    record.patrolFollowupId = followupId
  }

  return { ok: true, message: `已办结，交接结果已回写群测群防巡查待办（PATR-${padId(record.patrolFollowupId ?? 0)}）`, book: persist(book) }
}

// 存量退回记录重填：补齐有效交班时间后走正常登记，原退回清单同步销项。
export function resubmitLegacy(tempId: number, handoverTime: string): DutyActionResult {
  const normalized = parseHandoverTime(handoverTime)
  if (!normalized) {
    return { ok: false, message: '交班时间仍为无效值，请按 YYYY-MM-DD HH:mm 重新填写' }
  }
  const book = readBook()
  const rejectedIndex = book.rejected.findIndex((row) => row.tempId === tempId)
  if (rejectedIndex < 0) {
    return { ok: false, message: '该退回记录已处理或不存在' }
  }
  const legacy = book.rejected[rejectedIndex]
  if (book.records.some((record) => record.dutyDate === legacy.dutyDate && record.shift === legacy.shift)) {
    book.rejected.splice(rejectedIndex, 1)
    return { ok: false, message: `${legacy.dutyDate} ${legacy.shift}已有交接，无需重填`, book: persist(book) }
  }
  book.records.push({
    id: nextId(book.records),
    status: '待签收',
    pending: true,
    abnormal: false,
    legacy: true,
    dutyDate: legacy.dutyDate,
    shift: legacy.shift,
    dutyPerson: legacy.dutyPerson,
    handoverTime: normalized,
    items: [...legacy.items],
    receivedBy: '',
    receivedTime: '',
    completedTime: '',
    result: '',
    patrolFollowupId: null,
  })
  book.rejected.splice(rejectedIndex, 1)
  return { ok: true, message: '交班时间已补正，存量记录按原顺序回填', book: persist(book) }
}

function nextPatrolId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function padId(id: number): string {
  return String(id).padStart(4, '0')
}

function buildPatrolFollowup(id: number, record: DutyRecord): EntryRow {
  // 办结结果不能丢：摘要写进巡查结论，事项汇总写进坡面情况，状态保持待巡查=待跟进。
  return {
    id,
    status: '待巡查',
    pending: true,
    abnormal: false,
    巡查编号: `PATR-${padId(id)}`,
    所属隐患点: `交接班待跟进·${record.dutyDate} ${record.shift}`,
    巡查人: record.receivedBy || record.dutyPerson,
    巡查日期: record.completedTime.slice(0, 10),
    坡面情况: `交接事项：${record.items.join('；')}`,
    排水情况: `来源：值班值守交接班台账（班次#${record.id}）`,
    巡查结论: `【交接班待跟进】${record.result}`,
    巡查状态: '待跟进',
  }
}

// 各入口读同一份交班时间：取最近一次登记的交班时间，页面之间不会各说各话。
export function latestHandoverTime(): string {
  const { records } = readBook()
  if (records.length === 0) {
    return ''
  }
  return records
    .map((record) => record.handoverTime)
    .filter(Boolean)
    .sort()
    .slice(-1)[0]
}

export interface DutyStats {
  shifts: number
  awaiting: number
  received: number
  completed: number
  rejected: number
}

export function dutyStats(book: DutyBook = loadDutyBook()): DutyStats {
  return {
    shifts: book.records.length,
    awaiting: book.records.filter((record) => record.status === '待签收').length,
    received: book.records.filter((record) => record.status === '已接班').length,
    completed: book.records.filter((record) => record.status === '已办结').length,
    rejected: book.rejected.length,
  }
}

export type { RejectedDutyRow }
