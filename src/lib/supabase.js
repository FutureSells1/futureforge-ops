import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// configured = env vars are present. When false the app runs in
// "setup mode": pages render with guidance instead of crashing.
export const configured = Boolean(url && anonKey)

export const supabase = configured ? createClient(url, anonKey) : null
