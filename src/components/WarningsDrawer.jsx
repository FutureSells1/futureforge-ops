import React, { useEffect, useState } from 'react'
import { supabase, configured } from '../lib/supabase.js'
import { hrs } from '../lib/format.js'

export default function WarningsDrawer({ open, onClose }) {
  const [warnings, setWarnings] = useState([])
  const [unmatched, setUnmatched] = useState([])

  function load() {
    supabase.from('sync_warnings').select('*').order('week_start', { ascending: false })
      .then(({ data }) => setWarnings(data || []))
    supabase.from('unmatched_hours').select('*').limit(100)
      .then(({ data }) => setUnmatched(data || []))
  }
  useEffect(() => { if (open && configured) load() }, [open])

  async function dismissWarning(id) {
    await supabase.from('sync_warnings').delete().eq('id', id)
    load()
  }

  if (!open) return null

  return (
    <>
      <div className="drawerback" onClick={onClose} />
      <div className="drawer">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2>Data warnings</h2>
          <button className="ghost" style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12 }} onClick={onClose}>close</button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Fix issues in the source spreadsheet — they clear on the next sync.</div>

        <div className="sect">Sync warnings · sheet total ≠ synced</div>
        {warnings.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>None — every sheet reconciles. 🎉</div>}
        {warnings.map((w) => (
          <div className="witem" key={w.id}>
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <span><strong>{w.dev_name}</strong> · week of <span className="mono">{w.week_start}</span></span>
              <button className="ghost" style={{ marginLeft: 'auto', padding: '1px 8px', fontSize: 11 }}
                onClick={() => dismissWarning(w.id)}>dismiss</button>
            </div>
            <div style={{ marginTop: 4 }}>
              sheet <span className="mono">{Number(w.sheet_total).toFixed(2)}h</span> · synced{' '}
              <span className="mono">{Number(w.synced_total).toFixed(2)}h</span>
              {Number(w.excluded_total) > 0 && <> · non-project <span className="mono">{Number(w.excluded_total).toFixed(2)}h</span></>}
            </div>
            <div style={{ marginTop: 4, fontSize: 12 }}>{w.detail}</div>
          </div>
        ))}

        <div className="sect">Unmatched hours · key doesn't match any project</div>
        {unmatched.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>None — all hours are linked to projects.</div>}
        {unmatched.map((u) => (
          <div className="witem" key={u.id}>
            <strong>{u.dev}</strong> · <span className="mono">{u.work_date}</span> · {hrs(u.hours)}
            <div style={{ marginTop: 4 }}>key: <span className="mono">{u.raw_key}</span></div>
          </div>
        ))}
      </div>
    </>
  )
}
