import React, { useEffect, useMemo, useState } from 'react'
import { supabase, configured } from '../lib/supabase.js'
import { hrs, money, DOW } from '../lib/format.js'

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
  const [projects, setProjects] = useState(null)
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
    supabase.from('devs').select('id, name, active, hourly_cost').order('name')
      .then(({ data, error }) => { if (error) setErr(error.message); else setDevs((data || []).filter((d) => d.active !== false)) })
    supabase.from('projects').select('id, channel, display_name, account')
      .then(({ data, error }) => { if (error) setErr(error.message); else setProjects(data || []) })
    // paginate: Supabase caps each query at 1000 rows — one query
    // truncated silently and dropped whole devs from the grid
    ;(async () => {
      const PAGE = 1000
      let all = [], from = 0
      for (;;) {
        const { data, error } = await supabase.from('hours_entries')
          .select('dev_id, work_date, hours, raw_key, is_overhead, is_pm, project_id')
          .gte('work_date', mondays[0]).lte('work_date', addDays(mondays[mondays.length - 1], 6))
          .order('id')
          .range(from, from + PAGE - 1)
        if (error) { setErr(error.message); return }
        all = all.concat(data || [])
        if (!data || data.length < PAGE) break
        from += PAGE
      }
      setEntries(all)
    })()
  }, [])

  if (!configured) return <div className="notice">Connect Supabase first — see the README.</div>
  if (err) return <div className="notice warn">{err}</div>
  if (!devs || !entries || !projects) return <div className="muted">Loading…</div>

  const isUnassigned = (e) => e.is_overhead && String(e.raw_key).startsWith('unassigned')

  // ---- ops layer: category + cost per entry ----
  const devCost = Object.fromEntries(devs.map((d) => [d.id, Number(d.hourly_cost) || 0]))
  const projMap = new Map(projects.map((p) => [String(p.id), p]))
  // billable = project work · pm = project management (internal) ·
  // unassigned = idle cost · other = prospect / on-leave / unmatched
  const catOf = (e) => isUnassigned(e) ? 'u' : e.is_overhead ? 'o' : e.is_pm ? 'p' : e.project_id != null ? 'b' : 'o'
  const costOf = (e) => Number(e.hours) * (devCost[e.dev_id] || 0)

  // ---- weekly team mix trend (all 8 weeks) ----
  const trendMix = Object.fromEntries(mondays.map((m) => [m, { b: 0, p: 0, o: 0, u: 0, cost: 0, ohCost: 0 }]))
  entries.forEach((e) => {
    const ws = iso(mondayOf(new Date(e.work_date + 'T00:00:00Z')))
    const t = trendMix[ws]; if (!t) return
    const c = catOf(e)
    t[c] += Number(e.hours)
    t.cost += costOf(e)
    if (c === 'u' || c === 'o') t.ohCost += costOf(e)
  })
  const trendMax = Math.max(1, ...Object.values(trendMix).map((t) => t.b + t.p + t.o + t.u))

  // ---- selected week slices ----
  const weekDays = [...Array(7)].map((_, i) => addDays(selWeek, i))
  const weekEnd = weekDays[6]
  const inWeek = entries.filter((e) => e.work_date >= selWeek && e.work_date <= weekEnd)

  const perDev = {}
  devs.forEach((d) => { perDev[d.id] = { name: d.name, unassigned: 0, overheadOther: {}, daily: {}, dailyUn: {}, cat: { b: 0, p: 0, o: 0, u: 0 }, cost: 0, ohCost: 0, uCost: 0 } })
  const acctCost = { tc: 0, bc: 0, nn: 0, overhead: 0 }
  const projAgg = {}
  inWeek.forEach((e) => {
    const p = perDev[e.dev_id]; if (!p) return
    const c = catOf(e), $ = costOf(e)
    p.daily[e.work_date] = (p.daily[e.work_date] || 0) + Number(e.hours)
    p.cat[c] += Number(e.hours)
    p.cost += $
    if (c === 'u' || c === 'o') p.ohCost += $
    if (c === 'u') p.uCost += $
    if (isUnassigned(e)) {
      p.unassigned += Number(e.hours)
      p.dailyUn[e.work_date] = (p.dailyUn[e.work_date] || 0) + Number(e.hours)
    }
    else if (e.is_overhead) {
      const k = String(e.raw_key)
      p.overheadOther[k] = (p.overheadOther[k] || 0) + Number(e.hours)
    }
    // where the money went
    if (e.project_id != null && !e.is_overhead) {
      const pr = projMap.get(String(e.project_id))
      if (pr) {
        acctCost[pr.account] = (acctCost[pr.account] || 0) + $
        const k = String(e.project_id)
        projAgg[k] = projAgg[k] || { name: pr.display_name || pr.channel, hours: 0, cost: 0 }
        projAgg[k].hours += Number(e.hours); projAgg[k].cost += $
      } else acctCost.overhead += $
    } else acctCost.overhead += $
  })
  const topProjects = Object.values(projAgg).sort((a, b) => b.hours - a.hours).slice(0, 6)
  const projBarMax = Math.max(1, ...topProjects.map((r) => r.hours))
  const acctMax = Math.max(1, ...Object.values(acctCost))

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
  const barMax = Math.max(1, ...rows.map((r) => (r.cat.b + r.cat.p + r.cat.o + r.cat.u)))

  // week-level ops numbers
  const wk = rows.reduce((a, r) => ({
    b: a.b + r.cat.b, p: a.p + r.cat.p, o: a.o + r.cat.o, u: a.u + r.cat.u,
    cost: a.cost + r.cost, ohCost: a.ohCost + r.ohCost,
  }), { b: 0, p: 0, o: 0, u: 0, cost: 0, ohCost: 0 })
  const wkTotal = wk.b + wk.p + wk.o + wk.u
  const util = wkTotal > 0 ? wk.b / wkTotal * 100 : 0
  const unassignedCost = rows.reduce((a, r) => a + r.uCost, 0)

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

      <div className="statrow" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <Card label="Utilization" value={util.toFixed(0) + '%'} tone={util >= 75 ? 'pos' : util >= 55 ? '' : 'neg'} sub={hrs(wk.b) + ' billable of ' + hrs(wkTotal)} />
        <Card label="Team cost this week" value={money(wk.cost)} sub={money(wk.cost - wk.ohCost) + ' on projects'} />
        <Card label="Unassigned cost" value={money(unassignedCost)} tone={unassignedCost > 0 ? 'neg' : 'pos'} sub={hrs(totalUnassigned) + ' idle'} />
        <Card label="Overhead cost" value={money(wk.ohCost)} sub={hrs(wk.o + wk.u) + ' non-project'} />
        <Card label="PM hours" value={hrs(wk.p)} sub="internal, not billed" />
        <Card label="Under-8h flags" value={totalFlags} tone={totalFlags > 0 ? 'neg' : 'pos'} sub={totalFlags > 0 ? 'needs follow-up' : 'all compliant'} />
      </div>

      <div className="teamgrid2">
        {/* utilization by dev — stacked time mix */}
        <div className="card">
          <div className="paneltitle">Time mix by dev — {fmtWeek(selWeek)}</div>
          {[...rows].filter((r) => r.cat.b + r.cat.p + r.cat.o + r.cat.u > 0)
            .sort((a, b) => (a.cat.b / Math.max(0.1, a.cat.b + a.cat.p + a.cat.o + a.cat.u)) - (b.cat.b / Math.max(0.1, b.cat.b + b.cat.p + b.cat.o + b.cat.u)))
            .map((r) => {
              const tot = r.cat.b + r.cat.p + r.cat.o + r.cat.u
              const u = tot > 0 ? r.cat.b / tot * 100 : 0
              return (
                <div className="hbar" key={r.name} title={r.name + ' — billable ' + hrs(r.cat.b) + ' · PM ' + hrs(r.cat.p) + ' · other ' + hrs(r.cat.o) + ' · unassigned ' + hrs(r.cat.u) + ' · cost ' + money(r.cost)}>
                  <span className="hbar-name">{r.name}</span>
                  <span className="hbar-track mix" style={{ width: (tot / barMax * 100) + '%', minWidth: 40 }}>
                    {r.cat.b > 0 && <span className="seg seg-b" style={{ width: (r.cat.b / tot * 100) + '%' }} />}
                    {r.cat.p > 0 && <span className="seg seg-p" style={{ width: (r.cat.p / tot * 100) + '%' }} />}
                    {r.cat.o > 0 && <span className="seg seg-o" style={{ width: (r.cat.o / tot * 100) + '%' }} />}
                    {r.cat.u > 0 && <span className="seg seg-u" style={{ width: (r.cat.u / tot * 100) + '%' }} />}
                  </span>
                  <span className="hbar-val mono">{u.toFixed(0)}%</span>
                </div>
              )
            })}
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            <span className="seg-dot seg-b" /> billable <span className="seg-dot seg-p" /> PM <span className="seg-dot seg-o" /> other overhead <span className="seg-dot seg-u" /> unassigned
            — % = billable share (utilization) · sorted worst-first · hover for the breakdown &amp; cost
          </div>
        </div>

        {/* 8-week hours mix trend */}
        <div className="card">
          <div className="paneltitle">Team hours mix — last {WEEKS_SHOWN} weeks</div>
          <div className="trend">
            {mondays.map((m) => {
              const t = trendMix[m]
              const tot = t.b + t.p + t.o + t.u
              const px = (v) => Math.max(v > 0 ? 2 : 0, v / trendMax * 90)
              const u = tot > 0 ? Math.round(t.b / tot * 100) : 0
              return (
                <div className="trend-col" key={m} onClick={() => setSelWeek(m)}
                  title={fmtWeek(m) + ' — ' + hrs(tot) + ' total · ' + u + '% utilization · cost ' + money(t.cost) + ' (overhead ' + money(t.ohCost) + ')'}>
                  <div className="trend-val mono">{tot > 0 ? u + '%' : ''}</div>
                  <div className={'trend-stack' + (m === selWeek ? ' sel' : '')}>
                    <div className="seg-u" style={{ height: px(t.u) }} />
                    <div className="seg-o" style={{ height: px(t.o) }} />
                    <div className="seg-p" style={{ height: px(t.p) }} />
                    <div className="seg-b" style={{ height: px(t.b) }} />
                  </div>
                  <div className="trend-lbl">{m.slice(5).replace('-', '/')}</div>
                </div>
              )
            })}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>% = utilization that week · click a bar to jump · hover for cost</div>
        </div>
      </div>

      <div className="teamgrid2" style={{ marginTop: 16 }}>
        {/* cost by account */}
        <div className="card">
          <div className="paneltitle">Cost by account — {fmtWeek(selWeek)}</div>
          {[['tc', 'Thiago'], ['bc', 'Bernardo'], ['nn', 'Nick'], ['overhead', 'Overhead']].map(([k, label]) => (
            <div className="hbar" key={k}>
              <span className="hbar-name">{label}</span>
              <span className="hbar-track">
                <span className={'hbar-fill' + (k === 'overhead' ? ' oh' : ' acct-' + k)} style={{ width: (acctCost[k] / acctMax * 100) + '%' }} />
              </span>
              <span className="hbar-val mono">{money(acctCost[k] || 0)}</span>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>dev cost of hours worked, grouped by the project's Upwork account · overhead = unassigned, prospect, on-leave, unmatched</div>
        </div>

        {/* top projects by hours */}
        <div className="card">
          <div className="paneltitle">Top projects this week</div>
          {topProjects.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No project hours this week yet.</div>}
          {topProjects.map((r) => (
            <div className="hbar" key={r.name}>
              <span className="hbar-name" title={r.name}>{r.name}</span>
              <span className="hbar-track"><span className="hbar-fill" style={{ width: (r.hours / projBarMax * 100) + '%' }} /></span>
              <span className="hbar-val mono">{hrs(r.hours)} · {money(r.cost)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* compliance grid */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="paneltitle">Daily 8h check — every dev should log ≥ {DAILY_MIN}h per weekday (any type counts, unassigned included)</div>
        <div className="scrollx"><table className="data compliance sticky1">
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
        </table></div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          <span className="cell-ok legend">≥{DAILY_MIN}h</span> <span className="cell-bad legend">&lt;{DAILY_MIN}h on a past weekday</span> <span className="cell-wk legend">weekend hours (not flagged)</span> <span className="cell-na legend">today / future</span>
          — flags only apply to weekdays that have already passed.
        </div>
      </div>

      {/* unassigned-only grid */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="paneltitle">Unassigned hours by day — {fmtWeek(selWeek)}</div>
        <div className="scrollx"><table className="data compliance sticky1">
          <thead><tr>
            <th>Dev</th>
            {DOW.map((d) => <th className="num" key={d}>{d}</th>)}
            <th className="num">Week</th>
          </tr></thead>
          <tbody>
            {[...rows].sort((a, b) => b.unassigned - a.unassigned).map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                {weekDays.map((ds, i) => {
                  const u = r.dailyUn[ds] || 0
                  return <td className={'num ' + (u > 0 ? 'cell-un' : 'cell-na')} key={i}>{u > 0 ? Number(u.toFixed(1)) : ''}</td>
                })}
                <td className={'num mono ' + (r.unassigned > 0 ? 'cell-un' : '')}>{r.unassigned > 0 ? hrs(r.unassigned) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          only hours logged as <span className="mono">unassigned</span> — sorted by weekly total.
        </div>
      </div>
    </>
  )
}

function Card({ label, value, tone, small, sub }) {
  return (
    <div className="card" style={{ minWidth: 150, flex: 1 }}>
      <div className="muted" style={{ fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div className={'mono ' + (tone || '')} style={{ fontSize: small ? 16 : 22, fontWeight: 500, marginTop: 4 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}
