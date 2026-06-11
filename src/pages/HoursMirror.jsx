import React, { useEffect, useRef, useState, useCallback } from 'react'
import { ACCOUNTS, COLORS } from '../lib/format.js'

// ============================================================
// Hours Mirror — ported from the standalone HTML app.
// Logged blocks persist in localStorage (same keys as before, so
// existing data carries over). Migrating block storage to the
// upwork_blocks table in Supabase is the planned next step.
// ============================================================

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const NAMES = { tc: 'Thiago — tc', bc: 'Bernardo — bc', nn: 'Nick — nn' }
const CELL = 13, DAY_START = 0, DAY_END = 24

const pad = (n) => String(n).padStart(2, '0')
const mlab = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60)
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0) }

const PROMPT = `You are reading a screenshot of an Upwork Work Diary / manual time log page (a weekly or daily time grid showing logged time blocks).
Extract every logged/filled time block you can see. Respond ONLY with raw JSON, no markdown fences, no commentary:
{"blocks":[{"day":"Mon","start":"09:00","end":"10:30","label":"memo/contract text if visible else empty"}],"confidence":"high|medium|low","notes":"anything ambiguous"}
Rules: day is Mon..Sun (if single-day view, infer from visible date header; if impossible use Mon and note it). Times 24h HH:MM snapped to 10-min increments; if the page shows 12-hour times convert AM/PM correctly (12:00 AM = 00:00). Only clearly filled blocks; do not invent. If not a diary page at all return {"blocks":[],"confidence":"low","notes":"not a diary page"}.`

export default function HoursMirror() {
  const [blocks, setBlocks] = useState(() => JSON.parse(localStorage.getItem('uhm_blocks') || '[]'))
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

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const busyRef = useRef(false)
  const lastSigRef = useRef(null)
  const lastDeletedRef = useRef(null)
  const acctRef = useRef(acct)
  acctRef.current = acct

  useEffect(() => { localStorage.setItem('uhm_blocks', JSON.stringify(blocks)) }, [blocks])
  useEffect(() => {
    const h = () => { setSelected(null); setPop(null) }
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [])
  useEffect(() => () => stopShare(), []) // cleanup on unmount

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
          model: 'claude-sonnet-4-6', max_tokens: 1000,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: PROMPT },
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
      const incoming = (parsed.blocks || [])
        .filter((b) => idx[b.day] !== undefined)
        .map((b) => ({
          id: Math.random().toString(36).slice(2), acct: account,
          day: idx[b.day], start: toMin(b.start), end: toMin(b.end), label: b.label || '',
        }))
        .filter((b) => b.end > b.start)
      setBlocks((prev) => prev
        .filter((p) => p.acct !== account || !incoming.some((n) => n.day === p.day && n.start < p.end && n.end > p.start))
        .concat(incoming))
      setStatus({
        msg: 'Read ' + incoming.length + ' block(s) · ' + new Date().toLocaleTimeString() + ' · confidence ' + (parsed.confidence || '?'),
        warn: parsed.notes || '',
      })
    } catch {
      setStatus({ msg: '', warn: "Couldn't read that frame — make sure the diary grid is visible." })
    } finally {
      busyRef.current = false
    }
  }

  // ---- select / delete / undo / manual / clear ----
  function selectBlock(b, ev) {
    ev.stopPropagation()
    setSelected(b.id)
    const pw = Math.min(320, window.innerWidth - 20)
    let x = ev.clientX + 10, y = ev.clientY + 10
    if (x + pw > window.innerWidth) x = window.innerWidth - pw - 10
    if (y + 60 > window.innerHeight) y = ev.clientY - 60
    setPop({ x, y, label: DAYS[b.day] + ' ' + mlab(b.start) + '–' + mlab(b.end) + (b.label ? ' · ' + b.label : '') })
  }
  function deleteSelected(ev) {
    ev.stopPropagation()
    const b = blocks.find((x) => x.id === selected)
    if (!b) return
    lastDeletedRef.current = b
    setBlocks((prev) => prev.filter((x) => x.id !== selected))
    setSelected(null); setPop(null)
    setStatus({ msg: 'Removed ' + mlab(b.start) + '–' + mlab(b.end) + ' ' + DAYS[b.day], warn: '', undo: true })
  }
  function undoDelete() {
    if (!lastDeletedRef.current) return
    setBlocks((prev) => [...prev, lastDeletedRef.current])
    lastDeletedRef.current = null
    setStatus({ msg: 'Restored.', warn: '' })
  }
  function addManual() {
    const s = toMin(manual.start), e = toMin(manual.end)
    if (isNaN(s) || isNaN(e) || e <= s) return
    setBlocks((prev) => [...prev, {
      id: Math.random().toString(36).slice(2), acct, day: Number(manual.day), start: s, end: e, label: 'manual',
    }])
  }
  function clearAccount() { setBlocks((prev) => prev.filter((b) => b.acct !== acct)) }

  // ---- derived: gaps ----
  const gapsByDay = DAYS.map((_, d) => {
    const occ = blocks.filter((b) => b.acct === acct && b.day === d).sort((a, b) => a.start - b.start)
    let cur = DAY_START * 60
    const gaps = []
    occ.forEach((b) => { if (b.start > cur) gaps.push([cur, b.start]); cur = Math.max(cur, b.end) })
    if (cur < DAY_END * 60) gaps.push([cur, DAY_END * 60])
    return { gaps, freeH: gaps.reduce((a, g) => a + (g[1] - g[0]), 0) / 60 }
  })

  return (
    <>
      <div className="pagehead">
        <h1>Hours Mirror</h1>
        <span className="sub">log on Upwork · it watches · free time stays obvious · all times UTC</span>
      </div>

      <div className="card bar">
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

      <div className="card bar">
        <button className={sharing ? 'ghost' : 'primary'} onClick={toggleShare}>
          {sharing ? 'Stop sharing' : 'Share Upwork window'}
        </button>
        <button className={auto ? 'live' : 'ghost'} onClick={toggleAuto} disabled={!sharing}>
          {auto ? 'Auto-watch on' : 'Auto-watch off'}
        </button>
        <label style={{ fontSize: 13, color: 'var(--mut)', display: 'flex', alignItems: 'center', gap: 6 }}>
          every <input type="number" value={ivl} min="8" max="300" style={{ width: 64 }}
            onChange={(e) => setIvl(e.target.value)} /> s
        </label>
        <button className="ghost" onClick={readNow} disabled={!sharing}>Read now</button>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--mut)' }}>Reading into</span>
        <select value={acct} onChange={(e) => setAcct(e.target.value)}>
          {Object.entries(NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
      </div>

      <div className="statusline">
        {sharing && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" />sharing</span>}
        {status.msg && <span>{status.msg}</span>}
        {status.warn && <span className="warn">{status.warn}</span>}
        {status.undo && <button className="undo" onClick={undoDelete}>undo delete</button>}
      </div>

      <video ref={videoRef} muted playsInline className="hidden" />

      <div className="cols">
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
                      className={'blk' + (selected === b.id ? ' sel' : '')}
                      title={mlab(b.start) + '–' + mlab(b.end) + (b.label ? ' · ' + b.label : '')}
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
          <div className="legend">colored = logged &amp; locked · click a block to remove it · empty = free</div>
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

      {pop && (
        <div className="pop" style={{ left: pop.x, top: pop.y }}>
          <span className="mono">{pop.label}</span>
          <button onClick={deleteSelected}>Delete</button>
        </div>
      )}
    </>
  )
}
