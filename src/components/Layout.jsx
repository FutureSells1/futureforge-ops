import React, { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'
import WarningsDrawer from './WarningsDrawer.jsx'
import NotificationsPanel from './NotificationsPanel.jsx'
import SettingsSheet from './SettingsSheet.jsx'
import { bioSupported, bioEnabled, bioEnable, bioDisable } from '../lib/biolock.js'
import { labsEnabled } from '../lib/labs.js'

const I = {
  dash: <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>,
  proj: <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>,
  team: <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3 2.9-4.7 5.5-4.7s4.9 1.7 5.5 4.7"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.6c2.2.2 4 1.6 4.5 4"/></svg>,
  mirror: <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>,
  plan: <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4M7 13h3M7 17h3M14 13h3"/></svg>,
  bell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 17, height: 17 }}><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6M10.3 20a2 2 0 0 0 3.4 0"/></svg>,
  gear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 17, height: 17 }}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z"/></svg>,
}

function pageTitle(pathname) {
  if (pathname === '/') return 'Dashboard'
  if (pathname.startsWith('/projects/')) return 'Project'
  if (pathname === '/projects') return 'Projects'
  if (pathname === '/team') return 'Team'
  if (pathname === '/mirror') return 'Hours Mirror'
  if (pathname === '/suggestions') return 'Week Suggestions'
  return ''
}

const isMobile = () => window.matchMedia('(max-width: 760px)').matches

export default function Layout({ session, isAdmin }) {
  const [drawer, setDrawer] = useState(false)
  const [warnCount, setWarnCount] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [bio, setBio] = useState(bioEnabled())
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
      ...(labsEnabled() ? [{ to: '/suggestions', label: 'Week Suggestions', short: 'Plan', icon: I.plan }] : []),
    ] : []),
  ]

  async function loadUnread() {
    if (!configured || !session) return
    const { data: n } = await supabase.from('notifications').select('id').order('created_at', { ascending: false }).limit(100)
    const ids = (n || []).map((x) => x.id)
    if (!ids.length) { setUnread(0); return }
    const { data: r } = await supabase.from('notification_reads')
      .select('notification_id').eq('user_id', session.user.id).in('notification_id', ids)
    setUnread(ids.length - (r || []).length)
  }
  useEffect(() => {
    if (!configured || !session) return
    loadUnread()
    const ch = supabase.channel('notif-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => loadUnread())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [session])

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
          {configured && session && (
            <button className="ghost mtop-btn" onClick={() => setNotifOpen(true)}>
              {I.bell}{unread > 0 && <span className="badge">{unread}</span>}
            </button>
          )}
          {configured && session && (
            <button className="ghost mtop-btn" onClick={() => setSheetOpen(true)} title="Settings">
              {I.gear}
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
        {configured && session && (
          <button className="warnbtn" onClick={() => setNotifOpen(true)}>
            {I.bell} Notifications
            {unread > 0 && <span className="badge">{unread}</span>}
          </button>
        )}
        {configured && session && (
          <button className="warnbtn" onClick={() => setSheetOpen(true)}>
            {I.gear} Settings
          </button>
        )}
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
              {bioSupported() && (
                <button className="ghost" style={{ padding: '4px 10px', fontSize: 11.5, marginBottom: 6, display: 'block' }}
                  onClick={async () => {
                    try {
                      if (bio) { bioDisable(); setBio(false) }
                      else { await bioEnable(session.user.email); setBio(true) }
                    } catch {}
                  }}>
                  {bio ? '🔒 Biometric lock on' : 'Enable biometric lock'}
                </button>
              )}
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
      <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} session={session} onRead={() => setUnread(0)} />
      <SettingsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} session={session} isAdmin={isAdmin}
        onOpenWarnings={() => setDrawer(true)} warnCount={warnCount} />
    </div>
  )
}
