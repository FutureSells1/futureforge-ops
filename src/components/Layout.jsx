import React, { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'
import WarningsDrawer from './WarningsDrawer.jsx'

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/projects', label: 'Projects' },
  { to: '/mirror', label: 'Hours Mirror' },
]

export default function Layout({ session }) {
  const [drawer, setDrawer] = useState(false)
  const [warnCount, setWarnCount] = useState(0)

  useEffect(() => {
    if (!configured) return
    Promise.all([
      supabase.from('sync_warnings').select('id', { count: 'exact', head: true }),
      supabase.from('unmatched_hours').select('id', { count: 'exact', head: true }),
    ]).then(([a, b]) => setWarnCount((a.count || 0) + (b.count || 0)))
  }, [drawer]) // refresh count whenever the drawer toggles

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Future<span className="forge">Forge</span> Ops</div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
            <span className="ndot" />{l.label}
          </NavLink>
        ))}
        <button className="warnbtn" onClick={() => setDrawer(true)}>
          ⚠ Warnings
          {warnCount > 0 && <span className="badge">{warnCount}</span>}
        </button>
        <div className="foot">
          {configured && session ? (
            <>
              <div style={{ marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user.email}</div>
              <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => supabase.auth.signOut()}>Sign out</button>
            </>
          ) : (
            <span>setup mode — no database connected</span>
          )}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <WarningsDrawer open={drawer} onClose={() => setDrawer(false)} />
    </div>
  )
}
