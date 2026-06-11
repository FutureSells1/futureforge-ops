import React, { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'
import { ACCOUNTS, COLORS, money } from '../lib/format.js'

export default function Projects() {
  const { isAdmin } = useOutletContext()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [newChannel, setNewChannel] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  async function load() {
    const { data, error } = await supabase.from('projects').select('*')
      .order('created_at', { ascending: false })
    if (error) setErr(error.message); else setRows(data)
  }
  useEffect(() => { if (configured) load() }, [])

  async function addProject(e) {
    e.preventDefault()
    const channel = newChannel.trim().toLowerCase()
    if (!/^(tc|bc|nn)-[a-z0-9]+(-[a-z0-9-]+)?$/.test(channel)) {
      setErr('Channel must look like tc-ct-ocf (account-client-project).'); return
    }
    setErr('')
    const { error } = await supabase.from('projects').insert({ channel })
    if (error) setErr(error.message)
    else { setNewChannel(''); load() }
  }

  async function update(id, patch) {
    const { error } = await supabase.from('projects').update(patch).eq('id', id)
    if (error) setErr(error.message); else load()
  }

  async function syncNow() {
    const url = import.meta.env.VITE_SYNC_URL
    if (!url) { setSyncMsg('VITE_SYNC_URL not configured — see README/Vercel env vars.'); return }
    setSyncing(true); setSyncMsg('Syncing all dev sheets — this can take a minute or two…')
    try {
      const res = await fetch(url)
      const data = await res.json()
      if (data.ok) {
        setSyncMsg('Synced in ' + data.took_seconds + 's · ' + new Date().toLocaleTimeString())
        load()
      } else setSyncMsg('Sync error: ' + (data.error || 'unknown'))
    } catch {
      // CORS/redirect quirks can hide the response even when the sync ran
      setSyncMsg('Sync triggered — give it a minute, then refresh.')
    } finally { setSyncing(false) }
  }

  async function deleteProject(p) {
    if (!window.confirm('Delete ' + p.channel + ' permanently? This cannot be undone.')) return
    const { error } = await supabase.from('projects').delete().eq('id', p.id)
    if (error) {
      if (error.code === '23503') {
        setErr(p.channel + ' has hours logged against it, so it can\'t be deleted (that would orphan the hours). Archive it instead.')
      } else setErr(error.message)
    } else load()
  }

  if (!configured) return (
    <>
      <Head />
      <div className="notice">
        Connect Supabase first (see README). Once connected, this page lists every project channel —
        new Slack channels land here automatically through the Zapier zap, and quoted revenue is
        edited inline.
      </div>
    </>
  )

  return (
    <>
      <Head />
      {isAdmin && <div className="bar" style={{ marginBottom: 10 }}>
        <button className={syncing ? 'live' : 'ghost'} onClick={syncNow} disabled={syncing}>
          {syncing ? '⟳ Syncing…' : '⟳ Sync hours now'}
        </button>
        {syncMsg && <span className="muted" style={{ fontSize: 12.5 }}>{syncMsg}</span>}
      </div>}
      {isAdmin && <div className="card bar">
        <form onSubmit={addProject} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="mono" placeholder="tc-ct-ocf" value={newChannel}
            onChange={(e) => setNewChannel(e.target.value)} style={{ width: 180 }} />
          <button className="ghost" type="submit">Add project</button>
          <span className="muted" style={{ fontSize: 12 }}>manual fallback — the Zap adds new channels automatically</span>
        </form>
      </div>}
      {err && <div className="statusline warn">{err}</div>}
      <div className="card">
        {!rows ? <div className="muted">Loading…</div> : rows.length === 0 ? (
          <div className="notice">No projects yet — add one above or wait for the Zap to deliver the first Slack channel.</div>
        ) : (
          <table className="data">
            <thead><tr>
              <th>Channel</th><th>Account</th><th>Client name</th><th>Display name</th>
              {isAdmin && <><th className="num">Quoted revenue</th><th>Actions</th></>}
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} style={p.status === 'archived' ? { opacity: .45 } : null}>
                  <td className="mono"><Link to={'/projects/' + p.id} style={{ textDecoration: 'underline', textDecorationColor: 'var(--line2)' }}>{p.channel}</Link></td>
                  <td><span className="pill"><span className="swatch" style={{ background: COLORS[p.account] }} />{ACCOUNTS[p.account]}</span></td>
                  {isAdmin ? <>
                    <td><InlineText value={p.client_name} onSave={(v) => update(p.id, { client_name: v })} placeholder="e.g. Caio Tralba" /></td>
                    <td><InlineText value={p.display_name} onSave={(v) => update(p.id, { display_name: v })} placeholder="e.g. Webflow Website" /></td>
                    <td className="num"><InlineMoney value={p.quoted_revenue} onSave={(v) => update(p.id, { quoted_revenue: v })} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                        onClick={() => update(p.id, { status: p.status === 'active' ? 'archived' : 'active' })}>
                        {p.status === 'active' ? 'archive' : 'restore'}
                      </button>
                      <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5, marginLeft: 6, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        onClick={() => deleteProject(p)}>
                        delete
                      </button>
                    </td>
                  </> : <>
                    <td>{p.client_name || '—'}</td>
                    <td>{p.display_name || '—'}</td>
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
      <h1>Projects</h1>
      <span className="sub">one row per Slack channel · account-client-project</span>
    </div>
  )
}

function InlineText({ value, onSave, placeholder }) {
  const [v, setV] = useState(value || '')
  useEffect(() => setV(value || ''), [value])
  return (
    <input value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== (value || '')) onSave(v || null) }}
      style={{ background: 'transparent', border: '1px solid transparent', padding: '3px 6px', width: '100%', minWidth: 120 }}
      onFocus={(e) => (e.target.style.borderColor = 'var(--line2)')}
    />
  )
}

function InlineMoney({ value, onSave }) {
  const [v, setV] = useState(value ?? 0)
  useEffect(() => setV(value ?? 0), [value])
  return (
    <input type="number" className="mono" value={v} min="0" step="50"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (Number(v) !== Number(value)) onSave(Number(v) || 0) }}
      style={{ background: 'transparent', border: '1px solid transparent', padding: '3px 6px', width: 110, textAlign: 'right' }}
      onFocus={(e) => (e.target.style.borderColor = 'var(--line2)')}
      title={money(value)}
    />
  )
}
