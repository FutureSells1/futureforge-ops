// Web Push subscribe/unsubscribe. Works on iOS 16.4+ ONLY when the
// app is installed to the Home Screen; Android/desktop work in-browser too.
import { supabase } from './supabase.js'

const VAPID_PUBLIC_KEY = 'BCC3fd3C1urswQxVxze6--YnUa_T7GD4QxLlmPR_-KaBz0qdlEK-Y4LRMxRtFSCjNd_YlV4qbHFOBR-6i-75WD0'

function urlB64ToUint8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

// iOS only exposes push inside the installed (home-screen) app
export const pushBlockedByIOS = () => isIOS() && !isStandalone()

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null
  try { return await navigator.serviceWorker.register('/sw.js') } catch { return null }
}

export async function pushEnabled() {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg && (await reg.pushManager.getSubscription())
  return !!sub && Notification.permission === 'granted'
}

export async function pushSubscribe(userId) {
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerSW())
  if (!reg) throw new Error('no-sw')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('denied')
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY),
  })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    ua: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function pushUnsubscribe() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg && (await reg.pushManager.getSubscription())
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
}
