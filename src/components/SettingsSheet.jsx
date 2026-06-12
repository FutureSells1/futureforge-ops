import React, { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { bioSupported, bioEnabled, bioEnable, bioDisable } from '../lib/biolock.js'
import { pushSupported, pushEnabled, pushSubscribe, pushUnsubscribe, pushBlockedByIOS } from '../lib/push.js'
import { labsEnabled, setLabs } from '../lib/labs.js'

export default function SettingsSheet({ open, onClose, session, isAdmin, onOpenWarnings, warnCount }) {
  const [bio, setBio] = useState(bioEnabled())
  const [err, setErr] = useState('')
  const [push, setPush] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [labs, setLabsState] = useState(labsEnabled())

  React.useEffect(() => { if (open) pushEnabled().then(setPush) }, [open])

  async function togglePush() {
    setErr(''); setPushBusy(true)
    try {
      if (push) { await pushUnsubscribe(); setPush(false) }
      else { await pushSubscribe(session.user.id); setPush(true) }
    } catch (e) {
      setErr(e.message === 'denied'
        ? 'Notifications are blocked for this app — allow them in iOS Settings → Notifications.'
        : 'Couldn’t enable push on this device.')
    }
    setPushBusy(false)
  }

  async function sendTest() {
    setTestMsg('sending…')
    const { error } = await supabase.from('notifications').insert({
      audience: 'admins', type: 'info', title: 'Test notification',
      body: 'Push pipeline is working 🎉', link: '/',
    })
    setTestMsg(error ? 'failed: ' + error.message : 'sent — check your lock screen in a few seconds')
  }

  async function toggleBio() {
    setErr('')
    try {
      if (bio) { bioDisable(); setBio(false) }
      else { await bioEnable(session?.user?.email); setBio(true) }
    } catch {
      setErr('Face ID setup was cancelled or isn\u2019t available on this device.')
    }
  }

  if (!open) return null
  return (
    <>
      <div className="drawerback" onClick={onClose} />
      <div className="sheet">
        <div className="sheetgrab" />
        <div className="muted" style={{ fontSize: 12, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {session?.user?.email}
        </div>
        {bioSupported() && (
          <button className="sheetrow" onClick={toggleBio}>
            <span>Face ID lock</span>
            <span className={'switch' + (bio ? ' on' : '')}><span className="knob" /></span>
          </button>
        )}
        {pushSupported() && !pushBlockedByIOS() && (
          <button className="sheetrow" onClick={togglePush} disabled={pushBusy}>
            <span>Push notifications</span>
            <span className={'switch' + (push ? ' on' : '')}><span className="knob" /></span>
          </button>
        )}
        {pushBlockedByIOS() && (
          <div className="muted" style={{ fontSize: 11.5, padding: '2px 4px 8px' }}>
            Push notifications: add this app to your Home Screen first (Share → Add to Home Screen), then enable here inside the installed app.
          </div>
        )}
        {err && <div className="warn" style={{ fontSize: 11.5, padding: '0 4px 6px' }}>{err}</div>}
        {isAdmin && push && (
          <button className="sheetrow" onClick={sendTest}>
            <span>Send test notification</span>
            {testMsg && <span className="muted" style={{ fontSize: 10.5 }}>{testMsg}</span>}
          </button>
        )}
        {isAdmin && (
          <>
            <button className="sheetrow" onClick={() => { setLabs(!labs); setLabsState(!labs) }}>
              <span>🧪 Labs (beta features)</span>
              <span className={'switch' + (labs ? ' on' : '')}><span className="knob" /></span>
            </button>
            {labs && (
              <div className="muted" style={{ fontSize: 11.5, padding: '2px 4px 8px' }}>
                Mirror suggestions &amp; week summary are on — this device only. Reopen the Mirror page to apply.
              </div>
            )}
          </>
        )}
        {isAdmin && (
          <button className="sheetrow" onClick={() => { onClose(); onOpenWarnings() }}>
            <span>⚠ Data warnings</span>
            {warnCount > 0 && <span className="badge" style={{ position: 'static' }}>{warnCount}</span>}
          </button>
        )}
        <button className="sheetrow danger" onClick={() => supabase.auth.signOut()}>Sign out</button>
        <button className="ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={onClose}>Done</button>
      </div>
    </>
  )
}
