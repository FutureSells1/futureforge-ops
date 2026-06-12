import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase, configured } from './lib/supabase.js'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Projects from './pages/Projects.jsx'
import ProjectDetail from './pages/ProjectDetail.jsx'
import HoursMirror from './pages/HoursMirror.jsx'
import WeekSuggestions from './pages/WeekSuggestions.jsx'
import Assistant from './pages/Assistant.jsx'
import Team from './pages/Team.jsx'
import LockScreen from './components/LockScreen.jsx'
import { bioLocked } from './lib/biolock.js'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [locked, setLocked] = useState(bioLocked())
  const [role, setRole] = useState(null)            // 'admin' | 'dev' | null = loading

  useEffect(() => {
    if (!configured) { setSession(null); setRole('admin'); return } // setup mode: show everything
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!configured || !session) return
    supabase.from('app_roles').select('role').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => setRole(data?.role === 'admin' ? 'admin' : 'dev')) // no row -> dev (safe default)
  }, [session])

  if (session === undefined) return null
  const authed = !configured || Boolean(session)
  if (!authed) return <Login />
  if (configured && session && role === null) return null // brief role load
  if (configured && session && locked) return <LockScreen onUnlocked={() => setLocked(false)} />

  const isAdmin = role === 'admin'

  return (
    <Routes>
      <Route element={<Layout session={session} isAdmin={isAdmin} />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        {isAdmin && <Route path="/team" element={<Team />} />}
        {isAdmin && <Route path="/mirror" element={<HoursMirror />} />}
        {isAdmin && <Route path="/suggestions" element={<WeekSuggestions />} />}
        {isAdmin && <Route path="/assistant" element={<Assistant />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
