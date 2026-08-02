export const ACCOUNTS = { tc: 'Thiago', bc: 'Bernardo', nn: 'Nick' }
export const COLORS = { tc: 'var(--tc)', bc: 'var(--bc)', nn: 'var(--nn)' }

export const UPWORK_FEE = 0.10
export const net = (x) => Number(x || 0) * (1 - UPWORK_FEE)

export const money = (n) =>
  (n < 0 ? '-$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const money2 = (n) =>
  (n < 0 ? '-$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const hrs = (n) => Number(n || 0).toFixed(1) + 'h'

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const dayName = (dateStr) => DOW[(new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7]

// ---- dates: one house style, 'Jul. 27 – Aug. 2, 2026' ----
const MON = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']
const _d = (iso) => new Date(String(iso).slice(0, 10) + 'T00:00:00Z')
/** 'Jul. 27' */
export const fmtDay = (iso) => { const d = _d(iso); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate() }
/** 'Jul. 27, 2026' */
export const fmtDate = (iso) => { const d = _d(iso); return fmtDay(iso) + ', ' + d.getUTCFullYear() }
/** Monday ISO -> 'Jul. 27 – Aug. 2, 2026' (adds both years when the week spans one) */
export function fmtWeekRange(mondayIso) {
  const a = _d(mondayIso)
  const b = new Date(a.getTime() + 6 * 86400000)
  const ya = a.getUTCFullYear(), yb = b.getUTCFullYear()
  const left = MON[a.getUTCMonth()] + ' ' + a.getUTCDate() + (ya !== yb ? ', ' + ya : '')
  return left + ' – ' + MON[b.getUTCMonth()] + ' ' + b.getUTCDate() + ', ' + yb
}
/** 'Jul. 27, 2026, 3:04 PM' for timestamps */
export const fmtStamp = (ts) => {
  const d = new Date(ts)
  return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ', ' +
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
