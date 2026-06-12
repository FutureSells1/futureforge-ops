import React, { useEffect, useMemo, useState } from 'react'
import { supabase, configured } from '../lib/supabase.js'
import { hrs, DOW } from '../lib/format.js'

const WEEKS_SHOWN = 8
const DAILY_MIN = 8

function mondayOf(d) {
  const x = new Date(d); x.setUTCHours(0, 0, 0, 0)
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
  return x
}
const iso = (d) => d.toISOString().slice(0, 10)
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d)
}
function fmtWeek(ws) {
  const a = new Date(ws + 'T00:00:00Z'); const b = new Date(a); b.setUTCDate(a.getUTCDate() + 6)
  const f = (x) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return f(a) + ' – ' + f(b)
}

export default function Team() {
  const [devs, setDevs] = useState(null)
  const [entries, setEntries] = useState(null)
  const [err, setErr] = useState('')

  const mondays = useMemo(() => {
    const cur = mondayOf(new Date()); const out = []
    for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
      const d = new Date(cur); d.setUTCDate(cur.getUTCDate() - i * 7); out.push(iso(d))
    }
    return out
  }, [])
  const [selWeek, setSelWeek] = useState(mondays[mondays.length - 1])
  const todayStr = iso(new Date())

  useEffect(() => {
    if (!configured) return
    supabase.from('devs').select('id, name, active').order('name')
      .then(({ data, error }) => { if (error) setErr(error.message); else setDevs((data || []).filter((d) => d.active !== false)) })
    supabase.from('hours_entries')
      .select('dev_id, work_date, hours, raw_key, is_overhead')
      .gte('work_date', mondays[0]).lte('work_date', addDays(mondays[mondays.length - 1], 6))
      .then(({ data, error }) => { if (error) setErr(error.message); else setEntries(data || []) })
  }, [])

  if (!configured) return <div className="notice">Connect Supabase first — see the README.</div>
  if (err) return <div className="notice warn">{err}</div>
  if (!devs || !entries) return <div className="muted">Loading…</div>

  const isUnassigned = (e) => e.is_overhead && String(e.raw_key).startsWith('unassigned')

  // ---- weekly team unassigned trend (all 8 weeks) ----
  const trendByWeek = Object.fromEntries(mondays.map((m) => [m, 0]))
  entries.forEach((e) => {
    if (!isUnassigned(e)) return
    const ws = iso(mondayOf(new Date(e.work_date + 'T00:00:00Z')))
    if (ws in trendByWeek) trendByWeek[ws] += Number(e.hours)
  })
  const trendMax = Math.max(1, ...Object.values(trendByWeek))

  // ---- selected week slices ----
  const weekDays = [...Array(7)].map((_, i) => addDays(selWeek, i))
  const weekEnd = weekDays[6]
  const inWeek = entries.filter((e) => e.work_date >= selWeek && e.work_date <= weekEnd)

  const perDev = {}
  devs.forEach((d) => { perDev[d.id] = { name: d.name, unassigned: 0, overheadOther: {}, daily: {} } })
  inWeek.forEach((e) => {
    const p = perDev[e.dev_id]; if (!p) return
    p.daily[e.work_date] = (p.daily[e.work_date] || 0) + Number(e.hours)
    if (isUnassigned(e)) p.unassigned += Number(e.hours)
    else if (e.is_overhead) {
      const k = String(e.raw_key)
      p.overheadOther[k] = (p.overheadOther[k] || 0) + Number(e.hours)
    }
  })

  // ---- 8h/day compliance: weekdays in the past (not today, not future) ----
  function dayStatus(p, dateStr, idx) {
    const isWeekday = idx < 5
    const total = p.daily[dateStr] || 0
    if (dateStr >= todayStr) return { cls: 'na', total, label: dateStr === todayStr ? '·' : '' }
    if (!isWeekday) return { cls: total > 0 ? 'wk' : 'na', total }
    return total + 0.001 >= DAILY_MIN ? { cls: 'ok', total } : { cls: 'bad', total }
  }
  const rows = devs.map((d) => {
    const p = perDev[d.id]
    const days = weekDays.map((ds, i) => dayStatus(p, ds, i))
    const flags = days.filter((x) => x.cls === 'bad').length
    const total = weekDays.reduce((a, ds) => a + (p.daily[ds] || 0), 0)
    return { ...p, days, flags, total }
  }).sort((a, b) => b.flags - a.flags || b.unassigned - a.unassigned)

  const totalUnassigned = rows.reduce((a, r) => a + r.unassigned, 0)
  const totalFlags = rows.reduce((a, r) => a + r.flags, 0)
  const topDev = [...rows].sort((a, b) => b.unassigned - a.unassigned)[0]
  const barMax = Math.max(1, ...rows.map((r) => r.unassigned))

  return (
    <>
      <div className="pagehead">
        <h1>Team</h1>
        <span className="sub">unassigned hours & the 8h/day rule</span>
      </div>

      {/* week picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button className="ghost" disabled={selWeek === mondays[0]}
          onClick={() => setSelWeek(mondays[Math.max(0, mondays.indexOf(selWeek) - 1)])}>←</button>
        <span className="mono" style={{ fontSize: 14, minWidth: 130, textAlign: 'center' }}>{fmtWeek(selWeek)}</span>
        <button className="ghost" disabled={selWeek === mondays[mondays.length - 1]}
          onClick={() => setSelWeek(mondays[Math.min(mondays.length - 1, mondays.indexOf(selWeek) + 1)])}>→</button>
        {selWeek === mondays[mondays.length - 1] && <span className="typepill">current week</span>}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <Card label="Unassigned this week" value={hrs(totalUnassigned)} />
        <Card label="Most unassigned" value={topDev && topDev.unassigned > 0 ? topDev.name + ' · ' + hrs(topDev.unassigned) : '—'} small />
        <Card label="Under-8h flags" value={totalFlags} tone={totalFlags > 0 ? 'neg' : 'pos'} />
      </div>

      <div className="teamgrid2">
        {/* unassigned by dev */}
        <div className="card">
          <div className="paneltitle">Unassigned hours by dev — {fmtWeek(selWeek)}</div>
          {rows.every((r) => r.unassigned === 0) && <div className="muted" style={{ fontSize: 12.5 }}>No unassigned hours this week.</div>}
          {rows.filter((r) => r.unassigned > 0).sort((a, b) => b.unassigned - a.unassigned).map((r) => (
            <div className="hbar" key={r.name}>
              <span className="hbar-name">{r.name}</span>
              <span className="hbar-track"><span className="hbar-fill" style={{ width: (r.unassigned / barMax * 100) + '%' }} /></span>
              <span className="hbar-val mono">{hrs(r.unassigned)}</span>
            </div>
          ))}
        </div>

        {/* 8-week trend */}
        <div className="card">
          <div className="paneltitle">Team unassigned — last {WEEKS_SHOWN} weeks</div>
          <div className="trend">
            {mondays.map((m) => (
              <div className="trend-col" key={m} onClick={() => setSelWeek(m)} title={fmtWeek(m) + ': ' + hrs(trendByWeek[m])}>
                <div className="trend-val mono">{trendByWeek[m] > 0 ? Math.round(trendByWeek[m]) : ''}</div>
                <div className={'trend-bar' + (m === selWeek ? ' sel' : '')}
                  style={{ height: Math.max(3, trendByWeek[m] / trendMax * 90) + 'px' }} />
                <div className="trend-lbl">{m.slice(5).replace('-', '/')}</div>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>click a bar to jump to that week</div>
        </div>
      </div>

      {/* compliance grid */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="paneltitle">Daily 8h check — every dev should log ≥ {DAILY_MIN}h per weekday (any type counts, unassigned included)</div>
        <table className="data compliance">
          <thead><tr>
            <th>Dev</th>
            {DOW.map((d) => <th className="num" key={d}>{d}</th>)}
            <th className="num">Week</th>
            <th className="num">Flags</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}{Object.keys(r.overheadOther).length > 0 &&
                  <div className="muted" style={{ fontSize: 10.5 }}>
                    {Object.entries(r.overheadOther).map(([k, v]) => hrs(v) + ' ' + k).join(' · ')}
                  </div>}
                </td>
                {r.days.map((d, i) => (
                  <td className={'num cell-' + d.cls} key={i}>
                    {d.cls === 'na' ? (d.label || '') : (d.total > 0 ? Number(d.total.toFixed(1)) : (d.cls === 'bad' ? '0' : ''))}
                  </td>
                ))}
                <td className="num mono">{hrs(r.total)}</td>
                <td className={'num ' + (r.flags > 0 ? 'neg' : 'pos')}>{r.flags > 0 ? '⚑ ' + r.flags : '✓'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          <span className="cell-ok legend">≥{DAILY_MIN}h</span> <span className="cell-bad legend">&lt;{DAILY_MIN}h on a past weekday</span> <span className="cell-wk legend">weekend hours (not flagged)</span> <span className="cell-na legend">today / future</span>
          — flags only apply to weekdays that have already passed.
        </div>
      </div>
    </>
  )
}

function Card({ label, value, tone, small }) {
  return (
    <div className="card" style={{ minWidth: 170, flex: 1 }}>
      <div className="muted" style={{ fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div className={'mono ' + (tone || '')} style={{ fontSize: small ? 16 : 22, fontWeight: 500, marginTop: 4 }}>{value}</div>
    </div>
  )
}
