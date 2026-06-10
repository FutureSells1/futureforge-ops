import React, { useEffect, useState } from 'react'
import { supabase, configured } from '../lib/supabase.js'
import { ACCOUNTS, COLORS, money, hrs } from '../lib/format.js'

export default function Dashboard() {
  const [rows, setRows] = useState(null)
  const [unmatched, setUnmatched] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!configured) return
    supabase.from('project_profitability').select('*').order('margin', { ascending: true })
      .then(({ data, error }) => { if (error) setErr(error.message); else setRows(data) })
    supabase.from('unmatched_hours').select('*').limit(50)
      .then(({ data }) => setUnmatched(data || []))
  }, [])

  if (!configured) return (
    <>
      <PageHead />
      <div className="notice">
        No database connected yet. Create a Supabase project, run <code>supabase/schema.sql</code> in
        its SQL editor, then copy <code>.env.example</code> to <code>.env</code> and fill in your
        project URL and anon key. The README has the full walkthrough.
      </div>
    </>
  )

  if (err) return (<><PageHead /><div className="notice warn">Couldn't load data: {err}</div></>)
  if (!rows) return (<><PageHead /><div className="muted">Loading…</div></>)

  const totals = rows.reduce((a, r) => ({
    hours: a.hours + Number(r.total_hours),
    cost: a.cost + Number(r.total_cost),
    rev: a.rev + Number(r.quoted_revenue),
  }), { hours: 0, cost: 0, rev: 0 })

  return (
    <>
      <PageHead />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <Stat label="Quoted revenue" value={money(totals.rev)} />
        <Stat label="Cost (hours × rates)" value={money(totals.cost)} />
        <Stat label="Margin" value={money(totals.rev - totals.cost)} tone={totals.rev - totals.cost >= 0 ? 'pos' : 'neg'} />
        <Stat label="Total hours" value={hrs(totals.hours)} />
      </div>

      <div className="card">
        <div className="paneltitle">Project profitability</div>
        {rows.length === 0 ? (
          <div className="notice">
            No projects yet. They arrive automatically when the Zapier zap inserts new Slack
            channels, or add one manually on the Projects page.
          </div>
        ) : (
          <table className="data">
            <thead><tr>
              <th>Channel</th><th>Account</th><th>Client</th>
              <th className="num">Hours</th><th className="num">Cost</th>
              <th className="num">Quoted</th><th className="num">Margin</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.channel}</td>
                  <td><span className="pill"><span className="swatch" style={{ background: COLORS[r.account] }} />{ACCOUNTS[r.account] || r.account}</span></td>
                  <td>{r.client_name || '—'}</td>
                  <td className="num">{hrs(r.total_hours)}</td>
                  <td className="num">{money(r.total_cost)}</td>
                  <td className="num">{money(r.quoted_revenue)}</td>
                  <td className={'num ' + (Number(r.margin) >= 0 ? 'pos' : 'neg')}>{money(r.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {unmatched.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="paneltitle"><span className="swatch" style={{ background: 'var(--warnc)' }} />Unmatched hours — fix these so costs stay accurate</div>
          <table className="data">
            <thead><tr><th>Dev</th><th>Key from sheet</th><th>Date</th><th className="num">Hours</th></tr></thead>
            <tbody>
              {unmatched.map((u) => (
                <tr key={u.id}>
                  <td>{u.dev}</td>
                  <td className="mono">{u.raw_key}</td>
                  <td className="mono">{u.work_date}</td>
                  <td className="num">{hrs(u.hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function PageHead() {
  return (
    <div className="pagehead">
      <h1>Dashboard</h1>
      <span className="sub">hours in, money out — per project, across all three accounts</span>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="card" style={{ minWidth: 170, flex: 1 }}>
      <div className="muted" style={{ fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div className={'mono ' + (tone || '')} style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>{value}</div>
    </div>
  )
}
