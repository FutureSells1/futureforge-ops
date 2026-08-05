import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// configured = env vars are present. When false the app runs in
// "setup mode": pages render with guidance instead of crashing.
export const configured = Boolean(url && anonKey)

export const supabase = configured ? createClient(url, anonKey) : null

/**
 * Fetch every row of a query, paging past Supabase's per-request row cap
 * (1000). `build` must return a FRESH query builder on each call, and should
 * include a stable secondary .order() so pages don't overlap or skip rows.
 *   await fetchAll(() => supabase.from('t').select('*').eq('x', 1).order('id'))
 */
export async function fetchAll(build, page = 1000) {
  let out = []
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1)
    if (error) throw new Error(error.message)
    out = out.concat(data || [])
    if (!data || data.length < page) return out
    if (from > 200000) return out   // safety valve
  }
}
