import { defineStore } from 'pinia'

// 交班时间的唯一时钟源：所有登记入口都读这一份，不能各入口各填各的。
// 持久化在独立的 localStorage 键里，与台账数据分开保存。
const CLOCK_KEY = 'geohazard-patrol:duty-handover-clock'

function readClock(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return ''
  }
  return window.localStorage.getItem(CLOCK_KEY) ?? ''
}

export const useDutyClockStore = defineStore('duty-clock', {
  state: () => ({
    handoverTime: readClock(),
  }),
  actions: {
    // datetime-local 用的是 YYYY-MM-DDTHH:mm，台账里统一落 YYYY-MM-DD HH:mm。
    setHandoverTime(value: string) {
      this.handoverTime = value
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(CLOCK_KEY, value)
      }
    },
  },
})
