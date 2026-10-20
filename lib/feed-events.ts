/**
 * "Something new is in My Generations" - a browser event between the parts of
 * the portal (2026-10-20, owner: "I'm seeing Prism generate stuff but it
 * doesn't come into my feed until I refresh the page").
 *
 * The portal's feeds page backwards through the library (cursor pagination)
 * and only learn about the portal's OWN generations (its pending slots). Work
 * made elsewhere on the page - Prism, Nova Studio - never reached them. Those
 * now announce each finished item, and the image / audio / video feeds pull
 * their newest rows in at the top (they also do that when the tab comes back
 * into view, for renders that finished in the background or on another device).
 */
export const NEW_MEDIA_EVENT = 'aids:new-media'
export type FeedKind = 'image' | 'video' | 'audio'

/** Which feed a generation of this kind shows in (null: none - e.g. 3D). */
export function feedKindOf(kind: string | null | undefined): FeedKind | null {
  if (kind === 'image') return 'image'
  if (kind === 'video' || kind === 'cut') return 'video'
  if (kind === 'audio') return 'audio'
  return null
}

export function announceNewMedia(kind: FeedKind): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ kind: FeedKind }>(NEW_MEDIA_EVENT, { detail: { kind } }))
}

/** Calls `onNew` when new media of this kind is announced, or when the tab becomes visible again. */
export function listenForNewMedia(kind: FeedKind, onNew: () => void): () => void {
  const onEvent = (e: Event) => { if ((e as CustomEvent<{ kind?: FeedKind }>).detail?.kind === kind) onNew() }
  const onVisible = () => { if (document.visibilityState === 'visible') onNew() }
  window.addEventListener(NEW_MEDIA_EVENT, onEvent)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.removeEventListener(NEW_MEDIA_EVENT, onEvent)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
