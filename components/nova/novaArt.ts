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
