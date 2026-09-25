/*
 * Shared data layer for the home page's My Generations card (the masonry
 * wall) and its fullscreen slideshow. Both draw from /api/user/highlights,
 * which samples the user's whole history weighted toward 4-5 star ratings,
 * and both honour the same "don't show here" list.
 */

export interface Highlight {
  id: number
  imageUrl: string
  thumbnailUrl: string | null
  videoThumbnailUrl: string | null
  isVideo: boolean
  score: number | null
}

/** A highlight that has preloaded, with its real shape. */
export type Tile = {
  /** Unique per appearance: the same image can come round again later. */
  key: string
  id: number
  /** Small, for the wall. */
  thumb: string
  /** Full size (or the video itself), for the slideshow. */
  full: string
  isVideo: boolean
  aspect: number
  score: number | null
}

/** mix = half favourites, half anything; fav = 4-5 stars only; all = uniform. */
export type HighlightSource = "mix" | "fav" | "all"

let tileSeq = 0

const thumbOf = (h: Highlight) =>
  h.thumbnailUrl || h.videoThumbnailUrl || (h.isVideo ? null : `/api/images/${h.id}?thumb=1`)

export async function fetchHighlights(n: number, source: HighlightSource = "mix"): Promise<{ items: Highlight[]; hiddenCount: number }> {
  const r = await fetch(`/api/user/highlights?n=${n}&source=${source}`, { cache: "no-store" })
  const d = r.ok ? await r.json() : null
  return { items: d?.items ?? [], hiddenCount: d?.hiddenCount ?? 0 }
}

/** Preload one thumbnail and read its real shape; null if it will not draw. */
export function loadTile(h: Highlight): Promise<Tile | null> {
  const thumb = thumbOf(h)
  if (!thumb) return Promise.resolve(null)
  return new Promise(resolve => {
    const img = new Image()
    const t = setTimeout(() => resolve(null), 10000)
    img.onload = () => {
      clearTimeout(t)
      const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0
      if (!(aspect > 0)) return resolve(null)
      resolve({
        key: `t${++tileSeq}`,
        id: h.id,
        thumb,
        full: h.imageUrl || thumb,
        isVideo: h.isVideo,
        // Clamp freak shapes (a 1px strip) so they cannot wreck a layout.
        aspect: Math.min(Math.max(aspect, 0.4), 3),
        score: h.score,
      })
    }
    img.onerror = () => { clearTimeout(t); resolve(null) }
    img.src = thumb
  })
}

export async function loadTiles(n: number, source: HighlightSource = "mix") {
  const { items, hiddenCount } = await fetchHighlights(n, source)
  const tiles = (await Promise.all(items.map(loadTile))).filter((t): t is Tile => !!t)
  return { tiles, hiddenCount }
}

/** Hide one image from the card and slideshow (or bring it back). */
export async function setHidden(id: number, hidden: boolean) {
  await fetch("/api/user/highlights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(hidden ? { hide: id } : { unhide: id }),
  }).catch(() => {})
}

export async function resetHidden() {
  await fetch("/api/user/highlights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reset: true }),
  }).catch(() => {})
}

/**
 * Take one row from the front of `pool` (mutating it) whose combined aspect is
 * close to `target`.
 *
 * Greedy with a short look-ahead: the row starts from the next tile in order
 * (which keeps favourites and random picks mixed), then adds whichever of the
 * next few tiles brings it closest to the target without overshooting by
 * much, stopping once it is nearly full.
 */
export function packRow(pool: Tile[], target: number, maxPerRow = 3): Tile[] {
  if (pool.length === 0) return []
  const group = [pool.shift()!]
  let sum = group[0].aspect
  while (group.length < maxPerRow && sum < target * 0.85) {
    let best = -1
    let bestGap = Infinity
    for (let i = 0; i < Math.min(pool.length, 8); i++) {
      const next = sum + pool[i].aspect
      if (next > target * 1.25) continue
      const gap = Math.abs(target - next)
      if (gap < bestGap) { bestGap = gap; best = i }
    }
    if (best < 0) break
    const [t] = pool.splice(best, 1)
    group.push(t)
    sum += t.aspect
  }
  return group
}

/** Split tiles into rows whose combined aspect is close to `target`. */
export function pack(tiles: Tile[], target: number, maxPerRow = 3): Tile[][] {
  const pool = [...tiles]
  const rows: Tile[][] = []
  while (pool.length > 0) rows.push(packRow(pool, target, maxPerRow))
  return rows
}
