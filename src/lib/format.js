export const ACCOUNTS = { tc: 'Thiago', bc: 'Bernardo', nn: 'Nick' }
export const COLORS = { tc: 'var(--tc)', bc: 'var(--bc)', nn: 'var(--nn)' }

export const UPWORK_FEE = 0.10
export const net = (x) => Number(x || 0) * (1 - UPWORK_FEE)

export const money = (n) =>
  (n < 0 ? '-$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })

export const money2 = (n) =>
  (n < 0 ? '-$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const hrs = (n) => Number(n || 0).toFixed(1) + 'h'

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const dayName = (dateStr) => DOW[(new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7]
