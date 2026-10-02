// 值班值守与交接班台账的数据层：
// 班次定义、交接事项、交班时间校验、存量迁移都集中在这一册，各入口只读这里的数据。

export type DutyStatus = '待签收' | '已接班' | '已办结'
export type ShiftKey = '白班' | '夜班'

// 状态只能顺着走：上一班签收登记 → 下一班签收接班 → 办结，跳一级都不行。
export const DUTY_STATUSES: DutyStatus[] = ['待签收', '已接班', '已办结']

export const SHIFT_TIME_RANGE: Record<ShiftKey, string> = {
  白班: '08:00-20:00',
  夜班: '20:00-次日08:00',
}

export const SHIFT_KEYS: ShiftKey[] = ['白班', '夜班']

export interface DutyRecord {
  id: number
  status: DutyStatus
  pending: boolean
  abnormal: boolean
  // 存量迁移回来的记录打个印记，迁移顺序就是 id 顺序。
  legacy: boolean
  dutyDate: string // 值班日期 YYYY-MM-DD
  shift: ShiftKey // 值班班次
  dutyPerson: string // 值班人员（交班人）
  handoverTime: string // 交班时间，统一落成 YYYY-MM-DD HH:mm
  items: string[] // 当班登记的交接事项
  receivedBy: string // 下一班签收人
  receivedTime: string // 签收时间
  completedTime: string // 办结时间
  result: string // 办结结果
  patrolFollowupId: number | null // 回写到群测群防巡查的待办 id
}

export interface LegacyDutyRaw {
  dutyDate: string
  shift: ShiftKey
  dutyPerson: string
  handoverTime: string // 旧台账里的交班时间原文，可能是无效值
  items: string[]
}

// 迁移时被退回的存量记录：时间落不成有效值，挂出来等重填。
export interface RejectedDutyRow extends LegacyDutyRaw {
  tempId: number
  reason: string
}

export interface DutyBook {
  migrated: boolean
  records: DutyRecord[]
  rejected: RejectedDutyRow[]
}

export const DUTY_STORAGE_KEY = 'geohazard-patrol:duty'

// 微信群时代攒下来的旧台账，顺序就是当时登记的顺序，迁移时按这个顺序回填。
export const LEGACY_DUTY_ROWS: LegacyDutyRaw[] = [
  {
    dutyDate: '2026-09-26',
    shift: '白班',
    dutyPerson: '张守堤',
    handoverTime: '2026-09-26 20:00',
    items: ['清点库房防汛沙袋 40 条', '三号裂缝桩本期宽度待下一班复核'],
  },
  {
    dutyDate: '2026-09-26',
    shift: '夜班',
    dutyPerson: '李夜巡',
    handoverTime: '2026-09-27 08:00',
    items: ['夜间累计雨量 18mm，未达预警阈值', '河东岸排洪沟淤积未清完，续办'],
  },
  {
    dutyDate: '2026-09-27',
    shift: '白班',
    dutyPerson: '王群测',
    handoverTime: '2026-09-27 20:00',
    items: ['老庄组警示牌固定螺丝松动', '转移避险明白卡还差 3 户未更新'],
  },
  {
    dutyDate: '2026-09-27',
    shift: '夜班',
    dutyPerson: '赵夜值',
    handoverTime: '2026-09-28 08:00',
    items: ['暴雨蓝色预警短信已逐户确认', '村部安置点门锁损坏，已电话报修'],
  },
  {
    // 这一条交班时间字迹潦草、录成了无效值，迁移时必须退回重填。
    dutyDate: '2026-09-28',
    shift: '白班',
    dutyPerson: '陈交班',
    handoverTime: '2026-09-28 25:00',
    items: ['后山边坡有零星掉块，接班后先去复查'],
  },
]

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

// 值班日期只收 YYYY-MM-DD，月日越界同样退回。
export function parseDutyDate(raw: string): string | null {
  const text = raw.trim()
  const match = text.match(DATE_RE)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null
  }
  return `${match[1]}-${match[2]}-${match[3]}`
}

// 交班时间唯一落库格式：YYYY-MM-DD HH:mm。
// 空值、白话、月份/日期/时/分越界（含 25:00 这类）一律判无效，调用方必须退回重填。
export function parseHandoverTime(raw: string): string | null {
  const text = raw.trim()
  const match = text.match(DATETIME_RE)
  if (!match) {
    return null
  }
  const [, y, mo, d, h, mi] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null
  }
  if (hour > 23 || minute > 59) {
    return null
  }
  return `${y}-${mo}-${d} ${String(hour).padStart(2, '0')}:${mi}`
}

export function splitHandoverItems(raw: string): string[] {
  return raw
    .split(/[\n;；]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function formatNow(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// 存量迁移：按原有顺序逐条回填，id 就是原顺序；无效时间不硬塞，收进退回清单。
export function migrateLegacy(rows: LegacyDutyRaw[] = LEGACY_DUTY_ROWS): DutyBook {
  const records: DutyRecord[] = []
  const rejected: RejectedDutyRow[] = []
  rows.forEach((row, index) => {
    const handoverTime = parseHandoverTime(row.handoverTime)
    if (!handoverTime || !parseDutyDate(row.dutyDate)) {
      rejected.push({
        ...row,
        tempId: -(index + 1),
        reason: '交班时间落成无效值，退回重填',
      })
      return
    }
    // 旧台账没有电子签收环节，迁进来一律先挂「待签收」，由下一班补签收，顺序不变。
    records.push({
      id: records.length + 1,
      status: '待签收',
      pending: true,
      abnormal: false,
      legacy: true,
      dutyDate: row.dutyDate,
      shift: row.shift,
      dutyPerson: row.dutyPerson,
      handoverTime,
      items: [...row.items],
      receivedBy: '',
      receivedTime: '',
      completedTime: '',
      result: '',
      patrolFollowupId: null,
    })
  })
  return { migrated: true, records, rejected }
}
