/** 把「分」格式化成人民币显示，如 12345 -> ¥123.45 */
export function fmtMoney(cents) {
  return '¥' + (cents / 100).toFixed(2)
}

/** 2026年8月 */
export function fmtYM(year, month) {
  return `${year}年${month}月`
}

/** 2026-08-21 -> 8月21日 */
export function fmtDateCN(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${m}月${d}日`
}

export function weekDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

/** 今天的日期，YYYY-MM-DD */
export function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 把后台抛出的错误信息整理成简洁的中文提示 */
export function cleanIpcError(err) {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') || '操作失败，请重试'
}
