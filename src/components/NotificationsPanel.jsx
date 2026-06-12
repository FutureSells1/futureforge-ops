import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, configured } from '../lib/supabase.js'

function ago(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000
  if (s < 90) return 'just now'
  if (s < 3600) return Math.round(s / 60) + 'm ago'
  if (s < 86400) return Math.round(s / 3600) + 'h ago'
  return Math.round(s / 86400) + 'd ago'
}
const ICONS = { warning: '⚠', compliance: '⚑', info: '·' }

export default function NotificationsPanel({ open, onClose, session, onRead }) {
  const [items, setItems] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open || !configured || !session) return
    ;(async () => {
      const { data: n } = await supabase.from('notifications').select('*')
        .order('created_at', { ascending: false }).limit(60)
      const ids = (n || []).map((x) => x.id)
      let readSet = new Set()
      if (ids.length) {
        const { data: r } = await supabase.from('notification_reads')
          .select('notification_id').eq('user_id', session.user.id).in('notification_id', ids)
        readSet = new Set((r || []).map((x) => x.notification_id))
      }
      setItems((n || []).map((x) => ({ ...x, read: readSet.has(x.id) })))
      // mark everything visible as read
      const unread = ids.filter((id) => !readSet.has(id))
      if (unread.length) {
        await supabase.from('notification_reads').upsert(
          unread.map((id) => ({ notification_id: id, user_id: session.user.id })),
          { onConflict: 'notification_id,user_id', ignoreDuplicates: true })
      }
      onRead && onRead()
    })()
  }, [open])

  if (!open) return null
  return (
    <>
      <div className="drawerback" onClick={onClose} />
      <div className="drawer">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2>Notifications</h2>
          <button className="ghost" style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12 }} onClick={onClose}>close</button>
        </div>
        {!items ? <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Loading…</div> :
          items.length === 0 ? <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Nothing yet — alerts from the hours sync land here.</div> :
          items.map((n) => (
            <div className={'notifitem' + (n.read ? '' : ' unread')} key={n.id}
              onClick={() => { if (n.link) { navigate(n.link); onClose() } }}
              style={{ cursor: n.link ? 'pointer' : 'default' }}>
              <div className="notiftop">
                <span className={'notificon ' + n.type}>{ICONS[n.type] || '·'}</span>
                <strong>{n.title}</strong>
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 10.5, flex: 'none' }}>{ago(n.created_at)}</span>
              </div>
              {n.body && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{n.body}</div>}
            </div>
          ))}
      </div>
    </>
  )
}
