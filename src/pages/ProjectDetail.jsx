import React, { useEffect, useState } from 'react'
import { Link, useParams, useOutletContext } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'
import { ACCOUNTS, COLORS, money, money2, hrs, net, dayName } from '../lib/format.js'

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
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
  const { isAdmin, session } = useOutletContext()
  const [proj, setProj] = useState(null)
  const [entries, setEntries] = useState(null)
  const [milestones, setMilestones] = useState([])
  const [weekRev, setWeekRev] = useState({})
  const [tab, setTab] = useState('breakdown')
  const [err, setErr] = useState('')

  function loadProj() {
    supabase.from('project_profitability').select('*').eq('id', id).single()
      .then(({ data, error }) => { if (error) setErr(error.message); else setProj(data) })
  }
  function loadWeekRev() {
    supabase.from('project_week_revenue').select('week_start, amount').eq('project_id', id)
      .then(({ data }) => {
        const m = {}; (data || []).forEach((r) => { m[r.week_start] = Number(r.amount) })
        setWeekRev(m)
      })
  }
  function loadMilestones() {
    supabase.from('project_milestones').select('*').eq('project_id', id)
      .order('position').order('id')
      .then(({ data }) => setMilestones(data || []))
  }
  useEffect(() => {
    if (!configured) return
    loadProj(); loadMilestones(); loadWeekRev()
    supabase.from('hours_entries')
      .select('id, work_date, hours, raw_key, devs(name, hourly_cost)')
      .eq('project_id', id)
      .order('work_date', { ascending: false })
      .then(({ data, error }) => { if (error) setErr(error.message); else setEntries(data) })
  }, [id])

  if (!configured) return <div className="notice">Connect Supabase first — see the README.</div>
  if (err) return <div className="notice warn">{err}</div>
  if (!proj || !entries) return <div className="muted">Loading…</div>

  const isHourly = proj.billing_type === 'hourly'
  const margin = Number(proj.margin)

  const byDev = {}
  entries.forEach((e) => {
    const name = e.devs?.name || '?'
    byDev[name] = byDev[name] || { hours: 0, cost: 0 }
    byDev[name].hours += Number(e.hours)
    byDev[name].cost += Number(e.hours) * Number(e.devs?.hourly_cost || 0)
  })
  const devRows = Object.entries(byDev).sort((a, b) => b[1].hours - a[1].hours)

  const byWeek = {}
  entries.forEach((e) => {
    const ws = weekStart(e.work_date)
    byWeek[ws] = byWeek[ws] || { hours: 0, cost: 0, entries: [] }
    byWeek[ws].hours += Number(e.hours)
    byWeek[ws].cost += Number(e.hours) * Number(e.devs?.hourly_cost || 0)
    byWeek[ws].entries.push(e)
  })
  const weeks = Object.keys(byWeek).sort().reverse()
  const allWeeks = [...new Set([...Object.keys(byWeek), ...Object.keys(weekRev)])].sort().reverse()

  async function saveWeekBilled(ws, amount) {
    await supabase.from('project_week_revenue').upsert(
      { project_id: Number(id), week_start: ws, amount: Number(amount) || 0 },
      { onConflict: 'project_id,week_start' })
    loadWeekRev(); loadProj()
  }

  return (
    <>
      <Link to="/" className="backlink">← all projects</Link>
      <div className="pagehead">
        <h1 className="mono" style={{ fontSize: 19 }}>{proj.channel}</h1>
        <span className="pill"><span className="swatch" style={{ background: COLORS[proj.account] }} />{ACCOUNTS[proj.account]}</span>
        <span className="typepill">{proj.billing_type}</span>
        {proj.display_name && <span className="sub">{proj.display_name}</span>}
        {proj.client_name && <span className="sub">· {proj.client_name}</span>}
      </div>

      <div className="statrow" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <Stat label="Total hours" value={hrs(proj.total_hours)} />
        {isAdmin && <>
          <Stat label="Cost (dev rates)" value={money(proj.total_cost)} />
          <Stat label={isHourly ? 'Billed · net of Upwork 10%' : 'Released · net of Upwork 10%'} value={money(proj.net_revenue)} />
          <Stat label="Margin" value={money(margin)} tone={margin >= 0 ? 'pos' : 'neg'} />
          {!isHourly && <Stat label="Remaining (gross)" value={money(proj.remaining_value)} />}
        </>}
      </div>

      {isAdmin && (
        <BillingPanel proj={proj} milestones={milestones}
          onChanged={() => { loadProj(); loadMilestones() }} />
      )}

      <div className="tabbar">
        <button className={tab === 'breakdown' ? 'on' : ''} onClick={() => setTab('breakdown')}>Breakdown</button>
        <button className={tab === 'estimation' ? 'on' : ''} onClick={() => setTab('estimation')}>Estimation</button>
      </div>

      {tab === 'breakdown' && (
        entries.length === 0 ? (
          <div className="notice">No hours logged against this project yet — they appear as devs log time with channel <span className="mono">{proj.channel}</span>.</div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="paneltitle">By developer</div>
              <div className="scrollx"><table className="data">
                <thead><tr><th>Dev</th><th className="num">Hours</th>{isAdmin && <th className="num">Cost</th>}<th className="num">% of project</th></tr></thead>
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
              </table></div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="paneltitle">Weekly totals</div>
              <div className="scrollx"><table className="data">
                <thead><tr>
                  <th>Week</th>
                  <th className="num">Hours</th>
                  {isAdmin && <>
                    <th className="num">Cost</th>
                    {isHourly && <>
                      <th className="num">Billed (gross)</th>
                      <th className="num">Net −10%</th>
                      <th className="num">Margin</th>
                    </>}
                  </>}
                </tr></thead>
                <tbody>
                  {allWeeks.map((ws) => {
                    const w = byWeek[ws] || { hours: 0, cost: 0 }
                    const billed = weekRev[ws] || 0
                    const wMargin = net(billed) - w.cost
                    return (
                      <tr key={ws}>
                        <td className="mono">{fmtWeek(ws)}</td>
                        <td className="num">{hrs(w.hours)}</td>
                        {isAdmin && <>
                          <td className="num">{money(w.cost)}</td>
                          {isHourly && <>
                            <td className="num">
                              <input type="number" inputMode="decimal" className="mono" min="0" step="10" defaultValue={billed || ''}
                                key={ws + ':' + billed}
                                placeholder={Number(proj.billing_rate) > 0 ? '@rate ' + money(w.hours * proj.billing_rate) : '0'}
                                onBlur={(e) => { if (Number(e.target.value || 0) !== billed) saveWeekBilled(ws, e.target.value) }}
                                style={{ background: 'transparent', border: '1px solid var(--line2)', borderRadius: 6, padding: '2px 6px', width: 110, textAlign: 'right' }} />
                            </td>
                            <td className="num mono" style={{ color: 'var(--mut)' }}>{billed > 0 ? money(net(billed)) : '—'}</td>
                            <td className={'num ' + (billed > 0 ? (wMargin >= 0 ? 'pos' : 'neg') : '')}>{billed > 0 ? money(wMargin) : '—'}</td>
                          </>}
                        </>}
                      </tr>
                    )
                  })}
                  <tr style={{ fontWeight: 600 }}>
                    <td>Total</td>
                    <td className="num">{hrs(proj.total_hours)}</td>
                    {isAdmin && <>
                      <td className="num">{money(proj.total_cost)}</td>
                      {isHourly && <>
                        <td className="num">{money(proj.gross_revenue)}</td>
                        <td className="num">{money(proj.net_revenue)}</td>
                        <td className={'num ' + (margin >= 0 ? 'pos' : 'neg')}>{money(margin)}</td>
                      </>}
                    </>}
                  </tr>
                </tbody>
              </table></div>
              {isAdmin && isHourly && (
                <div className="feenote">
                  Enter what was actually billed each week (gross) — not every logged hour gets billed. The placeholder shows hours × your reference rate as a starting point. Net and margin apply the 10% Upwork fee automatically.
                </div>
              )}
            </div>

            <div className="paneltitle">Daily detail</div>
            {weeks.map((ws) => {
              const w = byWeek[ws]
              return (
                <div className="weekblock" key={ws}>
                  <div className="weekhead">
                    {fmtWeek(ws)}
                    <span className="tot mono">
                      {hrs(w.hours)}
                      {isAdmin && <> · cost {money(w.cost)}</>}
                    </span>
                  </div>
                  <div className="scrollx"><table className="data">
                    <tbody>
                      {w.entries.map((e) => (
                        <tr key={e.id}>
                          <td style={{ width: 56, color: 'var(--mut)' }}>{dayName(e.work_date)}</td>
                          <td className="mono" style={{ width: 110 }}>{e.work_date}</td>
                          <td>{e.devs?.name}</td>
                          <td className="num" style={{ width: 80 }}>{hrs(e.hours)}</td>
                          {isAdmin && <td className="num" style={{ width: 90 }}>{money(Number(e.hours) * Number(e.devs?.hourly_cost || 0))}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>
              )
            })}
          </>
        )
      )}

      {tab === 'estimation' && (
        <EstimationTab projectId={id} loggedHours={Number(proj.total_hours)} userEmail={session?.user?.email || ''} />
      )}
    </>
  )
}

function BillingPanel({ proj, milestones, onChanged }) {
  const isHourly = proj.billing_type === 'hourly'
  const [rate, setRate] = useState(proj.billing_rate)
  useEffect(() => setRate(proj.billing_rate), [proj.billing_rate])

  async function setType(t) {
    await supabase.from('projects').update({ billing_type: t }).eq('id', proj.id)
    onChanged()
  }
  async function saveRate() {
    if (Number(rate) === Number(proj.billing_rate)) return
    await supabase.from('projects').update({ billing_rate: Number(rate) || 0 }).eq('id', proj.id)
    onChanged()
  }
  async function addMilestone() {
    await supabase.from('project_milestones').insert({
      project_id: proj.id, name: 'Milestone ' + (milestones.length + 1),
      amount: 0, position: milestones.length,
    })
    onChanged()
  }
  async function updateMilestone(m, patch) {
    await supabase.from('project_milestones').update(patch).eq('id', m.id)
    onChanged()
  }
  async function deleteMilestone(m) {
    if (!window.confirm('Delete "' + (m.name || 'milestone') + '"?')) return
    await supabase.from('project_milestones').delete().eq('id', m.id)
    onChanged()
  }

  const gross = milestones.reduce((a, m) => a + Number(m.amount), 0)
  const released = milestones.filter((m) => m.released).reduce((a, m) => a + Number(m.amount), 0)

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="paneltitle">Billing</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={proj.billing_type} onChange={(e) => setType(e.target.value)}>
          <option value="hourly">Hourly — billed by hours × client rate</option>
          <option value="fixed">Fixed price — billed by milestones</option>
        </select>
        {isHourly && (
          <>
            <span className="muted" style={{ fontSize: 13 }}>client rate $/h</span>
            <input type="number" inputMode="decimal" className="mono" min="0" step="0.5" value={rate}
              onChange={(e) => setRate(e.target.value)} onBlur={saveRate} style={{ width: 90 }} />
          </>
        )}
      </div>
      {isHourly ? (
        <div className="feenote">
          Reference rate for quoting: ${Number(rate || 0).toFixed(2)}/h gross → <strong>${net(rate).toFixed(2)}/h net</strong> after Upwork's 10%. Actual billed amounts are entered week by week in the Weekly totals table — we don't bill every logged hour.
        </div>
      ) : (
        <>
          <div className="scrollx"><table className="data" style={{ marginTop: 10 }}>
            <thead><tr>
              <th>Milestone</th><th className="num">Amount (gross)</th><th className="num">Net after 10%</th>
              <th style={{ width: 110 }}>Released?</th><th style={{ width: 60 }} />
            </tr></thead>
            <tbody>
              {milestones.map((m) => (
                <tr key={m.id} className="mrow">
                  <td>
                    <input defaultValue={m.name}
                      onBlur={(e) => { if (e.target.value !== m.name) updateMilestone(m, { name: e.target.value }) }}
                      style={{ background: 'transparent', border: '1px solid transparent', padding: '3px 6px', width: '100%' }}
                      onFocus={(e) => (e.target.style.borderColor = 'var(--line2)')} />
                  </td>
                  <td className="num">
                    <input type="number" inputMode="decimal" className="mono" min="0" step="50" defaultValue={m.amount}
                      onBlur={(e) => { if (Number(e.target.value) !== Number(m.amount)) updateMilestone(m, { amount: Number(e.target.value) || 0 }) }}
                      style={{ background: 'transparent', border: '1px solid var(--line2)', padding: '2px 6px', width: 100, textAlign: 'right' }} />
                  </td>
                  <td className="num mono" style={{ color: 'var(--mut)' }}>{money2(net(m.amount))}</td>
                  <td>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                      <input type="checkbox" checked={m.released}
                        onChange={(e) => updateMilestone(m, { released: e.target.checked })} />
                      {m.released ? <span className="pos">released</span> : <span className="muted">pending</span>}
                    </label>
                  </td>
                  <td>
                    <button className="ghost" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--danger)' }}
                      onClick={() => deleteMilestone(m)}>✕</button>
                  </td>
                </tr>
              ))}
              {milestones.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Totals</td>
                  <td className="num mono">{money(gross)}</td>
                  <td className="num mono">{money(net(gross))}</td>
                  <td colSpan="2" className="muted" style={{ fontSize: 12 }}>
                    released {money(released)} · remaining {money(gross - released)}
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <button className="ghost" onClick={addMilestone}>+ Add milestone</button>
            <span className="feenote" style={{ marginTop: 0 }}>Amounts are what the client pays (gross). Upwork takes 10% — the net column shows what reaches us. Margin counts released milestones only, net.</span>
          </div>
        </>
      )}
    </div>
  )
}

function EstimationTab({ projectId, loggedHours, userEmail }) {
  const [est, setEst] = useState(null)
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    supabase.from('project_estimates').select('*').eq('project_id', projectId).maybeSingle()
      .then(({ data }) => {
        setEst(data || { initial_hours: 0, remaining_hours: 0, notes: '', updated_by: '', updated_at: null })
        setNotes(data?.notes || '')
      })
  }, [projectId])

  async function save(patch) {
    const row = {
      project_id: projectId,
      initial_hours: est.initial_hours, remaining_hours: est.remaining_hours, notes,
      ...patch,
      updated_by: userEmail, updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('project_estimates').upsert(row, { onConflict: 'project_id' })
    if (!error) {
      setEst((e) => ({ ...e, ...row }))
      setSaved('saved ' + new Date().toLocaleTimeString())
    }
  }

  if (!est) return <div className="muted">Loading…</div>

  const initial = Number(est.initial_hours)
  const remaining = Number(est.remaining_hours)
  const projected = loggedHours + remaining
  const delta = projected - initial

  return (
    <>
      <div className="estgrid">
        <EditStat label="Initial estimate (h)" value={est.initial_hours}
          onSave={(v) => save({ initial_hours: Number(v) || 0 })} />
        <Stat label="Logged so far" value={hrs(loggedHours)} />
        <EditStat label="Estimated remaining (h)" value={est.remaining_hours}
          onSave={(v) => save({ remaining_hours: Number(v) || 0 })} />
        <Stat label="Projected total" value={hrs(projected)} />
        <Stat label="vs initial estimate" tone={delta <= 0 ? 'pos' : 'neg'}
          value={(delta > 0 ? '+' : '') + delta.toFixed(1) + 'h'} />
      </div>
      <div className="card">
        <div className="paneltitle">Estimation notes</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => save({ notes })}
          placeholder="scope assumptions, what changed, why remaining moved…"
          style={{ width: '100%', minHeight: 110, background: 'var(--panel2)', border: '1px solid var(--line2)', borderRadius: 8, color: 'var(--ink)', font: 'inherit', fontSize: 13, padding: 10, resize: 'vertical' }} />
        <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
          Everyone (admins and devs) can edit this tab. Update "estimated remaining" as work evolves — projected total shows whether the project lands inside the initial estimate.
          {est.updated_at && <> · last update {new Date(est.updated_at).toLocaleString()} {est.updated_by && 'by ' + est.updated_by}</>}
          {saved && <> · {saved}</>}
        </div>
      </div>
    </>
  )
}

function EditStat({ label, value, onSave }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <input type="number" inputMode="decimal" className="mono" min="0" step="0.5" value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (Number(v) !== Number(value)) onSave(v) }}
        style={{ fontSize: 20, fontWeight: 500, marginTop: 4, background: 'transparent', border: '1px solid var(--line2)', borderRadius: 7, padding: '2px 8px', width: '100%' }} />
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="card" style={{ minWidth: 150, flex: 1 }}>
      <div className="muted" style={{ fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div className={'mono ' + (tone || '')} style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>{value}</div>
    </div>
  )
}
