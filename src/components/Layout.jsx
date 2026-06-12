import React, { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'
import WarningsDrawer from './WarningsDrawer.jsx'

const I = {
  dash: <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>,
  proj: <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>,
  team: <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3 2.9-4.7 5.5-4.7s4.9 1.7 5.5 4.7"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.6c2.2.2 4 1.6 4.5 4"/></svg>,
  mirror: <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>,
}

function pageTitle(pathname) {
  if (pathname === '/') return 'Dashboard'
  if (pathname.startsWith('/projects/')) return 'Project'
  if (pathname === '/projects') return 'Projects'
  if (pathname === '/team') return 'Team'
  if (pathname === '/mirror') return 'Hours Mirror'
  return ''
}

const isMobile = () => window.matchMedia('(max-width: 760px)').matches

export default function Layout({ session, isAdmin }) {
  const [drawer, setDrawer] = useState(false)
  const [warnCount, setWarnCount] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchStart = useRef(null)
  const location = useLocation()

  const links = [
    { to: '/', label: 'Dashboard', end: true, icon: I.dash },
    { to: '/projects', label: 'Projects', icon: I.proj },
    ...(isAdmin ? [
      { to: '/team', label: 'Team', icon: I.team },
      { to: '/mirror', label: 'Hours Mirror', short: 'Mirror', icon: I.mirror },
    ] : []),
  ]

  useEffect(() => {
    if (!configured || !isAdmin) return
    Promise.all([
      supabase.from('sync_warnings').select('id', { count: 'exact', head: true }),
      supabase.from('unmatched_hours').select('id', { count: 'exact', head: true }),
    ]).then(([a, b]) => setWarnCount((a.count || 0) + (b.count || 0)))
  }, [drawer, isAdmin])

  // iOS large-title feel: nav title fades in once the page header scrolls away
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 34)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // native-style: each screen starts at the top
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])

  // pull-to-refresh (mobile only)
  function onTouchStart(e) {
    if (!isMobile() || window.scrollY > 0 || refreshing) { touchStart.current = null; return }
    touchStart.current = e.touches[0].clientY
  }
  function onTouchMove(e) {
    if (touchStart.current == null) return
    const dy = e.touches[0].clientY - touchStart.current
    if (dy > 0 && window.scrollY <= 0) setPull(Math.min(dy * 0.45, 86))
    else setPull(0)
  }
  function onTouchEnd() {
    if (pull > 62) {
      setRefreshing(true)
      setPull(56)
      setTimeout(() => window.location.reload(), 350)
    } else setPull(0)
    touchStart.current = null
  }

  return (
    <div className="shell">
      {/* mobile top bar */}
      <div className="mtopbar">
        <div className="brand" style={{ fontSize: 15, opacity: scrolled ? 0 : 1, transition: 'opacity .18s' }}>
          Future<span className="forge">Forge</span> Ops
        </div>
        <div className={'mtop-title' + (scrolled ? ' show' : '')}>{pageTitle(location.pathname)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isAdmin && (
            <button className="ghost mtop-btn" onClick={() => setDrawer(true)}>
              ⚠{warnCount > 0 && <span className="badge">{warnCount}</span>}
            </button>
          )}
          {configured && session && (
            <button className="ghost mtop-btn" onClick={() => supabase.auth.signOut()} title="Sign out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* pull-to-refresh spinner */}
      <div className="ptr" style={{ opacity: Math.min(pull / 62, 1), transform: 'translateX(-50%) translateY(' + (pull - 40) + 'px) rotate(' + pull * 3 + 'deg)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={refreshing ? 'spin' : ''}>
          <path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>
        </svg>
      </div>

      {/* desktop sidebar */}
      <aside className="sidebar">
        <div className="brand">Future<span className="forge">Forge</span> Ops</div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
            <span className="ndot" />{l.label}
          </NavLink>
        ))}
        {isAdmin && (
          <button className="warnbtn" onClick={() => setDrawer(true)}>
            ⚠ Warnings
            {warnCount > 0 && <span className="badge">{warnCount}</span>}
          </button>
        )}
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

      <main className="main" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={pull > 0 ? { transform: 'translateY(' + pull + 'px)', transition: refreshing ? 'transform .25s' : 'none' } : { transition: 'transform .3s cubic-bezier(.2,.9,.3,1.2)' }}>
        <div key={location.pathname} className="pagein">
          <Outlet context={{ isAdmin, session }} />
        </div>
      </main>

      {/* mobile bottom tabs */}
      <nav className="bottomnav">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => 'bnav-item' + (isActive ? ' active' : '')}>
            {l.icon}
            <span>{l.short || l.label}</span>
          </NavLink>
        ))}
      </nav>

      {isAdmin && <WarningsDrawer open={drawer} onClose={() => setDrawer(false)} />}
    </div>
  )
}
