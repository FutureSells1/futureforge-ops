import React, { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div className="loginwrap">
      <div className="card loginbox">
        <h1>Future<span style={{ color: 'var(--tc)' }}>Forge</span> Ops</h1>
        <div className="muted" style={{ fontSize: 13 }}>Sign in with your team account</div>
        <form onSubmit={submit}>
          <input type="email" placeholder="email" value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <input type="password" placeholder="password" value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          {err && <div className="warn" style={{ fontSize: 12.5 }}>{err}</div>}
          <button className="primary" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
          Accounts are created by an admin in the Supabase dashboard — there is no self-signup.
        </div>
      </div>
    </div>
  )
}
