import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'
import { ACCOUNTS, COLORS, money, hrs } from '../lib/format.js'

// Monday (ISO week start) for a yyyy-mm-dd string
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
  const [proj, setProj] = useState(null)
  const [entries, setEntries] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!configured) return
    supabase.from('project_profitability').select('*').eq('id', id).single()
      .then(({ data, error }) => { if (error) setErr(error.message); else setProj(data) })
    supabase.from('hours_entries')
      .select('id, work_date, hours, raw_key, devs(name, hourly_cost)')
      .eq('project_id', id)
      .order('work_date', { ascending: false })
      .then(({ data, error }) => { if (error) setErr(error.message); else setEntries(data) })
  }, [id])

  if (!configured) return <div className="notice">Connect Supabase first — see the README.</div>
  if (err) return <div className="notice warn">{err}</div>
  if (!proj || !entries) return <div className="muted">Loading…</div>

  const margin = Number(proj.margin)

  // per-dev aggregation
  const byDev = {}
  entries.forEach((e) => {
    const name = e.devs?.name || '?'
    const cost = Number(e.hours) * Number(e.devs?.hourly_cost || 0)
    byDev[name] = byDev[name] || { hours: 0, cost: 0 }
    byDev[name].hours += Number(e.hours)
    byDev[name].cost += cost
  })
  const devRows = Object.entries(byDev).sort((a, b) => b[1].hours - a[1].hours)

  // per-week grouping (desc), entries inside
  const byWeek = {}
  entries.forEach((e) => {
    const ws = weekStart(e.work_date)
    byWeek[ws] = byWeek[ws] || []
    byWeek[ws].push(e)
  })
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
        <Stat label="Cost (hours × rates)" value={money(proj.total_cost)} />
        <Stat label="Quoted revenue" value={money(proj.quoted_revenue)} />
        <Stat label="Margin" value={money(margin)} tone={margin >= 0 ? 'pos' : 'neg'} />
      </div>

      {entries.length === 0 ? (
        <div className="notice">No hours logged against this project yet. They'll appear here as devs log time with channel <span className="mono">{proj.channel}</span>.</div>
      ) : (
        <div className="cols" style={{ gridTemplateColumns: '1fr 320px' }}>
          <div>
            <div className="paneltitle" style={{ marginTop: 4 }}>Weekly breakdown</div>
            {weeks.map((ws) => {
              const list = byWeek[ws]
              const tot = list.reduce((a, e) => a + Number(e.hours), 0)
              const cost = list.reduce((a, e) => a + Number(e.hours) * Number(e.devs?.hourly_cost || 0), 0)
              return (
                <div className="weekblock" key={ws}>
                  <div className="weekhead">
                    {fmtWeek(ws)}
                    <span className="tot mono">{hrs(tot)} · {money(cost)}</span>
                  </div>
                  <table className="data">
                    <tbody>
                      {list.map((e) => (
                        <tr key={e.id}>
                          <td className="mono" style={{ width: 110 }}>{e.work_date}</td>
                          <td>{e.devs?.name}</td>
                          <td className="num" style={{ width: 80 }}>{hrs(e.hours)}</td>
                          <td className="num" style={{ width: 90 }}>{money(Number(e.hours) * Number(e.devs?.hourly_cost || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
          <div>
            <div className="card">
              <div className="paneltitle">By developer</div>
              <table className="data">
                <thead><tr><th>Dev</th><th className="num">Hours</th><th className="num">Cost</th><th className="num">%</th></tr></thead>
                <tbody>
                  {devRows.map(([name, v]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{hrs(v.hours)}</td>
                      <td className="num">{money(v.cost)}</td>
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

function Stat({ label, value, tone }) {
  return (
    <div className="card" style={{ minWidth: 160, flex: 1 }}>
      <div className="muted" style={{ fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div className={'mono ' + (tone || '')} style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>{value}</div>
    </div>
  )
}
