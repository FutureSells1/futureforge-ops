import React, { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'
import { ACCOUNTS, COLORS, money, hrs } from '../lib/format.js'

export default function Dashboard() {
  const { isAdmin } = useOutletContext()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!configured) return
    supabase.from('project_profitability').select('*')
      .order('total_hours', { ascending: false })
      .then(({ data, error }) => { if (error) setErr(error.message); else setRows(data) })
  }, [])

  if (!configured) return (
    <>
      <Head />
      <div className="notice">
        No database connected yet — fill in <code>.env</code> per the README.
      </div>
    </>
  )
  if (err) return (<><Head /><div className="notice warn">Couldn't load data: {err}</div></>)
  if (!rows) return (<><Head /><div className="muted">Loading…</div></>)

  const needle = q.trim().toLowerCase()
  const shown = rows.filter((r) =>
    !needle ||
    r.channel.includes(needle) ||
    (r.client_name || '').toLowerCase().includes(needle) ||
    (r.display_name || '').toLowerCase().includes(needle)
  )

  return (
    <>
      <Head />
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="searchbox" placeholder="search channel, client, name…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted" style={{ fontSize: 12 }}>{shown.length} project{shown.length === 1 ? '' : 's'} · click a row for the full breakdown</span>
        </div>
        {shown.length === 0 ? (
          <div className="notice">No projects match "{q}".</div>
        ) : (
          <table className="data">
            <thead><tr>
              <th>Channel</th><th>Account</th><th>Client</th>
              <th className="num">Hours</th>
              {isAdmin && <><th className="num">Cost</th><th className="num">Revenue</th><th className="num">Margin</th></>}
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="click" onClick={() => navigate('/projects/' + r.id)}>
                  <td className="mono">{r.channel}</td>
                  <td><span className="pill"><span className="swatch" style={{ background: COLORS[r.account] }} />{ACCOUNTS[r.account] || r.account}</span></td>
                  <td>{r.client_name || '—'}</td>
                  <td className="num">{hrs(r.total_hours)}</td>
                  {isAdmin && <>
                    <td className="num">{money(r.total_cost)}</td>
                    <td className="num">{money(r.total_revenue)}</td>
                    <td className={'num ' + (Number(r.margin) >= 0 ? 'pos' : 'neg')}>{money(r.margin)}</td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function Head() {
  return (
    <div className="pagehead">
      <h1>Dashboard</h1>
      <span className="sub">every project · click through for detail</span>
    </div>
  )
}
