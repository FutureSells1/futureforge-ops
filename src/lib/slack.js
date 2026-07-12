// Posts a message to Slack via the slack-post Edge Function.
// Needs VITE_SUPABASE_URL and VITE_APP_SHARED_SECRET in the app env.
const FN_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1/slack-post'
const SECRET = import.meta.env.VITE_APP_SHARED_SECRET

export async function postToSlack({ channel, text, blocks }) {
  if (!SECRET) return { ok: false, error: 'VITE_APP_SHARED_SECRET not set in the app environment' }
  try {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-secret': SECRET },
      body: JSON.stringify({ channel, text, blocks }),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, error: e.message || 'network error' }
  }
}
