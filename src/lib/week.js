// Shared week selection so the Hours Mirror and Week Suggestions always
// agree on which week you're working in (they read/write the same
// upwork_blocks + week_log_plan rows, so a mismatch corrupts both).
const KEY = 'ff_week_off'
const pad = (n) => String(n).padStart(2, '0')
const isoDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())

/** Monday of the week `offset` weeks from today (0 = this week). */
export function mondayOf(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7)
  return isoDate(d)
}
export function plusDays(iso, n) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return isoDate(d)
}
/** Week offset shared across pages (clamped by each page's own limits). */
export const getWeekOff = () => {
  const v = Number(localStorage.getItem(KEY))
  return Number.isFinite(v) ? v : 0
}
export const setWeekOff = (off) => localStorage.setItem(KEY, String(off))
/** Offset (negative = past) of the Monday `iso` relative to this week. */
export function offsetOfMonday(iso) {
  const a = new Date(mondayOf(0) + 'T00:00:00')
  const b = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  return Math.round((b - a) / (7 * 86400000))
}
