import React, { useEffect, useMemo, useState } from 'react'
import { COLORS, money, hrs, net } from '../lib/format.js'
import { supabase, configured } from '../lib/supabase.js'

// ============================================================
// Week Suggestions (Labs) — the logging plan.
// Ground truth: dev timesheet hours this week, per project.
// Already done: confirmed mirrored blocks on Upwork (Hours Mirror).
// This page places the difference as concrete day/time slots in
// each account's free gaps — on the days the work actually
// happened — so logging on Upwork is "follow the striped blocks".
// Plan rows persist in week_log_plan (the assistant edits these later).
// ============================================================

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const NAMES = { tc: 'Thiago — tc', bc: 'Bernardo — bc', nn: 'Nick — nn' }
const CELL = 22
const WIN_START = 0, WIN_END = 1440          // suggestions can land anywhere 00:00–24:00
const MIN_CHUNK = 20                           // never suggest a slot under 20min
const MEMO_LIMIT = 144                         // Upwork memo character limit

// pack task strings into memo chunks of <= MEMO_LIMIT chars (joined with " · ")
function memoChunks(tasks) {
  const chunks = []
  let cur = ''
  ;(tasks || []).forEach((t0) => {
    let t = String(t0).trim()
    if (!t) return
    if (t.length > MEMO_LIMIT) {
      const cut = t.slice(0, MEMO_LIMIT - 1)
      const sp = cut.lastIndexOf(' ')
      t = (sp > 60 ? cut.slice(0, sp) : cut) + '…'
    }
    if (!cur) cur = t
    else if ((cur + ' · ' + t).length <= MEMO_LIMIT) cur += ' · ' + t
    else { chunks.push(cur); cur = t }
  })
  if (cur) chunks.push(cur)
  return chunks
}

const pad = (n) => String(n).padStart(2, '0')
const mlab = (m) => pad(Math.floor((m % 1440) / 60)) + ':' + pad(m % 60)
const r10 = (m) => Math.round(m / 10) * 10
const isoDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
function mondayOf(offsetWeeks = 0) {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetWeeks * 7)
  return isoDate(d)
}
function plusDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d) }
function dayIdx(workDate, weekStart) {
  return Math.round((new Date(workDate + 'T00:00:00') - new Date(weekStart + 'T00:00:00')) / 86400000)
}

export default function WeekSuggestions() {
  const labs = configured
  const [off, setOff] = useState(0)
  const weekStart = useMemo(() => mondayOf(off), [off])
  const weekEnd = useMemo(() => plusDays(weekStart, 6), [weekStart])

  const [acct, setAcct] = useState('tc')
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [mirror, setMirror] = useState([])
  const [plan, setPlan] = useState([])
  const [milestones, setMilestones] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [selDay, setSelDay] = useState(() => (new Date().getDay() + 6) % 7)
  const [copied, setCopied] = useState(null)
  function copyMemo(id, text) {
    navigator.clipboard?.writeText(text)
    setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 1400)
  }

  useEffect(() => {
    if (!labs) { setLoaded(true); return }
    setLoaded(false)
    ;(async () => {
      const [pj, he, bl, pl, ms] = await Promise.all([
        supabase.from('projects').select('id, channel, project_code, display_name, client_name, account, billing_type, billing_rate').eq('status', 'active'),
        supabase.from('hours_entries').select('project_id, work_date, hours, task, is_pm').gte('work_date', weekStart).lte('work_date', weekEnd).limit(5000),
        supabase.from('upwork_blocks').select('*').eq('week_start', weekStart),
        supabase.from('week_log_plan').select('*').eq('week_start', weekStart),
        supabase.from('project_milestones').select('project_id, released'),
      ])
      setProjects(pj.data || []); setEntries(he.data || []); setMirror(bl.data || [])
      setPlan((pl.data || []).filter((r) => r.status !== 'dismissed')); setMilestones(ms.data || [])
      setLoaded(true)
    })()
  }, [labs, weekStart])

  const projById = useMemo(() => new Map(projects.map((p) => [String(p.id), p])), [projects])
  const accProjects = projects.filter((p) => p.account === acct)
  const hourlyProjects = accProjects.filter((p) => p.billing_type === 'hourly')
  const acctMirror = mirror.filter((b) => b.account === acct)
  const acctPlan = plan.filter((r) => r.account === acct)

  // task details: distinct tasks per project (week) and per project/day
  const taskStats = useMemo(() => {
    const week = {}, byDay = {}
    entries.forEach((e) => {
      if (e.project_id == null || e.is_pm || !e.task) return
      const pid = String(e.project_id)
      if (!projById.has(pid) || projById.get(pid).account !== acct) return
      const d = dayIdx(e.work_date, weekStart)
      if (d < 0 || d > 6) return
      String(e.task).split(' \u00b7 ').forEach((t) => {
        t = t.trim(); if (!t) return
        ;(week[pid] = week[pid] || []).includes(t) || week[pid].push(t)
        const dd = (byDay[pid] = byDay[pid] || [[], [], [], [], [], [], []])[d]
        dd.includes(t) || dd.push(t)
      })
    })
    return { week, byDay }
  }, [entries, acct, projById, weekStart])
  const dayTasks = (pid, d) => ((taskStats.byDay[String(pid)] || [])[d] || []).join(' \u00b7 ')
  const memoOf = (r) => r.memo || (memoChunks((taskStats.byDay[String(r.project_id)] || [])[r.day] || [])[0] || '')

  // worked minutes per project (and per day) from the timesheets
  const workedStats = useMemo(() => {
    const tot = {}, byDay = {}
    entries.forEach((e) => {
      if (e.project_id == null || e.is_pm) return   // PM hours are internal — never suggested
      const pid = String(e.project_id)
      if (!projById.has(pid) || projById.get(pid).account !== acct) return
      const d = dayIdx(e.work_date, weekStart)
      if (d < 0 || d > 6) return
      const m = Number(e.hours) * 60
      tot[pid] = (tot[pid] || 0) + m
      ;(byDay[pid] = byDay[pid] || [0, 0, 0, 0, 0, 0, 0])[d] += m
    })
    return { tot, byDay }
  }, [entries, acct, projById, weekStart])

  // minutes already on Upwork per project (confirmed mirror blocks) and per day
  const loggedStats = useMemo(() => {
    const tot = {}, byDay = {}
    acctMirror.forEach((b) => {
      if (!b.confirmed_project_id) return
      const pid = String(b.confirmed_project_id)
      const m = b.end_min - b.start_min
      tot[pid] = (tot[pid] || 0) + m
      ;(byDay[pid] = byDay[pid] || [0, 0, 0, 0, 0, 0, 0])[b.day] += m
    })
    return { tot, byDay }
  }, [acctMirror])

  const plannedTot = useMemo(() => {
    const t = {}
    acctPlan.forEach((r) => { const pid = String(r.project_id); t[pid] = (t[pid] || 0) + (r.end_min - r.start_min) })
    return t
  }, [acctPlan])

  const msStats = useMemo(() => {
    const m = {}
    milestones.forEach((x) => {
      const pid = String(x.project_id)
      m[pid] = m[pid] || { rel: 0, tot: 0 }
      m[pid].tot++; if (x.released) m[pid].rel++
    })
    return m
  }, [milestones])

  // ---- AI memo writer ----
  function clampMemo(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim()
    if (t.length <= MEMO_LIMIT) return t
    const cut = t.slice(0, MEMO_LIMIT - 1)
    const sp = cut.lastIndexOf(' ')
    return (sp > 60 ? cut.slice(0, sp) : cut) + '…'
  }
  async function aiMemos(items) {
    const key = localStorage.getItem('uhm_key')
    const prompt = `You write Upwork work-diary memos for a dev agency. For each item below, summarize the raw task notes into polished memos.
Rules: each memo is plain text, professional, specific, COMPLETE sentences/phrases — never cut mid-sentence. HARD limit ${MEMO_LIMIT - 4} characters per memo. Write between 1 and the item's max_memos memos; use more memos to cover more work rather than cramming. No bullets, no numbering, no quotes.
Respond ONLY with raw JSON, no markdown fences: {"items":[{"key":"<same key>","memos":["..."]}]}

ITEMS:
${JSON.stringify(items)}`
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message || data.error.type)
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    const map = {}
    ;(parsed.items || []).forEach((it) => {
      const memos = (it.memos || []).map(clampMemo).filter(Boolean)
      if (memos.length) map[it.key] = memos
    })
    return map
  }

  // ---- the planner ----
  async function generate(useAI) {
    if (useAI && !localStorage.getItem('uhm_key')) { setMsg('Add your Anthropic API key on the Hours Mirror page first (same key as the Mirror).'); return }
    if (!window.confirm('Generate suggestions' + (useAI ? ' with AI memos' : '') + ' for ' + NAMES[acct] + ' · week of ' + weekStart + '? This replaces the existing plan for this account/week.')) return
    setBusy(true); setMsg('')

    // memo provider: deterministic chunking, or Claude-written memos
    let memoProvider = (pid, d) => memoChunks((taskStats.byDay[pid] || [])[d] || [])
    if (useAI) {
      try {
        setMsg('Asking Claude to write memos…')
        const items = []
        hourlyProjects.forEach((p) => {
          const pid = String(p.id)
          for (let d = 0; d < 7; d++) {
            const tasks = (taskStats.byDay[pid] || [])[d] || []
            if (!tasks.length) continue
            const needMin = r10(Math.max(0, ((workedStats.byDay[pid] || [])[d] || 0) - ((loggedStats.byDay[pid] || [])[d] || 0)))
            if (needMin < MIN_CHUNK) continue
            items.push({ key: pid + '|' + d, project: p.display_name || p.channel, planned_hours: +(needMin / 60).toFixed(1), max_memos: Math.max(1, Math.min(4, Math.floor(needMin / MIN_CHUNK))), raw_tasks: tasks })
          }
        })
        if (items.length) {
          const aiMap = await aiMemos(items)
          memoProvider = (pid, d) => aiMap[pid + '|' + d] || memoChunks((taskStats.byDay[pid] || [])[d] || [])
        }
        setMsg('')
      } catch (e) { setBusy(false); setMsg('AI memo writing failed: ' + e.message + ' — existing plan untouched.'); return }
    }

    await supabase.from('week_log_plan').delete().eq('account', acct).eq('week_start', weekStart)

    // free gaps per day: full day (00:00–24:00) minus everything mirrored (assigned or not)
    const gaps = DAYS.map((_, d) => {
      const occ = acctMirror.filter((b) => b.day === d).map((b) => [b.start_min, b.end_min]).sort((a, b) => a[0] - b[0])
      let cur = WIN_START
      const g = []
      occ.forEach(([s, e]) => { if (s > cur) g.push([cur, Math.min(s, WIN_END)]); cur = Math.max(cur, e) })
      if (cur < WIN_END) g.push([cur, WIN_END])
      return g.filter(([s, e]) => e - s >= MIN_CHUNK)
    })
    const takeFrom = (d, mins, pid, out) => {
      let left = mins
      for (let i = 0; i < gaps[d].length && left >= MIN_CHUNK; i++) {
        const [s, e] = gaps[d][i]
        const use = Math.min(left, e - s)
        if (use < MIN_CHUNK) continue
        out.push({ account: acct, week_start: weekStart, project_id: projById.get(pid).id, day: d, start_min: s, end_min: s + use, status: 'suggested' })
        gaps[d][i] = [s + use, e]
        left -= use
      }
      gaps[d] = gaps[d].filter(([s, e]) => e - s >= MIN_CHUNK)
      return left
    }

    // Day-locked: hours worked on a given day are logged on THAT day only.
    // For each day, place each project's (worked - already-logged) hours into
    // that day's free gaps. Nothing ever spills to another day.
    const rows = []
    let unplaced = 0
    for (let d = 0; d < 7; d++) {
      const order = hourlyProjects.map((p) => String(p.id))
        .sort((a, b) => ((workedStats.byDay[b] || [])[d] || 0) - ((workedStats.byDay[a] || [])[d] || 0))
      for (const pid of order) {
        const dayNeed = r10(Math.max(0, ((workedStats.byDay[pid] || [])[d] || 0) - ((loggedStats.byDay[pid] || [])[d] || 0)))
        if (dayNeed < MIN_CHUNK) continue
        const left = takeFrom(d, dayNeed, pid, rows)
        unplaced += left
      }
    }
    // merge adjacent same-project slots
    rows.sort((a, b) => a.day - b.day || a.start_min - b.start_min)
    let merged = []
    rows.forEach((r) => {
      const last = merged[merged.length - 1]
      if (last && last.day === r.day && String(last.project_id) === String(r.project_id) && last.end_min === r.start_min) last.end_min = r.end_min
      else merged.push({ ...r })
    })

    // memo pass: one memo (<=144 chars) per block; split blocks when a
    // project/day has more task text than fits in one memo
    const groups = new Map() // pid|day -> segs
    merged.forEach((r) => {
      const k = String(r.project_id) + '|' + r.day
      ;(groups.get(k) || groups.set(k, []).get(k)).push(r)
    })
    merged = []
    groups.forEach((segs, k) => {
      const [pid, dStr] = k.split('|')
      const chunks = memoProvider(pid, Number(dStr))
      // split largest segments until we have one per memo chunk (where possible)
      segs.sort((a, b) => a.start_min - b.start_min)
      while (chunks.length > 1 && segs.length < chunks.length) {
        let bi = -1, blen = 0
        segs.forEach((sg, i) => { const L = sg.end_min - sg.start_min; if (L >= 2 * MIN_CHUNK && L > blen) { blen = L; bi = i } })
        if (bi < 0) break
        const sg = segs[bi]
        const mid = Math.max(sg.start_min + MIN_CHUNK, Math.min(sg.end_min - MIN_CHUNK, r10((sg.start_min + sg.end_min) / 2)))
        segs.splice(bi, 1, { ...sg, end_min: mid }, { ...sg, start_min: mid })
        segs.sort((a, b) => a.start_min - b.start_min)
      }
      segs.forEach((sg, i) => {
        let memo = chunks.length ? chunks[Math.min(i, chunks.length - 1)] : null
        if (i === segs.length - 1 && chunks.length > segs.length) {
          memo = chunks.slice(i).join(' \u00b7 ')
          if (memo.length > MEMO_LIMIT) memo = memo.slice(0, MEMO_LIMIT - 1) + '…'
        }
        merged.push({ ...sg, memo })
      })
    })
    merged.sort((a, b) => a.day - b.day || a.start_min - b.start_min)

    if (!merged.length) {
      setPlan((prev) => prev.filter((r) => r.account !== acct))
      setMsg('Nothing to suggest — everything worked this week is already on Upwork (or no dev hours yet).')
      setBusy(false); return
    }
    const { data, error } = await supabase.from('week_log_plan').insert(merged).select('*')
    if (error) { setMsg('Save failed: ' + error.message); setBusy(false); return }
    setPlan((prev) => prev.filter((r) => r.account !== acct).concat(data))
    setMsg('Planned ' + data.length + ' slot(s).' + (unplaced >= MIN_CHUNK ? ' ⚠ ' + (unplaced / 60).toFixed(1) + 'h couldn\u2019t fit on its own day (that day is nearly full on Upwork already).' : ''))
    setBusy(false)
  }

  async function setDone(row, done) {
    setPlan((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: done ? 'done' : 'suggested' } : r)))
    await supabase.from('week_log_plan').update({ status: done ? 'done' : 'suggested' }).eq('id', row.id)
  }
  async function removeRow(row) {
    setPlan((prev) => prev.filter((r) => r.id !== row.id))
    await supabase.from('week_log_plan').delete().eq('id', row.id)
  }
  async function clearAll() {
    if (!window.confirm('Clear all ' + acctPlan.length + ' suggestion(s) for ' + NAMES[acct] + ' · week of ' + weekStart + '?')) return
    setBusy(true)
    const { error } = await supabase.from('week_log_plan').delete().eq('account', acct).eq('week_start', weekStart)
    if (error) { setMsg('Clear failed: ' + error.message); setBusy(false); return }
    setPlan((prev) => prev.filter((r) => r.account !== acct))
    setMsg('Cleared.')
    setBusy(false)
  }


  // display range: zoom the grid to the hours that actually have content (+1h pad)

  const codeOf = (pid) => { const p = projById.get(String(pid)); return p ? (p.project_code || p.channel) : '?' }
  const nameOf = (pid) => { const p = projById.get(String(pid)); return p ? (p.display_name || p.channel) : '?' }

  // summary rows: every account project with activity
  const summary = accProjects.map((p) => {
    const pid = String(p.id)
    const worked = workedStats.tot[pid] || 0
    const logged = loggedStats.tot[pid] || 0
    const planned = plannedTot[pid] || 0
    if (!worked && !logged && !planned) return null
    return { p, pid, worked, logged, planned, toLog: Math.max(0, worked - logged) }
  }).filter(Boolean).sort((a, b) => b.toLog - a.toLog)

  const freeTotal = useMemo(() => {
    let occ = 0
    acctMirror.forEach((b) => { occ += b.end_min - b.start_min })
    return (7 * 1440 - occ) / 60
  }, [acctMirror])

  if (!labs) return (
    <>
      <div className="pagehead"><h1>Week Suggestions</h1></div>
      <div className="card"><div className="muted">No database connected.</div></div>
    </>
  )

  return (
    <>
      <div className="pagehead">
        <h1>Week Suggestions</h1>
        <span className="sub">timesheets in · mirrored hours out · striped blocks = log these on Upwork</span>
      </div>

      <div className="card bar">
        <div className="tabs d-only" style={{ marginRight: 6 }}>
          {Object.entries(NAMES).map(([k, n]) => (
            <button key={k} className={'tab' + (k === acct ? ' active' : '')}
              style={k === acct ? { background: COLORS[k] } : null}
              onClick={() => { setAcct(k); setMsg('') }}>{n}</button>
          ))}
        </div>
        <button className="ghost" style={{ padding: '5px 11px' }} onClick={() => setOff(off - 1)} disabled={off <= -8}>◀</button>
        <span className="mono" style={{ fontSize: 13 }}>week of {weekStart}{off === 1 ? ' · next week' : off === 2 ? ' · in 2 weeks' : off === 0 ? '' : ''}</span>
        <button className="ghost" style={{ padding: '5px 11px' }} onClick={() => setOff(off + 1)} disabled={off >= 2}>▶</button>
        <span style={{ marginLeft: 'auto' }} />
        {acctPlan.length > 0 && (
          <button className="ghost" onClick={clearAll} disabled={busy || !loaded}>Clear all</button>
        )}
        <button className="primary" onClick={() => generate(false)} disabled={busy || !loaded}>
          {busy ? 'Planning…' : (acctPlan.length ? 'Regenerate suggestions' : 'Generate suggestions')}
        </button>
        <button className="ghost" onClick={() => generate(true)} disabled={busy || !loaded} title="Same placement — Claude writes complete, polished memos that fit 144 chars">
          ✨ Generate with AI
        </button>
      </div>

      {msg && <div className="statusline"><span>{msg}</span></div>}

      {loaded && (() => {
        const planMin = acctPlan.reduce((a, r) => a + (r.end_min - r.start_min), 0)
        const doneMin = acctPlan.filter((r) => r.status === 'done').reduce((a, r) => a + (r.end_min - r.start_min), 0)
        const mirMin = acctMirror.reduce((a, b) => a + (b.end_min - b.start_min), 0)
        const capLoad = (mirMin + planMin) / 60
        return (
          <div className="wtotals d-only">
            <span><strong>{((planMin - doneMin) / 60).toFixed(1)}h</strong> left to log</span>
            <span className="sep">·</span>
            <span><strong>{(doneMin / 60).toFixed(1)}h</strong> done</span>
            <span className="sep">·</span>
            <span>account load <strong className={capLoad > 40 ? 'neg' : capLoad > 36 ? '' : 'pos'}>{capLoad.toFixed(1)} / 40h</strong> (Upwork cap)</span>
          </div>
        )
      })()}

      {/* ---------- mobile: account tabs + day agenda ---------- */}
      <div className="m-only">
        <div className="tabs" style={{ marginBottom: 10 }}>
          {Object.entries(NAMES).map(([k]) => (
            <button key={k} className={'tab' + (k === acct ? ' active' : '')}
              style={k === acct ? { background: COLORS[k] } : null}
              onClick={() => { setAcct(k); setMsg('') }}>{k}</button>
          ))}
        </div>
        <div className="daychips">
          {DAYS.map((d, i) => {
            const ph = acctPlan.filter((r) => r.day === i).reduce((a, r) => a + (r.end_min - r.start_min), 0) / 60
            return (
              <button key={i} className={'daychip' + (selDay === i ? ' on' : '')} onClick={() => setSelDay(i)}>
                <span>{d.slice(0, 1)}</span>
                <em>{ph > 0 ? ph.toFixed(ph % 1 ? 1 : 0) + 'h' : '·'}</em>
              </button>
            )
          })}
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="paneltitle">
            <span className="swatch" style={{ background: COLORS[acct] }} />
            {DAYS[selDay]} · {plusDays(weekStart, selDay)}
          </div>
          {(() => {
            const mir = acctMirror.filter((b) => b.day === selDay).map((b) => ({ kind: 'mir', s: b.start_min, e: b.end_min, pid: b.confirmed_project_id, id: 'm' + b.id }))
            const pln = acctPlan.filter((r) => r.day === selDay).map((r) => ({ kind: 'plan', s: r.start_min, e: r.end_min, pid: r.project_id, row: r, id: r.id }))
            const all = [...mir, ...pln].sort((a, b) => a.s - b.s)
            if (!all.length) return <div className="muted" style={{ fontSize: 12.5 }}>Nothing on this day.</div>
            return all.map((x) => x.kind === 'mir' ? (
              <div key={x.id} className="agrow mir">
                <span className="mono agtime">{mlab(x.s)}–{mlab(x.e)}</span>
                <span className="agname muted">{x.pid ? nameOf(x.pid) : 'on Upwork'}</span>
                <span className="agtag">logged</span>
              </div>
            ) : (
              <div key={x.id} className={'agrow' + (x.row.status === 'done' ? ' donerow' : '')}
                style={{ borderLeft: '3px solid ' + COLORS[acct] }}>
                <span className="mono agtime">{mlab(x.s)}–{mlab(x.e)}</span>
                <span className="agname">
                  {nameOf(x.pid)}
                  {memoOf(x.row) && <span className="agtask">{memoOf(x.row)}</span>}
                </span>
                {memoOf(x.row) && (
                  <button className="ghost agbtn" onClick={() => copyMemo(x.row.id, memoOf(x.row))}>{copied === x.row.id ? '✓' : '⧉'}</button>
                )}
                <button className="ghost agbtn" onClick={() => setDone(x.row, x.row.status !== 'done')}>{x.row.status === 'done' ? '↺' : '✓'}</button>
                <button className="ghost agbtn" onClick={() => removeRow(x.row)}>✕</button>
              </div>
            ))
          })()}
        </div>
        {loaded && summary.length > 0 && (
          <div className="plist">
            {summary.map((r) => (
              <div className="pcard" key={r.pid}>
                <div className="pcard-top">
                  <span className="swatch" style={{ background: COLORS[acct] }} />
                  <strong style={{ fontSize: 13.5 }}>{r.p.display_name || r.p.channel}</strong>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>{r.p.billing_type}</span>
                </div>
                <div className="pcard-stats">
                  <div className="pstat"><em>Worked</em><b>{hrs(r.worked / 60)}</b></div>
                  <div className="pstat"><em>On Upwork</em><b>{hrs(r.logged / 60)}</b></div>
                  <div className="pstat"><em>Planned</em><b>{hrs(r.planned / 60)}</b></div>
                  <div className="pstat"><em>To log</em><b style={{ color: r.toLog >= MIN_CHUNK ? 'var(--warnc)' : 'var(--ok)' }}>{hrs(r.toLog / 60)}</b></div>
                </div>
                {(taskStats.week[r.pid] || []).length > 0 && (
                  <div className="muted tasksline" style={{ marginTop: 8 }}>{taskStats.week[r.pid].join(' \u00b7 ')}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ================= desktop: week board ================= */}
      <div className="d-only">
        {/* per-project progress chips */}
        {loaded && (
          <div className="wchips">
            {summary.filter((r) => r.p.billing_type === 'hourly').map((r) => {
              const done = acctPlan.filter((x) => String(x.project_id) === r.pid && x.status === 'done')
                .reduce((a, x) => a + (x.end_min - x.start_min), 0)
              const pct = r.planned > 0 ? Math.min(100, done / r.planned * 100) : 0
              const rate = Number(r.p.billing_rate) || 0
              return (
                <div className="wchip" key={r.pid} title={'worked ' + hrs(r.worked / 60) + ' · on Upwork ' + hrs(r.logged / 60) + ' · planned ' + hrs(r.planned / 60)}>
                  <div className="wchip-top">
                    <span className="wchip-name">{r.p.display_name || r.p.channel}</span>
                    <span className={'wchip-h' + (r.toLog >= MIN_CHUNK ? '' : ' ok')}>{r.toLog >= MIN_CHUNK ? hrs(r.toLog / 60) + ' to log' : 'all logged ✓'}</span>
                  </div>
                  <div className="wchip-bar"><span style={{ width: pct + '%' }} /></div>
                  {rate > 0 && r.toLog >= MIN_CHUNK && (
                    <div className="wchip-sub">≈{money(r.toLog / 60 * rate)} gross · {money(net(r.toLog / 60 * rate))} net</div>
                  )}
                </div>
              )
            })}
            {summary.some((r) => r.p.billing_type === 'fixed') && (
              <div className="wchip fixednote">
                + {hrs(summary.filter((r) => r.p.billing_type === 'fixed').reduce((a, r) => a + r.worked, 0) / 60)} on fixed-price projects — nothing to log
              </div>
            )}
          </div>
        )}

        {/* the board */}
        <div className="wboard">
          {DAYS.map((dname, d) => {
            const dayPlan = acctPlan.filter((r) => r.day === d).sort((a, b) => a.start_min - b.start_min)
            const mirH = acctMirror.filter((b) => b.day === d).reduce((a, b) => a + (b.end_min - b.start_min), 0) / 60
            const planH = dayPlan.reduce((a, r) => a + (r.end_min - r.start_min), 0) / 60
            const today = plusDays(weekStart, d) === isoDate(new Date())
            return (
              <div className={'wday' + (today ? ' today' : '')} key={d}>
                <div className="wday-head">
                  <span className="wday-name">{dname}</span>
                  <span className="wday-date mono">{plusDays(weekStart, d).slice(5).replace('-', '/')}</span>
                  {planH > 0 && <span className="wday-tot mono">{planH.toFixed(1)}h</span>}
                </div>
                {mirH > 0 && <div className="wday-mir">on Upwork already: {mirH.toFixed(1)}h</div>}
                {dayPlan.length === 0 && <div className="wday-empty">—</div>}
                {dayPlan.map((r) => {
                  const done = r.status === 'done'
                  const memo = memoOf(r)
                  return (
                    <div className={'wcard' + (done ? ' done' : '')} key={r.id} style={{ borderLeftColor: done ? 'var(--ok)' : COLORS[acct] }}>
                      <div className="wcard-top">
                        <span className="wcard-time mono">{mlab(r.start_min)} – {mlab(r.end_min)}</span>
                        <span className="wcard-actions">
                          {memo && <button className="wbtn" title="Copy memo" onClick={() => copyMemo(r.id, memo)}>{copied === r.id ? '✓' : '⧉'}</button>}
                          <button className="wbtn" title={done ? 'Mark not logged' : 'Mark logged'} onClick={() => setDone(r, !done)}>{done ? '↺' : '✓'}</button>
                          <button className="wbtn" title="Remove" onClick={() => removeRow(r)}>✕</button>
                        </span>
                      </div>
                      <div className="wcard-proj">{done ? '✓ ' : ''}{nameOf(r.project_id)}</div>
                      {memo && <div className="wcard-memo">{memo}</div>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Each card = one Upwork entry: copy the memo (⧉), log that time range on Upwork, mark it ✓. Cards sit on the day the work actually happened.
        </div>
      </div>

    </>
  )
}
