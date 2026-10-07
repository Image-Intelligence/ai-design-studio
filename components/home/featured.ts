/**
 * Cards shown portrait (3:4), keyed `${kind}:${name}`. In the home page's model
 * grids they span two rows, and the dashboard's Catalog strip gives them a 3:4
 * frame. Virtual Try-On is about whole outfits, Pixelcut about single products
 * on a stand and Kling V3 Motion about full-body movement - all cut short by a
 * landscape frame, so their card media is made 3:4.
 */
export const TALL_CARDS = new Set(["image:Virtual Try-On", "image:Pixelcut Product Photo", "video:Kling V3 Motion"])

/**
 * The Featured shortcuts' sizes, on a grid of half-card units (a small card is
 * 2x2 units, so every size keeps the cards' 4:3): the headline models big
 * (4x4, twice a small card), the next tier medium (3x3, one and a half) and the
 * portrait cards (TALL_CARDS) tall (2x4, about 2:3 for their 3:4 art).
 */
export const BIG_FEATURED = new Set(["image:NanoBanana 2.1", "video:SeeDance 2.5", "video:Gemini Omni Flash 1.1"])
export const MEDIUM_FEATURED = new Set(["image:ChatGPT Images 2.5", "video:LTX 2.5 Pro", "image:SeeDream 5.0 Pro"])

export type FeaturedSize = "small" | "medium" | "big" | "tall"
export function featuredSize(key: string): FeaturedSize {
  return BIG_FEATURED.has(key) ? "big" : MEDIUM_FEATURED.has(key) ? "medium" : TALL_CARDS.has(key) ? "tall" : "small"
}

/**
 * The top models: the home page's Featured Models shortcuts (and the first
 * pictures in the dashboard Catalog card's strip). A card's media lives under
 * `${kind}:${name}` in /api/admin/home-cards. Listed in reading order; where
 * each card lands is worked out by packFeatured below, so cards can be added,
 * removed or resized freely. Every name here is a public model.
 */
export const FEATURED_MODELS: { name: string; kind: "image" | "video" }[] = [
  { name: "NanoBanana 2.1", kind: "image" },          // big
  { name: "Virtual Try-On", kind: "image" },          // tall
  { name: "ChatGPT Images 2.5", kind: "image" },      // medium
  { name: "Ideogram v4.5", kind: "image" },
  { name: "Kling 3.0", kind: "video" },
  { name: "Kling O3", kind: "image" },
  { name: "SeeDance 2.5", kind: "video" },            // big
  { name: "LTX 2.5 Pro", kind: "video" },             // medium
  { name: "FLUX 3", kind: "image" },
  { name: "Grok Imagine 2.0", kind: "image" },
  { name: "Kling V3 Motion", kind: "video" },         // tall
  { name: "Wan 3.0", kind: "video" },
  { name: "SeeDream 5.0 Pro", kind: "image" },        // medium
  { name: "Qwen Image 3", kind: "image" },
  { name: "SeedVR2 Upscale", kind: "image" },
  { name: "Gemini Omni Flash 1.1", kind: "video" },   // big
  { name: "Pixelcut Product Photo", kind: "image" },  // tall
  { name: "Meta Muse", kind: "image" },
  { name: "Luma Ray 3.2", kind: "video" },
  { name: "PixVerse V6", kind: "video" },
]

/** The Featured grid's width in units at each breakpoint: phone, sm, md, lg+. */
export const FEATURED_COLUMNS = [4, 6, 8, 12] as const

/** A spot on the unit grid (1-based, as CSS grid lines count). */
export type FeaturedCell = { col: number; row: number; w: number; h: number }

function unitSize(size: FeaturedSize, cols: number): [number, number] {
  if (size === "small") return [2, 2]
  if (size === "tall") return [2, 4]
  if (size === "big") return [4, 4]
  // A phone's grid is two small cards wide: a 3-unit card cannot sit beside
  // anything there, so medium takes the full width like big.
  return cols <= 4 ? [4, 4] : [3, 3]
}

/**
 * Lays the Featured cards out on `cols` units with no hole, keeping close to
 * the listed order, and returns each card's spot plus the spots of the "All
 * models" tiles that close the grid (null for the ones not needed).
 *
 * Why not CSS's dense auto-placement: with three sizes it leaves holes at some
 * widths, and a 3x3 card can never square off an even-width grid alone - so
 * the "All models" tiles are the give. This is a small depth-first search:
 * fill the first empty unit (top to bottom, left to right) with one of the
 * next few cards in the list, and backtrack on a dead end; the tiles join only
 * among the last few cards, so they close the grid. Fewest tiles first, each
 * small, medium or big. Returns null if nothing fits (the caller then falls
 * back to auto-placement) - for today's list every width packs in a few
 * hundred steps.
 */
export function packFeatured(sizes: FeaturedSize[], tileCount: number, cols: number): { cards: FeaturedCell[]; tiles: (FeaturedCell | null)[] } | null {
  const LOOKAHEAD = 5        // how far down the list a card may jump forward
  const TILES_NEAR_END = 3   // tiles may be placed once this few cards remain
  const MAX_STEPS = 50_000
  const cardDims = sizes.map(s => unitSize(s, cols))

  const tryTiles = (tileSizes: FeaturedSize[]) => {
    const tileDims = tileSizes.map(s => unitSize(s, cols))
    const area = [...cardDims, ...tileDims].reduce((a, [w, h]) => a + w * h, 0)
    if (area % cols) return null
    const rows = area / cols
    const grid: boolean[] = new Array(rows * cols).fill(false)
    const cards: (FeaturedCell | null)[] = sizes.map(() => null)
    const tiles: (FeaturedCell | null)[] = tileSizes.map(() => null)
    const cardsLeft = sizes.map((_, i) => i)
    const tilesLeft = tileSizes.map((_, i) => i)
    let steps = 0
    const fits = (r: number, c: number, w: number, h: number) => {
      if (c + w > cols || r + h > rows) return false
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) if (grid[(r + dr) * cols + c + dc]) return false
      return true
    }
    const mark = (r: number, c: number, w: number, h: number, v: boolean) => {
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) grid[(r + dr) * cols + c + dc] = v
    }
    const dfs = (): boolean => {
      if (++steps > MAX_STEPS) return false
      const first = grid.indexOf(false)
      if (first < 0) return cardsLeft.length === 0 && tilesLeft.length === 0
      const r = Math.floor(first / cols), c = first % cols
      const options: [list: number[], at: number, dims: [number, number][], out: (FeaturedCell | null)[]][] = []
      for (const i of cardsLeft.slice(0, LOOKAHEAD)) options.push([cardsLeft, i, cardDims, cards])
      if (cardsLeft.length <= TILES_NEAR_END) for (const i of tilesLeft) options.push([tilesLeft, i, tileDims, tiles])
      for (const [list, i, dims, out] of options) {
        const [w, h] = dims[i]
        if (!fits(r, c, w, h)) continue
        mark(r, c, w, h, true)
        out[i] = { col: c + 1, row: r + 1, w, h }
        const at = list.indexOf(i)
        list.splice(at, 1)
        if (dfs()) return true
        list.splice(at, 0, i)
        out[i] = null
        mark(r, c, w, h, false)
      }
      return false
    }
    return dfs() ? { cards: cards as FeaturedCell[], tiles } : null
  }

  // Fewest tiles first; within a count, every mix of small, medium and big
  // (smallest first)
  const TILE_SIZES: FeaturedSize[] = ["small", "medium", "big"]
  for (let n = 0; n <= tileCount; n++) {
    for (let mix = 0; mix < 3 ** n; mix++) {
      const tileSizes = Array.from({ length: n }, (_, i) => TILE_SIZES[Math.floor(mix / 3 ** i) % 3])
      const res = tryTiles(tileSizes)
      if (res) return { cards: res.cards, tiles: [...res.tiles, ...new Array(tileCount - n).fill(null)] }
    }
  }
  return null
}
