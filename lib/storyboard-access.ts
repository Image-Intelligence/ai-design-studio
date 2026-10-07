import { ADMIN_ONLY_IMAGE_MODELS } from '@/lib/chat-image-catalog'
import { ADMIN_ONLY_VIDEO_MODELS } from '@/lib/fal-video-endpoints'
import { STORYBOARD_VIDEO_IDS } from '@/lib/storyboard'

/**
 * Which Storyboard models an account can use (public 2026-10-07). The site's
 * own admin-only lists decide - the same ones /api/generate and
 * /api/video/generate enforce - so the Studio's pickers, the AI draft and
 * "Edit with AI" never hand a non-admin a model the routes would refuse.
 * Client-safe: the page filters its menus with it too.
 */
export const imageModelOpen = (id: string, isAdmin: boolean) => isAdmin || !ADMIN_ONLY_IMAGE_MODELS.has(id)
export const videoModelOpen = (label: string, isAdmin: boolean) => isAdmin || !ADMIN_ONLY_VIDEO_MODELS.has(STORYBOARD_VIDEO_IDS[label] ?? '')

/** What a non-admin's shot falls back to when a plan names a model they cannot use. */
export const PUBLIC_IMAGE_MODEL = 'nano-banana-2.1'
export const PUBLIC_VIDEO_MODEL = 'SeeDance 2.5'

/** A shot (or a patch to one) with any admin-only model swapped for the public default. */
export function openShotModels<T extends { imageModel?: string; videoModel?: string }>(s: T, isAdmin: boolean): T {
  if (isAdmin) return s
  const out = { ...s }
  if (out.imageModel && !imageModelOpen(out.imageModel, false)) out.imageModel = PUBLIC_IMAGE_MODEL
  if (out.videoModel && !videoModelOpen(out.videoModel, false)) out.videoModel = PUBLIC_VIDEO_MODEL
  return out
}
