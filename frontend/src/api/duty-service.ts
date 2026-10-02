import { useSessionStore } from '@/stores/session'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import { NEXT_HANDOVER_ACTION } from '@/data/duty-types'
import type { HandoverRow, RegisterResult, ShiftColumn } from '@/data/duty-types'

// 台账两张表与业务模块共用同一份本地持久化，但键名独立，互不干扰。
const SHIFTS_KEY = 'duty:shifts'
const HANDOVERS_KEY = 'duty:handovers'
const PATROL_KEY = 'patrol'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function nowStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type ParsedTime = { ok: true; value: string } | { ok: false; message: string }

// 交班时间校验唯一入口：支持 YYYY-MM-DD HH:mm、YYYY/M/D H:m、带秒、datetime-local 的 T 分隔；
// 不存在的日期（如 2 月 30 日）、越界时分秒一律判无效，要求退回重填。
export function parseHandoverTime(raw: string): ParsedTime {
  const text = raw.trim().replace(/[T/]/g, (ch) => (ch === 'T' ? ' ' : '-'))
  const matched = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(text)
  if (!matched) {
    return { ok: false, message: '交班时间格式无效，应为「年-月-日 时:分」，请退回重填' }
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const hour = Number(matched[4])
  const minute = Number(matched[5])
  const second = matched[6] === undefined ? null : Number(matched[6])
  if (month < 1 || month > 12) {
    return { ok: false, message: `交班时间的月份 ${month} 无效，请退回重填` }
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day < 1 || day > daysInMonth[month - 1]) {
    return { ok: false, message: `交班时间 ${year}-${pad(month)}-${pad(day)} 不是有效日期，请退回重填` }
  }
  if (hour > 23) {
    return { ok: false, message: `交班时间的小时 ${hour} 无效，请退回重填` }
  }
  if (minute > 59) {
    return { ok: false, message: `交班时间的分钟 ${minute} 无效，请退回重填` }
  }
  if (second !== null && second > 59) {
    return { ok: false, message: `交班时间的秒数 ${second} 无效，请退回重填` }
  }
  return { ok: true, value: `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}` }
}

export function listShifts(): EntryRow[] {
  return listRows(SHIFTS_KEY)
}

export function listHandovers(): HandoverRow[] {
  return listRows(HANDOVERS_KEY) as unknown as HandoverRow[]
}

// 按值班班次分栏：班次按排班原顺序排列，栏内事项按迁移/登记的原顺序排列。
export function shiftColumns(): ShiftColumn[] {
  const shifts = listShifts()
  const handovers = listHandovers().sort((a, b) => Number(a.原顺序) - Number(b.原顺序) || Number(a.id) - Number(b.id))
  return shifts.map((shift) => {
    const name = String(shift.班次 ?? '')
    const items = handovers.filter((row) => row.班次 === name)
    return {
      班次: name,
      值班人员: String(shift.值班人员 ?? ''),
      交班时间: items.length ? String(items[0].交班时间) : '',
      registered: items.length > 0,
      items,
    }
  })
}

// 还没被下一班签收的交接事项单独成栏。
export function unacknowledgedHandovers(): HandoverRow[] {
  return listHandovers()
    .filter((row) => row.status === '待签收')
    .sort((a, b) => Number(a.原顺序) - Number(b.原顺序) || Number(a.id) - Number(b.id))
}

function nextShiftOf(shiftName: string): EntryRow | null {
  const shifts = listShifts()
  const index = shifts.findIndex((shift) => String(shift.班次) === shiftName)
  if (index < 0 || index + 1 >= shifts.length) {
    return null
  }
  return shifts[index + 1]
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

// 当班登记交接事项：同一班次走两次交接只挂一条，交班时间取统一时钟源且必须有效。
export function registerHandover(
  shiftName: string,
  rawTime: string,
  itemTexts: string[],
  handoverPerson?: string,
): RegisterResult {
  const shifts = listShifts()
  const shift = shifts.find((row) => String(row.班次) === shiftName)
  if (!shift) {
    return { ok: false, message: `没有找到班次「${shiftName}」，无法登记交接` }
  }
  const handovers = listHandovers()
  if (handovers.some((row) => row.班次 === shiftName)) {
    return { ok: false, message: `班次「${shiftName}」已经交接过，同一班次只挂一条交接，不能重复登记` }
  }
  const parsed = parseHandoverTime(rawTime)
  if (!parsed.ok) {
    return { ok: false, message: parsed.message }
  }
  const texts = itemTexts.map((text) => text.trim()).filter(Boolean)
  if (texts.length === 0) {
    return { ok: false, message: '请至少填写一条交接事项' }
  }
  const session = useSessionStore()
  const person = handoverPerson?.trim() || String(shift.值班人员 ?? '') || session.operator
  const baseOrder = handovers.reduce((max, row) => Math.max(max, Number(row.原顺序)), 0)
  let id = nextId(handovers)
  const created: HandoverRow[] = texts.map((text, index) => ({
    id: id++,
    status: '待签收',
    pending: true,
    abnormal: false,
    班次: shiftName,
    值班人员: String(shift.值班人员 ?? ''),
    交班时间: parsed.value,
    交接事项: text,
    交班人: person,
    签收人: '',
    接班时间: '',
    办结时间: '',
    跟进巡查编号: '',
    原顺序: baseOrder + index + 1,
  }))
  saveRows(HANDOVERS_KEY, [...handovers, ...created] as unknown as EntryRow[])
  return { ok: true, message: `班次「${shiftName}」已登记 ${created.length} 条交接事项，等待下一班签收`, rows: created }
}

function saveHandovers(rows: HandoverRow[]): void {
  saveRows(HANDOVERS_KEY, rows as unknown as EntryRow[])
}

// 办结时把结果回写到群测群防巡查的待办：那边凭空多出一项待跟进事项；重复办结不再多挂。
function writeBackPatrolFollowup(row: HandoverRow): string {
  if (row.跟进巡查编号) {
    return row.跟进巡查编号
  }
  const patrol = listRows(PATROL_KEY)
  const followCode = `PATR-HD-${String(row.id).padStart(4, '0')}`
  if (patrol.some((item) => String(item.巡查编号) === followCode)) {
    row.跟进巡查编号 = followCode
    return followCode
  }
  const followRow: EntryRow = {
    id: nextId(patrol),
    status: '待巡查',
    pending: true,
    abnormal: false,
    巡查编号: followCode,
    所属隐患点: `交接班跟进（${row.班次}）`,
    巡查人: row.签收人 || row.值班人员,
    巡查日期: row.办结时间.slice(0, 10),
    坡面情况: '由交接班台账办结回写',
    排水情况: '',
    巡查结论: `【待跟进】${row.交接事项}`,
    巡查状态: '待跟进',
  }
  // 追加在尾部，存量巡查记录的原有顺序不动。
  saveRows(PATROL_KEY, [...patrol, followRow])
  row.跟进巡查编号 = followCode
  return followCode
}

// 状态逐段推进：待签收 → 已签收 → 已接班 → 已办结。跳级、回退一律拦下。
export function advanceHandover(id: number, action: string, actor?: string): ActionResult {
  const rows = listHandovers()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的交接事项` }
  }
  const row = rows[index]
  const expected = NEXT_HANDOVER_ACTION[row.status]
  if (expected === null) {
    return { ok: false, message: '该交接事项已办结，不能重复操作' }
  }
  if (action !== expected) {
    return {
      ok: false,
      message: `当前状态「${row.status}」只能先「${expected}」，「${action}」属于跳级操作，已拦下，请逐段推进`,
    }
  }
  if (action === '签收') {
    // 交班时间是无效值的，签收一律拦下，先退回重填。
    const parsed = parseHandoverTime(String(row.交班时间))
    if (!parsed.ok) {
      return { ok: false, message: `交班时间为无效值（${row.交班时间}），请先退回重填后再签收` }
    }
    const nextShift = nextShiftOf(String(row.班次))
    if (!nextShift) {
      return { ok: false, message: `班次「${row.班次}」之后没有排下一班，无人可以签收` }
    }
    row.签收人 = actor?.trim() || String(nextShift.值班人员 ?? '')
    row.status = '已签收'
    row.pending = true
  } else if (action === '接班') {
    // 只有完成签收的下一班才能接班；没有签收人（理论上到不了这一步）同样拦下。
    if (!row.签收人) {
      return { ok: false, message: '该交接事项尚未签收，不能直接接班，请逐段推进' }
    }
    row.接班时间 = nowStamp()
    row.status = '已接班'
    row.pending = true
  } else {
    row.办结时间 = nowStamp()
    row.status = '已办结'
    const followCode = writeBackPatrolFollowup(row)
    row.pending = false
    saveHandovers(rows)
    return { ok: true, message: `交接事项已办结，已回写群测群防巡查待办：${followCode}` }
  }
  saveHandovers(rows)
  return { ok: true, message: `交接事项已${action}，当前状态「${row.status}」` }
}

// 无效交班时间退回重填：登记入口落成无效值时直接拒收，存量无效值在这里改填有效时间。
export function correctHandoverTime(id: number, rawTime: string): ActionResult {
  const parsed = parseHandoverTime(rawTime)
  if (!parsed.ok) {
    return { ok: false, message: parsed.message }
  }
  const rows = listHandovers()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的交接事项` }
  }
  rows[index].交班时间 = parsed.value
  rows[index].abnormal = false
  saveHandovers(rows)
  return { ok: true, message: `交班时间已改填为 ${parsed.value}，可以继续签收` }
}
