"use client"

import { createContext, useCallback, useContext } from "react"

/**
 * Board stills -> their ~40KB library thumbnails (object key -> URL), sent with
 * the board. Cards, posters and strips show the thumbnail; the full-size
 * still (2-20MB) only loads where it is shown big (the animatic, Open full size).
 */
export const StillThumbs = createContext<Map<string, string>>(new Map())
export const stillKeyOf = (u: string) => { try { return decodeURIComponent(new URL(u).pathname.slice(1)) } catch { return u } }
export const thumbFrom = (m: Map<string, string>, u: string | null | undefined) => (u ? m.get(stillKeyOf(u)) ?? u : undefined)
export function useThumb() {
  const m = useContext(StillThumbs)
  return useCallback((u: string | null | undefined) => thumbFrom(m, u), [m])
}
/** New pairs from a board GET merged in - the same Map back when nothing changed, so no re-render. */
export function mergeThumbs(prev: Map<string, string>, pairs: unknown): Map<string, string> {
  if (!Array.isArray(pairs)) return prev
  let next: Map<string, string> | null = null
  for (const p of pairs) {
    if (!Array.isArray(p) || typeof p[0] !== "string" || typeof p[1] !== "string") continue
    // A re-signed thumbnail is the same file - compare by key, not by URL
    const had = prev.get(p[0])
    if (had && stillKeyOf(had) === stillKeyOf(p[1])) continue
    next ??= new Map(prev)
    next.set(p[0], p[1])
  }
  return next ?? prev
}

/**
 * Add thumbnails the page learned since the board loaded (an asset pulled in
 * from My Assets brings its pictures' thumbnails along) - without it those
 * pictures drew full-size until the next reload.
 */
export const AddStillThumbs = createContext<(pairs: [string, string][]) => void>(() => {})
