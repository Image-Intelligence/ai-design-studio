// Self-contained feed helpers for the my-generations page. Copied from the
// portal-v2 feed (app/admin/portal-v2/page.tsx) so this module stands alone and
// portal-v2 stays untouched. Keep the class maps as static literal strings — the
// Tailwind JIT compiler only emits classes it can see verbatim in source.

// Maps a column choice to a static Tailwind grid class.
export const FEED_COL_CLASS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3",
  4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6",
  7: "grid-cols-7", 8: "grid-cols-8",
}

/*
 * "Auto" columns, by screen width: two on a phone up to eight on an
 * ultrawide. The page runs full width, so a fixed four left 1920px screens
 * with tiles far larger than their 600px thumbnails.
 */
export const FEED_AUTO_COL_CLASS =
  "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 min-[1920px]:grid-cols-7 min-[2400px]:grid-cols-8"
export const FEED_AUTO_MASONRY_CLASS =
  "columns-2 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 min-[1920px]:columns-7 min-[2400px]:columns-8"
/** The same breakpoints, for the JS-packed masonry that needs a number. */
export const autoColsFor = (width: number) =>
  width < 640 ? 2 : width < 1024 ? 3 : width < 1280 ? 4 : width < 1536 ? 5 : width < 1920 ? 6 : width < 2400 ? 7 : 8

/**
 * A generation's real width/height, when known. Pixel dimensions (recorded at
 * save time, and backfilled into videoMetadata for older rows) beat the
 * aspectRatio column, which is "auto" for most images - and "auto" gave no
 * height to reserve, so tiles jumped as they loaded and masonry columns were
 * balanced as if every image were square.
 */
export function tileAspect(img: { aspectRatio?: string | null; videoMetadata?: any }): number | null {
  const vm = img.videoMetadata
  const w = Number(vm?.width), h = Number(vm?.height)
  if (w > 0 && h > 0) return w / h
  const ar = img.aspectRatio
  if (ar && ar !== "auto") {
    const [a, b] = ar.replace(/x/i, ":").split(":").map(parseFloat)
    if (a > 0 && b > 0) return a / b
  }
  return null
}

// CSS multi-column classes for masonry "Flow" mode — packs variable-height images
// with no row gaps, flowing top-to-bottom per column.
export const FEED_MASONRY_CLASS: Record<number, string> = {
  1: "columns-1", 2: "columns-2", 3: "columns-3",
  4: "columns-4", 5: "columns-5", 6: "columns-6",
  7: "columns-7", 8: "columns-8",
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
