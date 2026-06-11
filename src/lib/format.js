export const ACCOUNTS = { tc: 'Thiago', bc: 'Bernardo', nn: 'Nick' }
export const COLORS = { tc: 'var(--tc)', bc: 'var(--bc)', nn: 'var(--nn)' }

export const money = (n) =>
  (n < 0 ? '-$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })

export const hrs = (n) => Number(n || 0).toFixed(1) + 'h'
