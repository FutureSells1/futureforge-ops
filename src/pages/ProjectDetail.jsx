import React, { useEffect, useState } from 'react'
import { Link, useParams, useOutletContext } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'
import { ACCOUNTS, COLORS, money, hrs } from '../lib/format.js'

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}
function fmtWeek(ws) {
  const a = new Date(ws + 'T00:00:00Z')
  const b = new Date(a); b.setUTCDate(a.getUTCDate() + 6)
  const f = (x) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return f(a) + ' – ' + f(b) + ', ' + a.getUTCFullYear()
}

export default function ProjectDetail() {
  const { id } = useParams()
  const { isAdmin } = useOutletContext()
  const [proj, setProj] = useState(null)
  const [entries, setEntries] = useState(null)
  const [weekRev, setWeekRev] = useState({}) // week_start -> revenue
  const [err, setErr] = useState('')

  function loadProj() {
    supabase.from('project_profitability').select('*').eq('id', id).single()
      .then(({ data, error }) => { if (error) setErr(error.message); else setProj(data) })
  }
  useEffect(() => {
    if (!configured) return
    loadProj()
    supabase.from('hours_entries')
      .select('id, work_date, hours, raw_key, devs(name, hourly_cost)')
      .eq('project_id', id)
      .order('work_date', { ascending: false })
      .then(({ data, error }) => { if (error) setErr(error.message); else setEntries(data) })
    supabase.from('project_week_revenue').select('week_start, revenue').eq('project_id', id)
      .then(({ data }) => {
        const m = {}; (data || []).forEach((r) => { m[r.week_start] = Number(r.revenue) })
        setWeekRev(m)
      })
  }, [id])

  async function saveWeekRevenue(ws, value) {
    const revenue = Number(value) || 0
    const { error } = await supabase.from('project_week_revenue')
      .upsert({ project_id: id, week_start: ws, revenue }, { onConflict: 'project_id,week_start' })
    if (error) { setErr(error.message); return }
    setWeekRev((m) => ({ ...m, [ws]: revenue }))
    loadProj() // refresh totals/margin
  }

  if (!configured) return <div className="notice">Connect Supabase first — see the README.</div>
  if (err) return <div className="notice warn">{err}</div>
  if (!proj || !entries) return <div className="muted">Loading…</div>

  const margin = Number(proj.margin)

  // per-dev aggregation
  const byDev = {}
  entries.forEach((e) => {
    const name = e.devs?.name || '?'
    byDev[name] = byDev[name] || { hours: 0, cost: 0 }
    byDev[name].hours += Number(e.hours)
    byDev[name].cost += Number(e.hours) * Number(e.devs?.hourly_cost || 0)
  })
  const devRows = Object.entries(byDev).sort((a, b) => b[1].hours - a[1].hours)

  // per-week aggregation (entries + any revenue-only weeks)
  const byWeek = {}
  entries.forEach((e) => {
    const ws = weekStart(e.work_date)
    byWeek[ws] = byWeek[ws] || { hours: 0, cost: 0, entries: [] }
    byWeek[ws].hours += Number(e.hours)
    byWeek[ws].cost += Number(e.hours) * Number(e.devs?.hourly_cost || 0)
    byWeek[ws].entries.push(e)
  })
  Object.keys(weekRev).forEach((ws) => { byWeek[ws] = byWeek[ws] || { hours: 0, cost: 0, entries: [] } })
  const weeks = Object.keys(byWeek).sort().reverse()

  return (
    <>
      <Link to="/" className="backlink">← all projects</Link>
      <div className="pagehead">
        <h1 className="mono" style={{ fontSize: 19 }}>{proj.channel}</h1>
        <span className="pill"><span className="swatch" style={{ background: COLORS[proj.account] }} />{ACCOUNTS[proj.account]}</span>
        {proj.display_name && <span className="sub">{proj.display_name}</span>}
        {proj.client_name && <span className="sub">· {proj.client_name}</span>}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <Stat label="Total hours" value={hrs(proj.total_hours)} />
        {isAdmin && <>
          <Stat label="Cost (hours × rates)" value={money(proj.total_cost)} />
          <Stat label="Revenue (quoted + weekly)" value={money(proj.total_revenue)} />
          <Stat label="Margin" value={money(margin)} tone={margin >= 0 ? 'pos' : 'neg'} />
        </>}
      </div>

      {entries.length === 0 && weeks.length === 0 ? (
        <div className="notice">No hours logged against this project yet. They'll appear here as devs log time with channel <span className="mono">{proj.channel}</span>.</div>
      ) : (
        <div className="cols" style={{ gridTemplateColumns: '1fr 360px' }}>
          <div>
            <div className="paneltitle" style={{ marginTop: 4 }}>Weekly detail</div>
            {weeks.map((ws) => {
              const w = byWeek[ws]
              return (
                <div className="weekblock" key={ws}>
                  <div className="weekhead">
                    {fmtWeek(ws)}
                    <span className="tot mono">{hrs(w.hours)}{isAdmin ? ' · ' + money(w.cost) : ''}</span>
                  </div>
                  {w.entries.length > 0 && (
                    <table className="data">
                      <tbody>
                        {w.entries.map((e) => (
                          <tr key={e.id}>
                            <td className="mono" style={{ width: 110 }}>{e.work_date}</td>
                            <td>{e.devs?.name}</td>
                            <td className="num" style={{ width: 80 }}>{hrs(e.hours)}</td>
                            {isAdmin && <td className="num" style={{ width: 90 }}>{money(Number(e.hours) * Number(e.devs?.hourly_cost || 0))}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="paneltitle">By week</div>
              <table className="data">
                <thead><tr>
                  <th>Week of</th><th className="num">Hours</th>
                  {isAdmin && <><th className="num">Cost</th><th className="num">Revenue</th><th className="num">Margin</th></>}
                </tr></thead>
                <tbody>
                  {weeks.map((ws) => {
                    const w = byWeek[ws]
                    const rev = weekRev[ws] ?? 0
                    const wMargin = rev - w.cost
                    return (
                      <tr key={ws}>
                        <td className="mono" style={{ fontSize: 12 }}>{ws}</td>
                        <td className="num">{hrs(w.hours)}</td>
                        {isAdmin && <>
                          <td className="num">{money(w.cost)}</td>
                          <td className="num">
                            <WeekRevenueInput value={rev} onSave={(v) => saveWeekRevenue(ws, v)} />
                          </td>
                          <td className={'num ' + (wMargin >= 0 ? 'pos' : 'neg')}>{rev > 0 ? money(wMargin) : '—'}</td>
                        </>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {isAdmin && <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                Revenue is editable — type and click away to save. Weekly revenue adds to the project's quoted revenue in all totals.
              </div>}
            </div>
            <div className="card">
              <div className="paneltitle">By developer</div>
              <table className="data">
                <thead><tr><th>Dev</th><th className="num">Hours</th>{isAdmin && <th className="num">Cost</th>}<th className="num">%</th></tr></thead>
                <tbody>
                  {devRows.map(([name, v]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{hrs(v.hours)}</td>
                      {isAdmin && <td className="num">{money(v.cost)}</td>}
                      <td className="num">{proj.total_hours > 0 ? Math.round(v.hours / proj.total_hours * 100) + '%' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function WeekRevenueInput({ value, onSave }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input type="number" className="mono" value={v} min="0" step="50"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (Number(v) !== Number(value)) onSave(v) }}
      style={{ background: 'transparent', border: '1px solid var(--line2)', padding: '2px 6px', width: 86, textAlign: 'right', fontSize: 12 }}
    />
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="card" style={{ minWidth: 160, flex: 1 }}>
      <div className="muted" style={{ fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div className={'mono ' + (tone || '')} style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>{value}</div>
    </div>
  )
}
