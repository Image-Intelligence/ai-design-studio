// Self-contained feed helpers for the my-generations page. Copied from the
// portal-v2 feed (app/admin/portal-v2/page.tsx) so this module stands alone and
// portal-v2 stays untouched. Keep the class maps as static literal strings — the
// Tailwind JIT compiler only emits classes it can see verbatim in source.

// Maps a column choice to a static Tailwind grid class.
export const FEED_COL_CLASS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3",
  4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6",
}

// CSS multi-column classes for masonry "Flow" mode — packs variable-height images
// with no row gaps, flowing top-to-bottom per column.
export const FEED_MASONRY_CLASS: Record<number, string> = {
  1: "columns-1", 2: "columns-2", 3: "columns-3",
  4: "columns-4", 5: "columns-5", 6: "columns-6",
}

// Estimate a tile's relative height from its known aspect ratio ("2:3" / "1024x1536"
// → height per unit column width). Lets us balance columns BEFORE images load, so
// tiles don't move as images fill in.
export const arHeightWeight = (ar?: string): number => {
  if (!ar || ar === "auto") return 1
  const [w, h] = ar.replace(/x/i, ":").split(":").map(parseFloat)
  return w > 0 && h > 0 ? h / w : 1
}

// Deterministic shortest-column packing: assign each item, in order, to the
// currently shortest column. A given item's placement depends only on the items
// before it, so appending new items never moves existing ones (no reflow/jump).
export function distributeMasonry<T extends { weight: number }>(items: T[], n: number): T[][] {
  const cols: T[][] = Array.from({ length: n }, () => [])
  const heights = new Array(n).fill(0)
  for (const item of items) {
    let min = 0
    for (let i = 1; i < n; i++) if (heights[i] < heights[min]) min = i
    cols[min].push(item)
    heights[min] += item.weight
  }
  return cols
}

// Video detection from a URL (extension or known video hosts/paths).
export const isVideoUrl = (url: string) =>
  /\.(mp4|webm|mov|avi|mkv|m4v)($|\?|#)/i.test(url) ||
  url.includes("fal.media/files/video")
