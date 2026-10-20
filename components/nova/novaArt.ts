/*
 * Nova Studio's art (2026-10-18): Nova, the brand mascot, in the five poses
 * the studio shows her in, plus the wide card art for the welcome hero. All on
 * the public bucket (studios/nova/), transparent WebP, so no signing - and one
 * place to swap a pose.
 *
 * Feed rows on promptandprotocol@ (Studio Cards, folder 73): card 112460.
 *
 * The poses were remade 2026-10-19 (owner: the old cut-outs chopped Nova's
 * silver halo rings and had ragged edges). Each is now rendered on PURE BLACK
 * with both halo rings complete (from the brand hero #112015), then made
 * transparent by "unscreening" - alpha = brightness, the black divided back
 * out - instead of an AI cut-out, so glass stays see-through and every pixel
 * of the thin rings survives. Renders: portrait 112925, thinking 112931,
 * creating 112927, rendering 112932, done 112929 (Studio Cards folder).
 */

export type NovaPose = "portrait" | "thinking" | "creating" | "rendering" | "done"

const BASE = "https://pub-738a6d61c61a473595356856a86615a1.r2.dev/studios"

export const NOVA_POSES: Record<NovaPose, string> = {
  portrait: `${BASE}/nova/portrait-v2-e511781f.webp`,
  thinking: `${BASE}/nova/thinking-v2-e511781f.webp`,
  creating: `${BASE}/nova/creating-v2-e511781f.webp`,
  rendering: `${BASE}/nova/rendering-v2-e511781f.webp`,
  done: `${BASE}/nova/done-v2-e511781f.webp`,
}

export const NOVA_POSE_ORDER: NovaPose[] = ["portrait", "thinking", "creating", "rendering", "done"]

/** Nova in a night studio with her media orbiting her (the Studios card). */
export const NOVA_HERO_ART = `${BASE}/nova-96a57f0f-3de5-4045-98ea-918f496592e7.webp`

/*
 * Prism, the site guide (2026-10-20): the same five poses, rendered from the
 * Prism mascot (#112090 / #112087, the spiral-tail redesign) with NB2.1 edit
 * on flat grey and cut out with BiRefNet - Prism is opaque, so a subject mask
 * gives clean edges (an unscreen is only for glass and glow like Nova's).
 * Renders: portrait 113004, thinking 113005, creating 113006, rendering
 * 113007, done 113008 (Studio Cards folder). `face` is a head-and-shoulders
 * crop of the portrait for avatar sizes, where the full figure is too small.
 */
export const PRISM_POSES: Record<NovaPose, string> = {
  portrait: `${BASE}/prism/portrait-a7c31e90.webp`,
  thinking: `${BASE}/prism/thinking-a7c31e90.webp`,
  creating: `${BASE}/prism/creating-a7c31e90.webp`,
  rendering: `${BASE}/prism/rendering-a7c31e90.webp`,
  done: `${BASE}/prism/done-a7c31e90.webp`,
}
export const PRISM_FACE = `${BASE}/prism/face-a7c31e90.webp`
