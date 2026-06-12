// Face ID / Touch ID app lock — a local screen lock on top of the
// existing Supabase session (the banking-app pattern). Uses a
// platform passkey purely as a biometric gate; auth itself is
// unchanged. Per-device, stored in localStorage.
const KEY = 'ff_biolock_cred'
const UNLOCKED = 'ff_unlocked'

export const bioSupported = () =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials

export const bioEnabled = () => !!localStorage.getItem(KEY)
export const bioLocked = () => bioEnabled() && sessionStorage.getItem(UNLOCKED) !== '1'

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export async function bioEnable(email) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'FutureForge Ops', id: location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: email || 'team', displayName: email || 'team',
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  })
  localStorage.setItem(KEY, b64(cred.rawId))
  sessionStorage.setItem(UNLOCKED, '1')
}

export function bioDisable() {
  localStorage.removeItem(KEY)
  sessionStorage.removeItem(UNLOCKED)
}

export async function bioUnlock() {
  const id = localStorage.getItem(KEY)
  if (!id) return true
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: unb64(id), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  })
  sessionStorage.setItem(UNLOCKED, '1')
  return true
}
