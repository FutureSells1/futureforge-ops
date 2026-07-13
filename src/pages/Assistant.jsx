import React, { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'

// ============================================================
// Assistant (Labs) — chat with full project context.
// - Same browser-side Anthropic key as the Hours Mirror.
// - Context pack rebuilt from Supabase on every message (always fresh).
// - Read tools run automatically; WRITE tools always pause and
//   render an Approve / Decline card — nothing changes silently.
// ============================================================

const pad = (n) => String(n).padStart(2, '0')
const isoDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
function mondayOf() { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDate(d) }
function plusDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d) }
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0) }
const mlab = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60)
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dayIdx = (name) => DAYS.findIndex((d) => d.toLowerCase() === String(name).slice(0, 3).toLowerCase())

const WRITE_TOOLS = new Set(['plan_add', 'plan_move', 'plan_delete', 'plan_mark_logged', 'set_week_billed', 'update_estimate', 'mirror_assign'])

const TOOLS = [
  { name: 'get_project_detail', description: 'Fetch full detail for one project: weekly billed history, milestones, estimate, recent daily dev hours.', input_schema: { type: 'object', properties: { channel: { type: 'string', description: 'project channel, e.g. tc-ct-ocf' } }, required: ['channel'] } },
  { name: 'plan_add', description: 'Add a suggested logging slot to the week plan (Week Suggestions page). Can target the current week or a future week (e.g. overflow when a week hits the Upwork logging cap).', input_schema: { type: 'object', properties: { account: { type: 'string', enum: ['tc', 'bc', 'nn'] }, channel: { type: 'string' }, day: { type: 'string', description: 'Mon..Sun' }, start: { type: 'string', description: 'HH:MM 24h' }, end: { type: 'string', description: 'HH:MM 24h' }, memo: { type: 'string', description: 'Upwork memo for this block, max 144 chars' }, week_start: { type: 'string', description: 'Monday YYYY-MM-DD of the target week. Omit for the current week; use next Monday for overflow.' } }, required: ['account', 'channel', 'day', 'start', 'end'] } },
  { name: 'plan_move', description: 'Move/resize an existing plan slot, optionally updating its memo and/or moving it to a different week (e.g. pushing overflow to next week). Use the plan row id from the data snapshot.', input_schema: { type: 'object', properties: { plan_id: { type: 'string' }, day: { type: 'string', description: 'Mon..Sun' }, start: { type: 'string' }, end: { type: 'string' }, memo: { type: 'string', description: 'new Upwork memo, max 144 chars' }, week_start: { type: 'string', description: 'Monday YYYY-MM-DD to move the slot to a different week' } }, required: ['plan_id', 'day', 'start', 'end'] } },
  { name: 'plan_delete', description: 'Delete plan slots by id.', input_schema: { type: 'object', properties: { plan_ids: { type: 'array', items: { type: 'string' } } }, required: ['plan_ids'] } },
  { name: 'plan_mark_logged', description: 'Mark plan slots as logged (done) or not.', input_schema: { type: 'object', properties: { plan_ids: { type: 'array', items: { type: 'string' } }, logged: { type: 'boolean' } }, required: ['plan_ids', 'logged'] } },
  { name: 'set_week_billed', description: 'Set the manually billed GROSS amount for an hourly project for a given week (writes project_week_revenue).', input_schema: { type: 'object', properties: { channel: { type: 'string' }, week_start: { type: 'string', description: 'Monday, YYYY-MM-DD' }, amount: { type: 'number', description: 'gross USD before the 10% Upwork fee' } }, required: ['channel', 'week_start', 'amount'] } },
  { name: 'update_estimate', description: 'Update a project estimate (initial/remaining hours, notes).', input_schema: { type: 'object', properties: { channel: { type: 'string' }, initial_hours: { type: 'number' }, remaining_hours: { type: 'number' }, notes: { type: 'string' } }, required: ['channel'] } },
  { name: 'mirror_assign', description: 'Assign mirrored Upwork blocks (Hours Mirror) to a project, confirming them — or unassign with channel null. Use block ids from the MIRROR BLOCKS snapshot.', input_schema: { type: 'object', properties: { block_ids: { type: 'array', items: { type: 'string' } }, channel: { type: ['string', 'null'], description: 'project channel, or null to unassign' } }, required: ['block_ids', 'channel'] } },
]

function toolSummary(tu, byChannel) {
  const i = tu.input || {}
  switch (tu.name) {
    case 'get_project_detail': return 'Look up ' + i.channel
    case 'plan_add': return 'Add plan slot: ' + i.channel + ' · ' + i.day + ' ' + i.start + '–' + i.end + ' (' + i.account + ')' + (i.week_start ? ' · week of ' + i.week_start : '')
    case 'plan_move': return 'Move plan slot ' + String(i.plan_id).slice(0, 8) + ' → ' + i.day + ' ' + i.start + '–' + i.end + (i.week_start ? ' · week of ' + i.week_start : '')
    case 'plan_delete': return 'Delete ' + (i.plan_ids || []).length + ' plan slot(s)'
    case 'plan_mark_logged': return (i.logged ? 'Mark logged: ' : 'Mark NOT logged: ') + (i.plan_ids || []).length + ' slot(s)'
    case 'set_week_billed': return 'Set billed: ' + i.channel + ' · week ' + i.week_start + ' → $' + Number(i.amount).toFixed(2) + ' gross'
    case 'update_estimate': return 'Update estimate: ' + i.channel
    case 'mirror_assign': return (i.channel ? 'Assign ' + (i.block_ids || []).length + ' mirrored block(s) → ' + i.channel : 'Unassign ' + (i.block_ids || []).length + ' mirrored block(s)')
    default: return tu.name
  }
}

export default function Assistant() {
  const { session } = useOutletContext()
  const labs = configured
  const weekStart = mondayOf()
  const nextWeek = plusDays(weekStart, 7)

  const [messages, setMessages] = useState([])   // Anthropic-shaped
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [confirm, setConfirm] = useState(null)   // tool_use awaiting approval
  const [errs, setErrs] = useState('')
  const [hasKey, setHasKey] = useState(() => Boolean(localStorage.getItem('uhm_key')))
  const [keyInput, setKeyInput] = useState('')
  const [chatId, setChatId] = useState(null)
  const [chats, setChats] = useState([])
  const [histOpen, setHistOpen] = useState(false)

  const mapsRef = useRef({ byChannel: new Map(), byId: new Map() })
  const loopRef = useRef(null) // { msgs, queue, results }
  const logRef = useRef(null)

  useEffect(() => { logRef.current?.scrollTo(0, 1e9) }, [messages, confirm, busy])

  // chat history: load list on mount
  useEffect(() => {
    if (!labs) return
    supabase.from('assistant_chats').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(30)
      .then(({ data }) => setChats(data || []))
  }, [labs])

  // autosave the conversation (debounced) after every exchange
  const chatIdRef = useRef(null); chatIdRef.current = chatId
  useEffect(() => {
    if (!labs || messages.length === 0) return
    const t = setTimeout(async () => {
      const id = chatIdRef.current || crypto.randomUUID()
      if (!chatIdRef.current) setChatId(id)
      const firstUser = messages.find((m) => m.role === 'user' && typeof m.content === 'string')
      const title = (firstUser ? String(firstUser.content) : 'New chat').slice(0, 60)
      await supabase.from('assistant_chats').upsert({ id, title, messages, updated_at: new Date().toISOString() })
      supabase.from('assistant_chats').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(30)
        .then(({ data }) => setChats(data || []))
    }, 900)
    return () => clearTimeout(t)
  }, [messages, labs])

  async function openChat(id) {
    const { data } = await supabase.from('assistant_chats').select('messages').eq('id', id).maybeSingle()
    if (data) { setMessages(data.messages || []); setChatId(id); setConfirm(null); loopRef.current = null; setErrs('') }
    setHistOpen(false)
  }
  function newChat() {
    setMessages([]); setChatId(null); setConfirm(null); loopRef.current = null; setErrs(''); setHistOpen(false)
  }
  async function deleteChat(id, ev) {
    ev.stopPropagation()
    await supabase.from('assistant_chats').delete().eq('id', id)
    setChats((prev) => prev.filter((c) => c.id !== id))
    if (chatId === id) newChat()
  }

  function saveKey() {
    const v = keyInput.trim(); if (!v) return
    localStorage.setItem('uhm_key', v); setHasKey(true); setKeyInput('')
  }

  // ---- context pack ----
  async function buildContext() {
    const weekEnd = plusDays(weekStart, 6)
    const lastWeek = plusDays(weekStart, -7)
    const [prof, pj, est, plan, blocks, rev, he, dv, ms, warn, unm] = await Promise.all([
      supabase.from('project_profitability').select('*'),
      supabase.from('projects').select('id, channel, display_name, client_name, account, billing_type, billing_rate, weekly_cap_hours, status'),
      supabase.from('project_estimates').select('*'),
      supabase.from('week_log_plan').select('*').in('week_start', [weekStart, nextWeek]),
      supabase.from('upwork_blocks').select('id, account, day, start_min, end_min, label, suggested_project_id, suggestion_confidence, confirmed_project_id').eq('week_start', weekStart),
      supabase.from('project_week_revenue').select('project_id, week_start, amount').gte('week_start', lastWeek),
      supabase.from('hours_entries').select('project_id, work_date, hours, is_overhead, is_pm').gte('work_date', lastWeek).lte('work_date', weekEnd).limit(8000),
      supabase.from('devs').select('id, name, hourly_cost, active'),
      supabase.from('project_milestones').select('project_id, amount, released'),
      supabase.from('sync_warnings').select('id', { count: 'exact', head: true }),
      supabase.from('unmatched_hours').select('hours'),
    ])
    const projects = (pj.data || []).filter((p) => p.status === 'active')
    mapsRef.current = {
      byChannel: new Map(projects.map((p) => [p.channel, p])),
      byId: new Map(projects.map((p) => [String(p.id), p])),
    }
    const $ = (n) => '$' + Number(n || 0).toFixed(0)
    const hoursBy = {} // pid -> {this, last, pmT} — PM tracked separately: it is NEVER logged on Upwork
    ;(he.data || []).forEach((e) => {
      if (e.project_id == null) return
      const k = String(e.project_id)
      hoursBy[k] = hoursBy[k] || { t: 0, l: 0, pmT: 0 }
      if (e.is_pm) { if (e.work_date >= weekStart) hoursBy[k].pmT += Number(e.hours); return }
      if (e.work_date >= weekStart) hoursBy[k].t += Number(e.hours); else hoursBy[k].l += Number(e.hours)
    })
    const overheadH = (he.data || []).filter((e) => e.is_overhead && e.work_date >= weekStart).reduce((a, e) => a + Number(e.hours), 0)
    const msBy = {}
    ;(ms.data || []).forEach((m) => { const k = String(m.project_id); msBy[k] = msBy[k] || { rel: 0, tot: 0, relAmt: 0 }; msBy[k].tot++; if (m.released) { msBy[k].rel++; msBy[k].relAmt += Number(m.amount) } })
    const revBy = {}
    ;(rev.data || []).forEach((r) => { revBy[String(r.project_id) + '|' + r.week_start] = Number(r.amount) })
    const estBy = Object.fromEntries((est.data || []).map((e) => [String(e.project_id), e]))

    const projLines = (prof.data || []).filter((r) => mapsRef.current.byId.has(String(r.id))).map((r) => {
      const k = String(r.id)
      const p = mapsRef.current.byId.get(k)
      const h = hoursBy[k] || { t: 0, l: 0 }
      const e = estBy[k]
      return `- ${r.channel} | ${r.display_name || ''} | ${r.client_name || ''} | acct:${r.account} | ${r.billing_type}${p.billing_rate ? '@$' + p.billing_rate + '/h ref' : ''}` +
        ` | lifetime: ${Number(r.total_hours || 0).toFixed(0)}h${Number(r.pm_hours) > 0 ? ' (incl ' + Number(r.pm_hours).toFixed(0) + 'h PM)' : ''} cost ${$(r.total_cost)} netRev ${$(r.net_revenue)} margin ${$(r.margin)}` +
        ` | loggable hrs thisWk ${h.t.toFixed(1)} lastWk ${h.l.toFixed(1)}${h.pmT ? ' (+' + h.pmT.toFixed(1) + 'h PM, never logged)' : ''}` +
        ` | billed thisWk ${revBy[k + '|' + weekStart] != null ? $(revBy[k + '|' + weekStart]) : '—'} lastWk ${revBy[k + '|' + lastWeek] != null ? $(revBy[k + '|' + lastWeek]) : '—'}` +
        (r.billing_type === 'fixed' && msBy[k] ? ` | milestones ${msBy[k].rel}/${msBy[k].tot} released (${$(msBy[k].relAmt)} gross)` : '') +
        (e ? ` | est ${e.initial_hours}h init / ${e.remaining_hours}h remaining` : '')
    }).join('\n')

    const planLine = (r) => {
      const p = mapsRef.current.byId.get(String(r.project_id))
      return `- id:${r.id} | ${r.account} | ${DAYS[r.day]} ${mlab(r.start_min)}–${mlab(r.end_min)} | ${p ? p.channel : '?'} | ${r.status}` + (r.memo ? ` | memo: "${String(r.memo).slice(0, 60)}"` : '')
    }
    const livePlan = (plan.data || []).filter((r) => r.status !== 'dismissed')
    const planLines = livePlan.filter((r) => r.week_start === weekStart).map(planLine).join('\n') || '(empty — generate on the Week Suggestions page or add via plan_add)'
    const planLinesNext = livePlan.filter((r) => r.week_start === nextWeek).map(planLine).join('\n') || '(empty)'
    // per-CONTRACT load this week (caps are per contract, not per account):
    // confirmed mirrored hours + planned hours, per project, vs its weekly_cap_hours
    const loadByProj = {}
    ;(blocks.data || []).forEach((b) => { if (b.confirmed_project_id) { const k = String(b.confirmed_project_id); loadByProj[k] = (loadByProj[k] || 0) + (b.end_min - b.start_min) / 60 } })
    livePlan.filter((r) => r.week_start === weekStart).forEach((r) => { const k = String(r.project_id); loadByProj[k] = (loadByProj[k] || 0) + (r.end_min - r.start_min) / 60 })
    const capLine = Object.entries(loadByProj).map(([pid, h]) => {
      const p = mapsRef.current.byId.get(pid); if (!p) return null
      const cap = Number(p.weekly_cap_hours) || 0
      return `- ${p.channel}: ${h.toFixed(1)}h this week` + (cap > 0 ? ` / ${cap}h cap${h > cap ? ' ⚠ OVER — overflow must move to next week' : h > cap * 0.9 ? ' (near cap)' : ''}` : ' (no cap set)')
    }).filter(Boolean).join('\n') || '(no logging load yet this week)'

    const mirByAcct = { tc: { h: 0, c: 0 }, bc: { h: 0, c: 0 }, nn: { h: 0, c: 0 } }
    ;(blocks.data || []).forEach((b) => { const m = mirByAcct[b.account]; if (!m) return; const hh = (b.end_min - b.start_min) / 60; m.h += hh; if (b.confirmed_project_id) m.c += hh })
    const unmH = (unm.data || []).reduce((a, r) => a + Number(r.hours), 0)
    const chanOf = (pid) => { const p = mapsRef.current.byId.get(String(pid)); return p ? p.channel : '?' }
    const blockLines = (blocks.data || []).slice(0, 150).map((b) =>
      `- id:${b.id} | ${b.account} | ${DAYS[b.day]} ${mlab(b.start_min)}–${mlab(b.end_min)}` +
      (b.label ? ` | "${String(b.label).slice(0, 40)}"` : '') +
      (b.confirmed_project_id ? ` | ✓ ${chanOf(b.confirmed_project_id)}` :
        b.suggested_project_id ? ` | suggested ${chanOf(b.suggested_project_id)} (${b.suggestion_confidence})` : ' | unassigned')
    ).join('\n') || '(no mirrored blocks this week)'

    return `You are the FutureForge Ops assistant for Daniel (admin, agency owner). Today: ${isoDate(new Date())}. Current week (Mon): ${weekStart}.
Business model: 3 Upwork accounts (tc=Thiago, bc=Bernardo, nn=Nick). Dev hours come from timesheets (= cost side, devs paid hourly). Revenue: hourly projects = manually entered weekly billed GROSS amounts; fixed projects = released milestones. ALL revenue nets 10% Upwork fee (net = gross × 0.9). billing_rate is a reference quote, never auto-billed. "PM" hours = project-management time: internal cost only, never billed or logged on Upwork, and never suggested for logging. "Mirror" = hours actually logged on Upwork (read from screen). "Week plan" = suggested day/time slots still to log on Upwork this week (Week Suggestions page) — this is what plan_* tools edit. Mirrored blocks can be (re)assigned to projects with mirror_assign — confirmed mirror hours count as "already on Upwork" for that project. Plan slots carry an Upwork memo, HARD LIMIT 144 chars — never exceed it; split into multiple slots if needed.
IMPORTANT — Upwork weekly caps are PER CONTRACT (per project), not per account, and different contracts have different caps (projects.weekly_cap_hours; null = no cap known). When a contract's worked hours exceed what can be logged this week, the overflow is logged NEXT week on that same contract. When Daniel says hours must roll over (or a contract is at/over its cap in the CONTRACT LOAD section), move or create the overflow slots in NEXT week's plan: use plan_move/plan_add with week_start='${nextWeek}' (Mondays only: '${weekStart}' = current, '${nextWeek}' = next). Prefer moving the latest/lowest-priority slots of that contract. Never exceed a contract's cap in the current week unless told otherwise. The Week Suggestions page shows next week via the ▶ arrow. Times are 24h UTC, days Mon..Sun.
Rules for you: be concise and concrete; money in $ with gross/net stated. Use get_project_detail before deep claims about one project. Propose writes via tools ONE at a time with a one-line reason first; every write shows the user an approve/decline card. Use exact ids/channels from this snapshot — never invent them. If asked something the data can't answer, say so.

=== ACTIVE PROJECTS (lifetime + this week) ===
${projLines || '(none)'}

=== WEEK PLAN (current week, ${weekStart}) ===
${planLines}

=== WEEK PLAN (NEXT week, ${nextWeek}) ===
${planLinesNext}

=== CONTRACT LOAD vs WEEKLY CAPS (this week: mirrored confirmed + planned) ===
${capLine}

=== MIRROR (on Upwork, week of ${weekStart}) ===
tc ${mirByAcct.tc.h.toFixed(1)}h (${mirByAcct.tc.c.toFixed(1)} confirmed) · bc ${mirByAcct.bc.h.toFixed(1)}h (${mirByAcct.bc.c.toFixed(1)}) · nn ${mirByAcct.nn.h.toFixed(1)}h (${mirByAcct.nn.c.toFixed(1)})

=== MIRROR BLOCKS (id | acct | slot | memo | assignment) ===
${blockLines}

=== OTHER ===
Devs: ${(dv.data || []).filter((d) => d.active).map((d) => d.name + ' $' + d.hourly_cost + '/h').join(', ')}
Overhead dev hours this week: ${overheadH.toFixed(1)}h · Sync warnings: ${warn.count || 0} · Unmatched hours (all time): ${unmH.toFixed(1)}h`
  }

  // Mondays from the current week up to 4 weeks out
  function validWeek(w) {
    if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(w)) return null
    for (let i = 0; i <= 4; i++) if (plusDays(weekStart, i * 7) === w) return w
    return null
  }

  // ---- tool execution ----
  async function execTool(tu) {
    const i = tu.input || {}
    const ok = (s) => ({ type: 'tool_result', tool_use_id: tu.id, content: s })
    const fail = (s) => ({ type: 'tool_result', tool_use_id: tu.id, content: 'ERROR: ' + s, is_error: true })
    const proj = (ch) => mapsRef.current.byChannel.get(String(ch || '').trim().toLowerCase()) || mapsRef.current.byChannel.get(String(ch || '').trim())
    try {
      switch (tu.name) {
        case 'get_project_detail': {
          const p = proj(i.channel); if (!p) return fail('unknown channel ' + i.channel)
          const [rev, ms, es, he] = await Promise.all([
            supabase.from('project_week_revenue').select('week_start, amount').eq('project_id', p.id).order('week_start', { ascending: false }).limit(8),
            supabase.from('project_milestones').select('name, amount, released, position').eq('project_id', p.id).order('position'),
            supabase.from('project_estimates').select('*').eq('project_id', p.id).maybeSingle(),
            supabase.from('hours_entries').select('work_date, hours, dev_id, task').eq('project_id', p.id).gte('work_date', plusDays(weekStart, -14)).limit(2000),
          ])
          const byDate = {}, tasks = []
          ;(he.data || []).forEach((e) => {
            byDate[e.work_date] = (byDate[e.work_date] || 0) + Number(e.hours)
            if (e.task) String(e.task).split(' \u00b7 ').forEach((t) => { t = t.trim(); if (t && !tasks.includes(t)) tasks.push(t) })
          })
          return ok(JSON.stringify({ channel: p.channel, billing: p.billing_type, rate_ref: p.billing_rate, weekly_billed_gross: rev.data, milestones: ms.data, estimate: es.data, dev_hours_last_3wks_by_date: byDate, tasks_last_3wks: tasks.slice(0, 40) }))
        }
        case 'plan_add': {
          const p = proj(i.channel); if (!p) return fail('unknown channel ' + i.channel)
          const d = dayIdx(i.day); if (d < 0) return fail('bad day ' + i.day)
          const s = toMin(i.start), e = toMin(i.end)
          if (!(e > s) || isNaN(s) || isNaN(e)) return fail('bad time range')
          const ws = validWeek(i.week_start); if (i.week_start && !ws) return fail('week_start must be a Monday between ' + weekStart + ' and 4 weeks out')
          const memo = i.memo ? String(i.memo).slice(0, 144) : null
          const { data, error } = await supabase.from('week_log_plan').insert({ account: i.account, week_start: ws || weekStart, project_id: p.id, day: d, start_min: s, end_min: e, status: 'suggested', memo }).select('id').single()
          if (error) return fail(error.message)
          return ok('added plan slot id:' + data.id + ' (week of ' + (ws || weekStart) + ')')
        }
        case 'plan_move': {
          const d = dayIdx(i.day); if (d < 0) return fail('bad day ' + i.day)
          const s = toMin(i.start), e = toMin(i.end)
          if (!(e > s) || isNaN(s) || isNaN(e)) return fail('bad time range')
          const patch = { day: d, start_min: s, end_min: e }
          if (i.memo != null) patch.memo = String(i.memo).slice(0, 144)
          if (i.week_start) {
            const ws = validWeek(i.week_start); if (!ws) return fail('week_start must be a Monday between ' + weekStart + ' and 4 weeks out')
            patch.week_start = ws
          }
          const { error } = await supabase.from('week_log_plan').update(patch).eq('id', i.plan_id)
          return error ? fail(error.message) : ok('moved' + (i.week_start ? ' to week of ' + i.week_start : ''))
        }
        case 'plan_delete': {
          const { error } = await supabase.from('week_log_plan').delete().in('id', i.plan_ids || [])
          return error ? fail(error.message) : ok('deleted ' + (i.plan_ids || []).length + ' slot(s)')
        }
        case 'plan_mark_logged': {
          const { error } = await supabase.from('week_log_plan').update({ status: i.logged ? 'done' : 'suggested' }).in('id', i.plan_ids || [])
          return error ? fail(error.message) : ok('updated')
        }
        case 'set_week_billed': {
          const p = proj(i.channel); if (!p) return fail('unknown channel ' + i.channel)
          if (p.billing_type !== 'hourly') return fail(i.channel + ' is fixed-price — revenue comes from milestones')
          const amt = Number(i.amount); if (isNaN(amt) || amt < 0) return fail('bad amount')
          const { error } = await supabase.from('project_week_revenue').upsert({ project_id: p.id, week_start: i.week_start, amount: amt }, { onConflict: 'project_id,week_start' })
          return error ? fail(error.message) : ok('billed set: ' + i.channel + ' wk ' + i.week_start + ' = $' + amt.toFixed(2) + ' gross ($' + (amt * 0.9).toFixed(2) + ' net)')
        }
        case 'update_estimate': {
          const p = proj(i.channel); if (!p) return fail('unknown channel ' + i.channel)
          const { data: cur } = await supabase.from('project_estimates').select('*').eq('project_id', p.id).maybeSingle()
          const row = {
            project_id: p.id,
            initial_hours: i.initial_hours != null ? i.initial_hours : (cur?.initial_hours ?? 0),
            remaining_hours: i.remaining_hours != null ? i.remaining_hours : (cur?.remaining_hours ?? 0),
            notes: i.notes != null ? i.notes : (cur?.notes ?? ''),
            updated_by: session?.user?.email || 'assistant', updated_at: new Date().toISOString(),
          }
          const { error } = await supabase.from('project_estimates').upsert(row, { onConflict: 'project_id' })
          return error ? fail(error.message) : ok('estimate updated')
        }
        case 'mirror_assign': {
          let pid = null
          if (i.channel != null) { const p = proj(i.channel); if (!p) return fail('unknown channel ' + i.channel); pid = p.id }
          const { error } = await supabase.from('upwork_blocks').update({ confirmed_project_id: pid }).in('id', i.block_ids || [])
          return error ? fail(error.message) : ok((pid ? 'assigned ' : 'unassigned ') + (i.block_ids || []).length + ' block(s)')
        }
        default: return fail('unknown tool')
      }
    } catch (e) { return fail(e.message || 'tool failed') }
  }

  // ---- agent loop ----
  async function callAPI(msgs, system) {
    const key = localStorage.getItem('uhm_key')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, system, tools: TOOLS, messages: msgs }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message || data.error.type)
    return data
  }

  async function processQueue(state) {
    while (state.queue.length) {
      const tu = state.queue[0]
      if (WRITE_TOOLS.has(tu.name)) { loopRef.current = state; setConfirm(tu); return }
      const r = await execTool(tu)
      state.results.push(r); state.queue.shift()
    }
    const msgs = [...state.msgs, { role: 'user', content: state.results }]
    setMessages(msgs)
    await agentStep(msgs, state.system, state.depth + 1)
  }

  async function agentStep(msgs, system, depth = 0) {
    if (depth > 8) { setBusy(false); setErrs('Stopped: too many tool rounds.'); return }
    try {
      const resp = await callAPI(msgs, system)
      const next = [...msgs, { role: 'assistant', content: resp.content }]
      setMessages(next)
      const tus = resp.content.filter((b) => b.type === 'tool_use')
      if (!tus.length) { setBusy(false); return }
      await processQueue({ msgs: next, queue: [...tus], results: [], system, depth })
    } catch (e) {
      setBusy(false); setErrs('API error: ' + e.message)
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy || confirm) return
    setErrs(''); setInput(''); setBusy(true)
    const msgs = [...messages, { role: 'user', content: text }]
    setMessages(msgs)
    try {
      const system = await buildContext()
      await agentStep(msgs, system)
    } catch (e) { setBusy(false); setErrs('Couldn\u2019t load context: ' + e.message) }
  }

  async function decide(approved) {
    const state = loopRef.current
    if (!state || !confirm) return
    const tu = confirm
    setConfirm(null)
    const r = approved ? await execTool(tu) : { type: 'tool_result', tool_use_id: tu.id, content: 'User declined this action.' }
    state.results.push(r); state.queue.shift()
    await processQueue(state)
  }

  // ---- render helpers ----
  function resultFor(id) {
    for (const m of messages) {
      if (m.role !== 'user' || typeof m.content === 'string') continue
      const r = (m.content || []).find((b) => b.type === 'tool_result' && b.tool_use_id === id)
      if (r) return r
    }
    return null
  }

  if (!labs) return (
    <>
      <div className="pagehead"><h1>Assistant</h1></div>
      <div className="card"><div className="muted">No database connected.</div></div>
    </>
  )

  const starters = [
    'What still needs logging this week?',
    'Which projects look unprofitable right now?',
    'Did every hourly project get billed last week?',
  ]

  return (
    <>
      <div className="pagehead" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ marginRight: 'auto' }}>Assistant</h1>
        <button className="ghost" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={newChat}>+ New chat</button>
        <button className="ghost" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={() => setHistOpen(!histOpen)}>🕘 History</button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>knows your projects, hours, plan &amp; money · every change needs your approval · chats are saved</div>

      {histOpen && (
        <div className="card" style={{ marginBottom: 12, maxHeight: 260, overflowY: 'auto' }}>
          <div className="paneltitle">Past conversations</div>
          {chats.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No saved chats yet.</div>}
          {chats.map((c) => (
            <div key={c.id} className={'agrow' + (c.id === chatId ? ' donerow' : '')} style={{ cursor: 'pointer' }} onClick={() => openChat(c.id)}>
              <span className="agname" style={{ textDecoration: 'none' }}>{c.title}</span>
              <span className="agtime mono">{new Date(c.updated_at).toLocaleDateString()} {new Date(c.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <button className="ghost agbtn" onClick={(e) => deleteChat(c.id, e)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {!hasKey && (
        <div className="card bar">
          <div className="keyline">
            <span>Anthropic API key</span>
            <input type="password" placeholder="sk-ant-api03-…" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
            <button className="ghost" onClick={saveKey}>Save key</button>
            <span style={{ fontSize: 11.5, color: 'var(--mut)' }}>same key as the Mirror · stays in this browser</span>
          </div>
        </div>
      )}

      <div className="card chatcard">
        <div className="chatlog" ref={logRef}>
          {messages.length === 0 && (
            <div className="chatempty">
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Ask anything about the week, the plan, or the numbers — or try:</div>
              {starters.map((s) => (
                <button key={s} className="ghost" style={{ display: 'block', margin: '6px 0', fontSize: 12.5 }} onClick={() => setInput(s)}>{s}</button>
              ))}
            </div>
          )}
          {messages.map((m, mi) => {
            if (m.role === 'user' && typeof m.content === 'string')
              return <div key={mi} className="bubble me">{m.content}</div>
            if (m.role === 'assistant')
              return (m.content || []).map((b, bi) => {
                if (b.type === 'text' && b.text.trim()) return <div key={mi + '-' + bi} className="bubble ai">{b.text}</div>
                if (b.type === 'tool_use') {
                  const r = resultFor(b.id)
                  const declined = r && String(r.content).startsWith('User declined')
                  const failed = r && r.is_error
                  return (
                    <div key={mi + '-' + bi} className={'toolchip' + (failed ? ' bad' : declined ? ' off' : r ? ' okd' : '')}>
                      {WRITE_TOOLS.has(b.name) ? '✎ ' : '⌕ '}{toolSummary(b, mapsRef.current.byChannel)}
                      <span className="muted" style={{ marginLeft: 6, fontSize: 10.5 }}>
                        {failed ? 'failed' : declined ? 'declined' : r ? 'done' : 'pending'}
                      </span>
                    </div>
                  )
                }
                return null
              })
            return null
          })}
          {busy && !confirm && <div className="bubble ai muted">thinking…</div>}
          {confirm && (
            <div className="confirmcard">
              <div style={{ fontSize: 12, marginBottom: 8 }}><strong>Approve this change?</strong></div>
              <div className="mono" style={{ fontSize: 12, marginBottom: 10 }}>{toolSummary(confirm, mapsRef.current.byChannel)}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="primary" style={{ fontSize: 12.5 }} onClick={() => decide(true)}>Approve</button>
                <button className="ghost" style={{ fontSize: 12.5 }} onClick={() => decide(false)}>Decline</button>
              </div>
            </div>
          )}
          {errs && <div className="warn" style={{ fontSize: 12 }}>{errs}</div>}
        </div>
        <div className="chatbar">
          <input value={input} placeholder={hasKey ? 'Message the assistant…' : 'Add your API key above first'}
            disabled={!hasKey || Boolean(confirm)}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }} />
          <button className="primary" onClick={send} disabled={!hasKey || busy || Boolean(confirm) || !input.trim()}>Send</button>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Context is rebuilt from the database on every message. Conversations aren't saved — refresh starts fresh.
      </div>
    </>
  )
}
