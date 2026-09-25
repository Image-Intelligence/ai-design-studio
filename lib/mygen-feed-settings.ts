/**
 * The my-generations feed layout, set by admins for every account.
 *
 * Stored in SystemState."myGenFeed" (JSONB, added out of band by
 * scratchpad/add-mygen-feed.cjs, so read with raw SQL - the generated client
 * predates it). Null means "never set": everyone gets the defaults.
 *
 * This file is imported by client components for the type, defaults and
 * sanitiser, so the database helpers live in the API route, not here.
 */

export interface MyGenFeedSettings {
  /** null = Auto (2 on a phone up to 8 on an ultrawide). */
  cols: number | null
  fullSize: boolean
  fullSizeLayout: "grid" | "masonry"
  masonryMode: "flow" | "rows"
  tileRes: "thumb" | "full"
  pageSize: number
}

export const MYGEN_FEED_DEFAULTS: MyGenFeedSettings = {
  cols: null,
  fullSize: true,
  fullSizeLayout: "masonry",
  masonryMode: "rows",
  tileRes: "thumb",
  pageSize: 24,
}

export const MYGEN_PAGE_SIZES = [8, 12, 24, 48, 96]

/** Anything malformed falls back to the default for that field. */
export function sanitizeMyGenFeed(raw: unknown): MyGenFeedSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const d = MYGEN_FEED_DEFAULTS
  const cols = typeof r.cols === "number" && Number.isInteger(r.cols) && r.cols >= 1 && r.cols <= 8 ? r.cols : null
  return {
    cols: r.cols === null ? null : cols ?? d.cols,
    fullSize: typeof r.fullSize === "boolean" ? r.fullSize : d.fullSize,
    fullSizeLayout: r.fullSizeLayout === "grid" || r.fullSizeLayout === "masonry" ? r.fullSizeLayout : d.fullSizeLayout,
    masonryMode: r.masonryMode === "flow" || r.masonryMode === "rows" ? r.masonryMode : d.masonryMode,
    tileRes: r.tileRes === "thumb" || r.tileRes === "full" ? r.tileRes : d.tileRes,
    pageSize: typeof r.pageSize === "number" && MYGEN_PAGE_SIZES.includes(r.pageSize) ? r.pageSize : d.pageSize,
  }
}
