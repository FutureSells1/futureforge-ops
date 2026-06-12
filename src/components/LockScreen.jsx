import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { bioUnlock, bioDisable } from '../lib/biolock.js'

export default function LockScreen({ onUnlocked }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function tryUnlock() {
    setBusy(true); setErr('')
    try { await bioUnlock(); onUnlocked() }
    catch { setErr('Couldn\u2019t verify — try again.') }
    setBusy(false)
  }
  useEffect(() => { tryUnlock() }, []) // prompt immediately on open

  return (
    <div className="lockscreen">
      <div className="brand" style={{ fontSize: 19 }}>Future<span className="forge">Forge</span> Ops</div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="lockicon">
        <path d="M7 8.5C7 7 7.5 4 12 4s5 3 5 4.5M8.5 11c.8-.9 2-1.5 3.5-1.5s2.7.6 3.5 1.5M12 12.5v3M9 18.5c.8.9 1.8 1.5 3 1.5s2.2-.6 3-1.5"/>
        <rect x="2.5" y="2.5" width="5" height="5" rx="1.5" opacity=".25"/><rect x="16.5" y="2.5" width="5" height="5" rx="1.5" opacity=".25"/>
        <rect x="2.5" y="16.5" width="5" height="5" rx="1.5" opacity=".25"/><rect x="16.5" y="16.5" width="5" height="5" rx="1.5" opacity=".25"/>
      </svg>
      <button className="primary" onClick={tryUnlock} disabled={busy} style={{ minWidth: 200, justifyContent: 'center' }}>
        {busy ? 'Verifying…' : 'Unlock with Face ID'}
      </button>
      {err && <div className="warn" style={{ fontSize: 12.5 }}>{err}</div>}
      <button className="ghost" style={{ fontSize: 12 }}
        onClick={() => { bioDisable(); supabase.auth.signOut(); location.reload() }}>
        Sign in with password instead
      </button>
    </div>
  )
}
