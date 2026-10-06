"use client"

/**
 * "Open in Image Studio" from anywhere in the portal (the Edit Reference
 * popup, the Refs library) without threading a callback through every
 * component in between: the portal registers what opening means (switch to
 * Studios > Image Studio and start a canvas from the picture) - only for an
 * account that can use the studio - and the buttons ask whether it is there.
 */
import { useSyncExternalStore } from "react"

export type StudioOpenRequest = { url: string; refId?: string; title?: string }

let handler: ((r: StudioOpenRequest) => void) | null = null
const subs = new Set<() => void>()

/** The portal: what opening does (null = the studio is not available to this account). */
export function registerImageStudio(h: ((r: StudioOpenRequest) => void) | null) {
  handler = h
  subs.forEach(f => f())
}
export function openInImageStudio(r: StudioOpenRequest) {
  handler?.(r)
}
/** Whether an "Open in Image Studio" button should show. */
export function useImageStudioAvailable(): boolean {
  return useSyncExternalStore(
    cb => { subs.add(cb); return () => { subs.delete(cb) } },
    () => handler !== null,
    () => false,
  )
}
