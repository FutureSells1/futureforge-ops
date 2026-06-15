import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { ACCOUNTS, COLORS, money, hrs, net } from '../lib/format.js'
import { supabase, configured } from '../lib/supabase.js'

// ============================================================
// Hours Mirror.
// Base mode: screen-share -> vision -> blocks in localStorage.
// Labs mode (Settings -> Labs): blocks persist to upwork_blocks
// in Supabase (current week), the vision call also suggests
// which project each block belongs to, and a week summary strip
// shows provisional billed / cost / margin per project with a
// one-tap push to project_week_revenue.
// ============================================================

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const NAMES = { tc: 'Thiago — tc', bc: 'Bernardo — bc', nn: 'Nick — nn' }
const CELL = 13, DAY_START = 0, DAY_END = 24

const pad = (n) => String(n).padStart(2, '0')
const mlab = (m) => (m >= 1440 ? '24:00' : pad(Math.floor(m / 60)) + ':' + pad(m % 60))
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0) }
const isoDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
function mondayOf() {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return isoDate(d)
}
function plusDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d) }

const BASE_PROMPT = `You are reading a screenshot of an Upwork Work Diary / manual time log page (a weekly or daily time grid showing logged time blocks).
Extract every logged/filled time block you can see. Respond ONLY with raw JSON, no markdown fences, no commentary:
__SCHEMA__
Rules: day is Mon..Sun (if single-day view, infer from visible date header; if impossible use Mon and note it). Times 24h HH:MM snapped to 10-min increments; if the page shows 12-hour times convert AM/PM correctly (12:00 AM = 00:00). Only clearly filled blocks; do not invent. If not a diary page at all return {"blocks":[],"confidence":"low","notes":"not a diary page"}.__MATCH__`

const SCHEMA_PLAIN = `{"blocks":[{"day":"Mon","start":"09:00","end":"10:30","label":"memo/contract text if visible else empty"}],"confidence":"high|medium|low","notes":"anything ambiguous"}`
const SCHEMA_SUGG = `{"blocks":[{"day":"Mon","start":"09:00","end":"10:30","label":"memo/contract text if visible else empty","project":"channel-from-list-or-null","project_confidence":"high|medium|low"}],"confidence":"high|medium|low","notes":"anything ambiguous"}`

export default function HoursMirror() {
  const labs = configured
  const weekStart = useMemo(() => mondayOf(), [])
  const weekEnd = useMemo(() => plusDays(weekStart, 6), [weekStart])

  const [blocks, setBlocks] = useState(() => configured ? [] : JSON.parse(localStorage.getItem('uhm_blocks') || '[]'))
  const [acct, setAcct] = useState('tc')
  const [sharing, setSharing] = useState(false)
  const [auto, setAuto] = useState(false)
  const [ivl, setIvl] = useState(20)
  const [status, setStatus] = useState({ msg: 'Add your API key, then share the Upwork window.', warn: '', undo: false })
  const [hasKey, setHasKey] = useState(() => Boolean(localStorage.getItem('uhm_key')))
  const [keyInput, setKeyInput] = useState('')
  const [selected, setSelected] = useState(null)
  const [pop, setPop] = useState(null) // {x, y, label}
  const [manual, setManual] = useState({ day: 0, start: '09:00', end: '10:00' })

  // labs data
  const [projects, setProjects] = useState([])
  const [devCost, setDevCost] = useState({})        // dev_id -> hourly_cost
  const [weekEntries, setWeekEntries] = useState([]) // hours_entries this week
  const [weekRev, setWeekRev] = useState({})         // project_id -> pushed amount
  const [billedDraft, setBilledDraft] = useState({}) // project_id -> input string
  const [pushedOk, setPushedOk] = useState({})       // project_id -> true after push
  const [loaded, setLoaded] = useState(!configured)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const busyRef = useRef(false)
  const lastSigRef = useRef(null)
  const lastDeletedRef = useRef(null)
  const acctRef = useRef(acct); acctRef.current = acct
  const blocksRef = useRef(blocks); blocksRef.current = blocks
  const projectsRef = useRef(projects); projectsRef.current = projects
  const weekEntriesRef = useRef(weekEntries); weekEntriesRef.current = weekEntries

  // base mode persistence only (labs persists to Supabase instead)
  useEffect(() => { if (!labs) localStorage.setItem('uhm_blocks', JSON.stringify(blocks)) }, [blocks, labs])
  useEffect(() => {
    const h = () => { setSelected(null); setPop(null) }
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [])
  useEffect(() => () => stopShare(), [])

  // ---- labs: load week context + persisted blocks ----
  useEffect(() => {
    if (!labs) return
    ;(async () => {
      const [pj, dv, he, wr, bl] = await Promise.all([
        supabase.from('projects').select('id, channel, display_name, client_name, account, billing_type, billing_rate').eq('status', 'active'),
        supabase.from('devs').select('id, hourly_cost'),
        supabase.from('hours_entries').select('project_id, dev_id, hours').gte('work_date', weekStart).lte('work_date', weekEnd).limit(5000),
        supabase.from('project_week_revenue').select('project_id, amount').eq('week_start', weekStart),
        supabase.from('upwork_blocks').select('*').eq('week_start', weekStart),
      ])
      setProjects(pj.data || [])
      setDevCost(Object.fromEntries((dv.data || []).map((d) => [d.id, Number(d.hourly_cost) || 0])))
      setWeekEntries(he.data || [])
      setWeekRev(Object.fromEntries((wr.data || []).map((r) => [String(r.project_id), Number(r.amount) || 0])))
      setBlocks((bl.data || []).map(rowToBlock))
      setLoaded(true)
    })()
  }, [labs])

  const rowToBlock = (r) => ({
    id: r.id, acct: r.account, day: r.day, start: r.start_min, end: r.end_min,
    label: r.label || '', sproj: r.suggested_project_id, sconf: r.suggestion_confidence, cproj: r.confirmed_project_id,
  })
  const blockToRow = (b) => ({
    account: b.acct, week_start: weekStart, day: b.day, start_min: b.start, end_min: b.end,
    label: b.label || '', source: b.source || 'vision',
    suggested_project_id: b.sproj || null, suggestion_confidence: b.sconf || null,
    confirmed_project_id: b.cproj || null,
  })
  async function dbInsert(list) {
    if (!labs || !list.length) return list
    const { data, error } = await supabase.from('upwork_blocks').insert(list.map(blockToRow)).select('id')
    if (error) { setStatus({ msg: '', warn: 'Save failed: ' + error.message }); return list }
    return list.map((b, i) => ({ ...b, id: data[i].id }))
  }
  async function dbDelete(ids) {
    if (!labs || !ids.length) return
    await supabase.from('upwork_blocks').delete().in('id', ids)
  }

  // ---- key ----
  function saveKey() {
    const v = keyInput.trim()
    if (!v) return
    localStorage.setItem('uhm_key', v)
    setHasKey(true); setKeyInput('')
    setStatus({ msg: 'Key saved.', warn: '' })
  }
  function changeKey() { localStorage.removeItem('uhm_key'); setHasKey(false) }

  // ---- share ----
  async function toggleShare() {
    if (streamRef.current) { stopShare(); return }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      stream.getVideoTracks()[0].addEventListener('ended', stopShare)
      setSharing(true)
      setStatus({ msg: 'Sharing started — turn on Auto-watch and go log.', warn: '' })
    } catch {
      setStatus({ msg: '', warn: 'Share cancelled or blocked — try again and pick the Upwork window.' })
    }
  }
  function stopShare() {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null }
    clearInterval(timerRef.current)
    setSharing(false); setAuto(false)
    setStatus({ msg: 'Sharing stopped.', warn: '' })
  }
  function toggleAuto() {
    const next = !auto
    setAuto(next)
    clearInterval(timerRef.current)
    if (next) {
      timerRef.current = setInterval(tick, Math.max(8, Number(ivl)) * 1000)
      tick()
    }
  }

  // ---- frame grab + change detection ----
  function grab() {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const c = document.createElement('canvas')
    const sc = Math.min(1, 1600 / v.videoWidth)
    c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc)
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    return c
  }
  function signature(canvas) {
    const s = document.createElement('canvas'); s.width = 32; s.height = 18
    s.getContext('2d').drawImage(canvas, 0, 0, 32, 18)
    return Array.from(s.getContext('2d').getImageData(0, 0, 32, 18).data.filter((_, i) => i % 16 === 0))
  }
  function changedFrame(sig) {
    if (!lastSigRef.current) return true
    let d = 0
    for (let i = 0; i < sig.length; i++) d += Math.abs(sig[i] - lastSigRef.current[i])
    return d / sig.length > 4
  }
  const tick = useCallback(async () => {
    if (busyRef.current || !streamRef.current) return
    const c = grab(); if (!c) return
    const sig = signature(c)
    if (!changedFrame(sig)) return
    lastSigRef.current = sig
    await readFrame(c)
  }, [])
  async function readNow() {
    const c = grab()
    if (c) { lastSigRef.current = signature(c); await readFrame(c) }
  }

  // ---- prompt (labs adds the project list + this week's sheet hours) ----
  function buildPrompt() {
    const account = acctRef.current
    if (!labs) return BASE_PROMPT.replace('__SCHEMA__', SCHEMA_PLAIN).replace('__MATCH__', '')
    const pj = projectsRef.current.filter((p) => p.account === account)
    if (!pj.length) return BASE_PROMPT.replace('__SCHEMA__', SCHEMA_PLAIN).replace('__MATCH__', '')
    const hoursByProj = {}
    weekEntriesRef.current.forEach((e) => {
      if (e.project_id != null) hoursByProj[String(e.project_id)] = (hoursByProj[String(e.project_id)] || 0) + Number(e.hours)
    })
    const list = pj.map((p) =>
      `- ${p.channel} | ${p.display_name || p.channel}${p.client_name ? ' | client: ' + p.client_name : ''} | ${p.billing_type}` +
      (hoursByProj[String(p.id)] ? ` | ${hoursByProj[String(p.id)].toFixed(1)}h logged by devs this week` : '')
    ).join('\n')
    const match = `\n\nAdditionally, match each block to one of this agency's active projects using the block's memo/contract text, client names, and which projects have dev activity this week:\n${list}\nFor each block set "project" to the matching channel string EXACTLY as listed (or null if you can't tell) and "project_confidence" to high/medium/low. Never guess a project for generic memos; use null instead.`
    return BASE_PROMPT.replace('__SCHEMA__', SCHEMA_SUGG).replace('__MATCH__', match)
  }

  // ---- vision ----
  async function readFrame(canvas) {
    const key = localStorage.getItem('uhm_key')
    if (!key) { setStatus({ msg: '', warn: 'Add your API key first.' }); return }
    busyRef.current = true
    setStatus({ msg: 'Reading frame…', warn: '' })
    try {
      const b64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 1500,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: buildPrompt() },
          ]}],
        }),
      })
      const data = await res.json()
      if (data.error) {
        setStatus({ msg: '', warn: 'API error: ' + (data.error.message || data.error.type) })
        busyRef.current = false; return
      }
      const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
      const idx = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
      const account = acctRef.current
      const chanMap = new Map(projectsRef.current.filter((p) => p.account === account).map((p) => [p.channel, p]))
      let incoming = (parsed.blocks || [])
        .filter((b) => idx[b.day] !== undefined)
        .map((b) => {
          const match = labs && b.project ? chanMap.get(String(b.project).trim().toLowerCase()) || chanMap.get(String(b.project).trim()) : null
          return {
            id: Math.random().toString(36).slice(2), acct: account,
            day: idx[b.day], start: toMin(b.start), end: toMin(b.end), label: b.label || '',
            source: 'vision',
            sproj: match ? match.id : null,
            sconf: match ? (['high', 'medium', 'low'].includes(b.project_confidence) ? b.project_confidence : 'low') : null,
            cproj: null,
          }
        })
        .filter((b) => b.end > b.start)
      // replace-overlap: drop existing blocks this account that the new read covers
      const prev = blocksRef.current
      const removed = prev.filter((p) => p.acct === account && incoming.some((n) => n.day === p.day && n.start < p.end && n.end > p.start))
      // keep a manual confirmation if the re-read block is essentially the same slot
      incoming = incoming.map((n) => {
        const old = removed.find((r) => r.day === n.day && r.start === n.start && r.end === n.end && r.cproj)
        return old ? { ...n, cproj: old.cproj } : n
      })
      await dbDelete(removed.map((r) => r.id))
      const withIds = await dbInsert(incoming)
      setBlocks((cur) => cur.filter((p) => !removed.some((r) => r.id === p.id)).concat(withIds))
      const sug = withIds.filter((b) => b.sproj && !b.cproj).length
      setStatus({
        msg: 'Read ' + withIds.length + ' block(s)' + (labs ? ' · ' + sug + ' suggested' : '') + ' · ' + new Date().toLocaleTimeString() + ' · confidence ' + (parsed.confidence || '?'),
        warn: parsed.notes || '',
      })
    } catch {
      setStatus({ msg: '', warn: "Couldn't read that frame — make sure the diary grid is visible." })
    } finally {
      busyRef.current = false
    }
  }

  // ---- assign / confirm ----
  async function assignBlock(id, projectId) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, cproj: projectId || null } : b)))
    if (labs) await supabase.from('upwork_blocks').update({ confirmed_project_id: projectId || null }).eq('id', id)
  }
  async function acceptHighConfidence() {
    const targets = blocksRef.current.filter((b) => b.acct === acct && b.sproj && !b.cproj && b.sconf === 'high')
    if (!targets.length) return
    setBlocks((prev) => prev.map((b) => (targets.some((t) => t.id === b.id) ? { ...b, cproj: b.sproj } : b)))
    if (labs) await Promise.all(targets.map((t) => supabase.from('upwork_blocks').update({ confirmed_project_id: t.sproj }).eq('id', t.id)))
    setStatus({ msg: 'Confirmed ' + targets.length + ' high-confidence block(s).', warn: '' })
  }

  // ---- select / delete / undo / manual / clear ----
  function selectBlock(b, ev) {
    ev.stopPropagation()
    setSelected(b.id)
    const pw = Math.min(320, window.innerWidth - 20)
    let x = ev.clientX + 10, y = ev.clientY + 10
    if (x + pw > window.innerWidth) x = window.innerWidth - pw - 10
    if (y + (labs ? 150 : 60) > window.innerHeight) y = ev.clientY - (labs ? 150 : 60)
    setPop({ x, y, label: DAYS[b.day] + ' ' + mlab(b.start) + '–' + mlab(b.end) + (b.label ? ' · ' + b.label : '') })
  }
  async function deleteSelected(ev) {
    ev.stopPropagation()
    const b = blocks.find((x) => x.id === selected)
    if (!b) return
    lastDeletedRef.current = b
    setBlocks((prev) => prev.filter((x) => x.id !== selected))
    await dbDelete([b.id])
    setSelected(null); setPop(null)
    setStatus({ msg: 'Removed ' + mlab(b.start) + '–' + mlab(b.end) + ' ' + DAYS[b.day], warn: '', undo: true })
  }
  async function undoDelete() {
    if (!lastDeletedRef.current) return
    const restored = await dbInsert([lastDeletedRef.current])
    setBlocks((prev) => [...prev, ...restored])
    lastDeletedRef.current = null
    setStatus({ msg: 'Restored.', warn: '' })
  }
  async function addManual() {
    const s = toMin(manual.start), e = toMin(manual.end)
    if (isNaN(s) || isNaN(e) || e <= s) return
    const b = { id: Math.random().toString(36).slice(2), acct, day: Number(manual.day), start: s, end: e, label: 'manual', source: 'manual', sproj: null, sconf: null, cproj: null }
    const withIds = await dbInsert([b])
    setBlocks((prev) => [...prev, ...withIds])
  }
  async function clearAccount() {
    if (labs && !window.confirm('Remove all mirrored blocks for ' + NAMES[acct] + ' this week? This also clears them from the database.')) return
    const ids = blocks.filter((b) => b.acct === acct).map((b) => b.id)
    setBlocks((prev) => prev.filter((b) => b.acct !== acct))
    await dbDelete(ids)
  }

  // ---- derived: gaps ----
  const gapsByDay = DAYS.map((_, d) => {
    const occ = blocks.filter((b) => b.acct === acct && b.day === d).sort((a, b) => a.start - b.start)
    let cur = DAY_START * 60
    const gaps = []
    occ.forEach((b) => { if (b.start > cur) gaps.push([cur, b.start]); cur = Math.max(cur, b.end) })
    if (cur < DAY_END * 60) gaps.push([cur, DAY_END * 60])
    return { gaps, freeH: gaps.reduce((a, g) => a + (g[1] - g[0]), 0) / 60 }
  })

  // ---- labs derived: suggestions + week summary ----
  const acctBlocks = blocks.filter((b) => b.acct === acct)
  const pendingSugg = labs ? acctBlocks.filter((b) => b.sproj && !b.cproj) : []
  const pendingHigh = pendingSugg.filter((b) => b.sconf === 'high')
  const projById = useMemo(() => new Map(projects.map((p) => [String(p.id), p])), [projects])

  const strip = useMemo(() => {
    if (!labs) return null
    const map = new Map() // pid -> {conf, sugg}
    let unassigned = 0
    acctBlocks.forEach((b) => {
      const h = (b.end - b.start) / 60
      const pid = b.cproj || b.sproj
      if (!pid) { unassigned += h; return }
      const k = String(pid)
      const o = map.get(k) || { conf: 0, sugg: 0 }
      if (b.cproj) o.conf += h; else o.sugg += h
      map.set(k, o)
    })
    const costByProj = {}
    weekEntries.forEach((e) => {
      if (e.project_id == null) return
      costByProj[String(e.project_id)] = (costByProj[String(e.project_id)] || 0) + Number(e.hours) * (devCost[e.dev_id] || 0)
    })
    const rows = [...map.entries()].map(([pid, o]) => {
      const p = projById.get(pid)
      return p ? { p, pid, conf: o.conf, sugg: o.sugg, cost: costByProj[pid] || 0 } : null
    }).filter(Boolean).sort((a, b) => (b.conf + b.sugg) - (a.conf + a.sugg))
    return { rows, unassigned }
  }, [labs, blocks, acct, weekEntries, devCost, projById])

  const defaultBilled = (r) => {
    if (weekRev[r.pid] != null) return String(weekRev[r.pid])
    const rate = Number(r.p.billing_rate) || 0
    return rate && r.conf ? (r.conf * rate).toFixed(2) : ''
  }
  async function pushBilled(r) {
    const raw = billedDraft[r.pid] ?? defaultBilled(r)
    const amt = Number(raw)
    if (!raw || isNaN(amt) || amt < 0) { setStatus({ msg: '', warn: 'Enter a billed amount first.' }); return }
    const { error } = await supabase.from('project_week_revenue').upsert(
      { project_id: r.p.id, week_start: weekStart, amount: amt }, { onConflict: 'project_id,week_start' })
    if (error) { setStatus({ msg: '', warn: 'Push failed: ' + error.message }); return }
    setWeekRev((prev) => ({ ...prev, [r.pid]: amt }))
    setPushedOk((prev) => ({ ...prev, [r.pid]: true }))
    setStatus({ msg: 'Pushed ' + money(amt) + ' to ' + (r.p.display_name || r.p.channel) + ' · week of ' + weekStart, warn: '' })
  }

  const selBlock = blocks.find((b) => b.id === selected)
  const acctProjects = projects.filter((p) => p.account === acct)
  const chanOf = (pid) => (projById.get(String(pid)) || {}).display_name || (projById.get(String(pid)) || {}).channel || '?'

  return (
    <>
      <div className="pagehead">
        <h1>Hours Mirror</h1>
        <span className="sub">log on Upwork · it watches · free time stays obvious · all times UTC{labs ? ' · week of ' + weekStart : ''}</span>
      </div>
      <div className="m-only notice" style={{ marginBottom: 12 }}>
        Screen capture needs desktop Chrome — do mirror sessions on your Mac. Below: this week's mirrored results and provisional margins, live.
      </div>

      <div className="card bar d-only">
        {!hasKey ? (
          <div className="keyline">
            <span>Anthropic API key</span>
            <input type="password" placeholder="sk-ant-api03-…" value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)} />
            <button className="ghost" onClick={saveKey}>Save key</button>
            <span style={{ fontSize: 11.5, color: 'var(--mut)' }}>stays in this browser only</span>
          </div>
        ) : (
          <div className="keyline">
            <span style={{ color: 'var(--ok)' }}>● key saved</span>
            <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={changeKey}>change</button>
          </div>
        )}
      </div>

      <div className="card bar d-only">
        <button className={sharing ? 'ghost' : 'primary'} onClick={toggleShare}>
          {sharing ? 'Stop sharing' : 'Share Upwork window'}
        </button>
        <button className={auto ? 'live' : 'ghost'} onClick={toggleAuto} disabled={!sharing}>
          {auto ? 'Auto-watch on' : 'Auto-watch off'}
        </button>
        <label style={{ fontSize: 13, color: 'var(--mut)', display: 'flex', alignItems: 'center', gap: 6 }}>
          every <input type="number" inputMode="decimal" value={ivl} min="8" max="300" style={{ width: 64 }}
            onChange={(e) => setIvl(e.target.value)} /> s
        </label>
        <button className="ghost" onClick={readNow} disabled={!sharing}>Read now</button>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--mut)' }}>Reading into</span>
        <select value={acct} onChange={(e) => setAcct(e.target.value)}>
          {Object.entries(NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
      </div>

      <div className="statusline d-only">
        {sharing && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" />sharing</span>}
        {status.msg && <span>{status.msg}</span>}
        {status.warn && <span className="warn">{status.warn}</span>}
        {status.undo && <button className="undo" onClick={undoDelete}>undo delete</button>}
        {labs && pendingSugg.length > 0 && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--mut)' }}>{pendingSugg.length} suggestion(s) pending</span>
            {pendingHigh.length > 0 && (
              <button className="ghost" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={acceptHighConfidence}>
                ✓ accept {pendingHigh.length} high-confidence
              </button>
            )}
          </span>
        )}
      </div>

      <video ref={videoRef} muted playsInline className="hidden" />

      {/* ---------- mobile: read-only week results ---------- */}
      {labs && (
        <div className="m-only">
          <div className="tabs" style={{ marginBottom: 10 }}>
            {Object.entries(NAMES).map(([k]) => (
              <button key={k} className={'tab' + (k === acct ? ' active' : '')}
                style={k === acct ? { background: COLORS[k] } : null}
                onClick={() => setAcct(k)}>{k}</button>
            ))}
          </div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="paneltitle"><span className="swatch" style={{ background: COLORS[acct] }} />Mirrored — week of {weekStart}</div>
            <div className="mono">
              {DAYS.map((d, i) => {
                const dayBlocks = blocks.filter((b) => b.acct === acct && b.day === i)
                const tot = dayBlocks.reduce((a, b) => a + (b.end - b.start), 0) / 60
                const conf = dayBlocks.filter((b) => b.cproj).reduce((a, b) => a + (b.end - b.start), 0) / 60
                return (
                  <div className="gaprow" key={i}>
                    <span className="d">{d}</span>
                    <span className="g muted" style={{ fontSize: 11 }}>{tot ? conf.toFixed(1) + 'h confirmed' : '—'}</span>
                    <span className="h">{tot ? tot.toFixed(1) + 'h' : ''}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="cols d-only">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="tabs">
              {Object.entries(NAMES).map(([k, n]) => (
                <button key={k} className={'tab' + (k === acct ? ' active' : '')}
                  style={k === acct ? { background: COLORS[k] } : null}
                  onClick={(e) => { e.stopPropagation(); setAcct(k) }}>{n}</button>
              ))}
            </div>
            <button className="ghost" style={{ fontSize: 11.5, padding: '5px 10px' }} onClick={clearAccount}>clear account</button>
          </div>

          <div className="grid">
            <div className="axis">
              {Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i).map((h) => (
                <div key={h} className="hourband mono" style={{ height: CELL * 2 }}>{pad(h)}–{pad(h + 1)}</div>
              ))}
            </div>
            {DAYS.map((dname, d) => (
              <div className="daycol" key={d}>
                <div className="dayhead">{dname}</div>
                <div className="daybody" style={{ height: (DAY_END - DAY_START) * 2 * CELL }}>
                  {Array.from({ length: DAY_END - DAY_START - 1 }, (_, i) => i + 1).map((h) => (
                    <div key={h} className="hline" style={{ top: h * CELL * 2 }} />
                  ))}
                  {blocks.filter((b) => b.acct === acct && b.day === d).map((b) => (
                    <div key={b.id}
                      className={'blk' + (selected === b.id ? ' sel' : '') + (labs && b.cproj ? ' conf' : labs && b.sproj ? ' sugg' : '')}
                      title={mlab(b.start) + '–' + mlab(b.end) + (b.label ? ' · ' + b.label : '') +
                        (labs && b.cproj ? ' · ✓ ' + chanOf(b.cproj) : labs && b.sproj ? ' · → ' + chanOf(b.sproj) + ' (' + b.sconf + ')' : '')}
                      style={{
                        top: (b.start - DAY_START * 60) / 30 * CELL,
                        height: Math.max(5, (b.end - b.start) / 30 * CELL),
                        background: COLORS[acct],
                      }}
                      onClick={(e) => selectBlock(b, e)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="legend">
            colored = logged &amp; locked · click a block to {labs ? 'assign / remove' : 'remove'} it · empty = free
            {labs && <> · <span style={{ opacity: .85 }}>dashed = suggested · solid edge = confirmed</span></>}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="paneltitle">
              <span className="swatch" style={{ background: COLORS[acct] }} />Free gaps — {NAMES[acct]}
            </div>
            <div className="mono">
              {gapsByDay.map((g, d) => (
                <div className="gaprow" key={d}>
                  <span className="d">{DAYS[d]}</span>
                  <span className="g">{g.gaps.length ? g.gaps.map((x) => mlab(x[0]) + '–' + mlab(x[1])).join('\u2002') : '—'}</span>
                  <span className="h">{g.freeH.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="paneltitle">Add a block by hand</div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={manual.day} onChange={(e) => setManual({ ...manual, day: e.target.value })}>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
              <input className="mono" value={manual.start} style={{ width: 74 }}
                onChange={(e) => setManual({ ...manual, start: e.target.value })} />
              <span style={{ color: 'var(--mut)' }}>–</span>
              <input className="mono" value={manual.end} style={{ width: 74 }}
                onChange={(e) => setManual({ ...manual, end: e.target.value })} />
              <button className="ghost" onClick={addManual}>Add block</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--mut)' }}>fallback for anything the reader misses</div>
          </div>
        </div>
      </div>

      {labs && loaded && strip && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="paneltitle">
            <span className="swatch" style={{ background: COLORS[acct] }} />
            Week summary — {NAMES[acct]} · provisional · week of {weekStart}
          </div>
          {strip.rows.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>No mirrored hours assigned to projects yet — confirm a few suggestions and the margin math appears here.</div>
          ) : (
            <div className="scrollx d-only">
              <table className="data">
                <thead><tr>
                  <th>Project</th><th className="num">Mirrored</th><th className="num">Dev cost (sheets)</th>
                  <th>Billed this week (gross)</th><th className="num">Net −10%</th><th className="num">Margin</th><th></th>
                </tr></thead>
                <tbody>
                  {strip.rows.map((r) => {
                    const fixed = r.p.billing_type === 'fixed'
                    const raw = billedDraft[r.pid] ?? defaultBilled(r)
                    const amt = Number(raw) || 0
                    const netAmt = net(amt)
                    const margin = netAmt - r.cost
                    return (
                      <tr key={r.pid}>
                        <td>
                          {r.p.display_name || r.p.channel}
                          <div className="muted" style={{ fontSize: 10.5 }}>{r.p.channel} · {r.p.billing_type}</div>
                        </td>
                        <td className="num">
                          {hrs(r.conf)}
                          {r.sugg > 0 && <span className="muted" style={{ fontSize: 10.5 }}> +{r.sugg.toFixed(1)}h?</span>}
                        </td>
                        <td className="num">{money(r.cost)}</td>
                        {fixed ? (
                          <td colSpan={3} className="muted" style={{ fontSize: 12 }}>fixed-price — revenue comes from released milestones</td>
                        ) : (
                          <>
                            <td>
                              <input className="mono" inputMode="decimal" style={{ width: 110 }}
                                placeholder={Number(r.p.billing_rate) ? '@' + r.p.billing_rate + '/h' : 'amount'}
                                value={raw}
                                onChange={(e) => { setBilledDraft((p) => ({ ...p, [r.pid]: e.target.value })); setPushedOk((p) => ({ ...p, [r.pid]: false })) }} />
                            </td>
                            <td className="num">{money(netAmt)}</td>
                            <td className="num" style={{ color: margin >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{money(margin)}</td>
                          </>
                        )}
                        <td>
                          {!fixed && (
                            pushedOk[r.pid] || (weekRev[r.pid] != null && (billedDraft[r.pid] === undefined || Number(billedDraft[r.pid]) === weekRev[r.pid]))
                              ? <span style={{ color: 'var(--ok)', fontSize: 12 }}>✓ pushed</span>
                              : <button className="ghost" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => pushBilled(r)}>Push to billed</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="m-only">
            {strip.rows.map((r) => {
              const fixed = r.p.billing_type === 'fixed'
              const raw = billedDraft[r.pid] ?? defaultBilled(r)
              const amt = Number(raw) || 0
              const margin = net(amt) - r.cost
              const pushed = pushedOk[r.pid] || (weekRev[r.pid] != null && (billedDraft[r.pid] === undefined || Number(billedDraft[r.pid]) === weekRev[r.pid]))
              return (
                <div className="pcard" key={r.pid} style={{ marginBottom: 10 }}>
                  <div className="pcard-top">
                    <span className="swatch" style={{ background: COLORS[acct] }} />
                    <strong style={{ fontSize: 13.5 }}>{r.p.display_name || r.p.channel}</strong>
                    <span className="muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>{r.p.billing_type}</span>
                  </div>
                  <div className="pcard-stats">
                    <div className="pstat"><em>Mirrored</em><b>{hrs(r.conf)}{r.sugg > 0 ? ' +' + r.sugg.toFixed(1) + '?' : ''}</b></div>
                    <div className="pstat"><em>Dev cost</em><b>{money(r.cost)}</b></div>
                    {!fixed && <div className="pstat"><em>Margin</em><b className={margin >= 0 ? 'pos' : 'neg'}>{money(margin)}</b></div>}
                  </div>
                  {fixed ? (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>fixed-price — revenue via milestones</div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                      <input className="mono" inputMode="decimal" style={{ flex: 1, minWidth: 0 }}
                        placeholder={Number(r.p.billing_rate) ? '@' + r.p.billing_rate + '/h' : 'billed amount'}
                        value={raw}
                        onChange={(e) => { setBilledDraft((p) => ({ ...p, [r.pid]: e.target.value })); setPushedOk((p) => ({ ...p, [r.pid]: false })) }} />
                      {pushed
                        ? <span style={{ color: 'var(--ok)', fontSize: 12, flex: 'none' }}>✓ pushed</span>
                        : <button className="ghost" style={{ fontSize: 12, flex: 'none' }} onClick={() => pushBilled(r)}>Push</button>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {strip.unassigned > 0 && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>⚠ {strip.unassigned.toFixed(1)}h mirrored with no project — click those blocks to assign them.</div>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Mirrored = confirmed blocks (+? = suggested, unconfirmed, not counted in $). Billed prefills confirmed × reference rate — edit before pushing; pushing writes this week's amount in project_week_revenue (same field as the project page). Dev cost comes from the timesheets, not the mirror.
          </div>
        </div>
      )}

      {pop && (
        <div className="pop" style={labs
          ? { left: pop.x, top: pop.y, flexDirection: 'column', alignItems: 'stretch', gap: 7, width: 300 }
          : { left: pop.x, top: pop.y }}
          onClick={(e) => e.stopPropagation()}>
          <span className="mono" style={labs ? { fontSize: 11 } : null}>{pop.label}</span>
          {labs && selBlock && (
            <>
              {selBlock.sproj && !selBlock.cproj && (
                <span style={{ fontSize: 11.5, color: 'var(--mut)' }}>suggested → {chanOf(selBlock.sproj)} · {selBlock.sconf} confidence</span>
              )}
              <select value={selBlock.cproj ? String(selBlock.cproj) : ''}
                onChange={(e) => {
                  const p = acctProjects.find((x) => String(x.id) === e.target.value)
                  assignBlock(selBlock.id, p ? p.id : null)
                }}>
                <option value="">— no project —</option>
                {acctProjects.map((p) => <option key={p.id} value={String(p.id)}>{p.display_name || p.channel}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 7 }}>
                {selBlock.sproj && !selBlock.cproj && (
                  <button onClick={(e) => { e.stopPropagation(); assignBlock(selBlock.id, selBlock.sproj) }}>✓ Accept</button>
                )}
                <button onClick={deleteSelected}>Delete</button>
              </div>
            </>
          )}
          {!labs && <button onClick={deleteSelected}>Delete</button>}
        </div>
      )}
    </>
  )
}
