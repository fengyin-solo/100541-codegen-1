/** 值班值守与交接班台账的领域类型。 */

// 交接事项状态：严格逐段推进，不允许跳级或回退。
export const HANDOVER_STATUSES = ['待签收', '已签收', '已接班', '已办结'] as const
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number]

// 每个状态只开放唯一的下一步动作，保证「上一班签收、下一班接班、办结」逐段落地。
export const NEXT_HANDOVER_ACTION: Record<HandoverStatus, string | null> = {
  待签收: '签收',
  已签收: '接班',
  已接班: '办结',
  已办结: null,
}

export type HandoverRow = {
  id: number
  status: HandoverStatus
  pending: boolean
  abnormal: boolean
  班次: string
  值班人员: string
  交班时间: string
  交接事项: string
  交班人: string
  签收人: string
  接班时间: string
  办结时间: string
  跟进巡查编号: string
  原顺序: number
}

export type ShiftColumn = {
  班次: string
  值班人员: string
  交班时间: string
  registered: boolean
  items: HandoverRow[]
}

export type RegisterResult = {
  ok: boolean
  message: string
  rows?: HandoverRow[]
}
