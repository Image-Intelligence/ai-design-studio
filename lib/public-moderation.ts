/**
 * The moderation a public model runs at for a non-admin, whatever the client
 * (or a model's own builder) asked for - the server-side guarantee CCBill
 * needs. Admins keep what they set.
 *
 * This lived inline in /api/generate, so the Edit Image popup and Image Studio
 * (lib/chat-hub-create's buildFalCall, open to everyone since 2026-10-06) ran
 * the same models with none of it. Both now call this, so the rules have one
 * copy.
 *
 * `model` is the site's model id; `input` is the fal payload, changed in place.
 */
export function enforcePublicModeration(model: string, input: Record<string, unknown>, isAdmin: boolean): void {
  if (isAdmin) return
  // fal's safety checker forced ON: SeeDream 5.0 Flash (public 2026-10-01),
  // Qwen Image 3 and Recraft V4 / V4.1 Flash (2026-10-02) - their specs send false
  if (model === 'seedream-5-flash' || model === 'seedream-5-flash-edit' || model === 'qwen-image-3'
    || model.startsWith('recraft-v4-') || model === 'recraft-v4.1-flash') {
    input.enable_safety_checker = true
  }
  // FLUX 3 Klein / Klein Base (public 2026-10-16): their specs send false
  if (model.startsWith('flux-3-klein')) input.enable_safety_checker = true
  // FLUX 3 Image: safety_tolerance 0 (strictest) - 4; fal's default 2
  if (model === 'flux-3-image') input.safety_tolerance = 2
  // NanoBanana 2 Lite and 2.1: fal's standard level (4), not the most
  // permissive (6) - 2.1's level is an admin-only setting (2026-10-07)
  if (model === 'nano-banana-2-lite' || model === 'nano-banana-2.1' || model === 'nano-banana-2.1-edit') {
    input.safety_tolerance = '4'
  }
  // Image Studio's Generative Fill (FLUX Pro Fill): fal's default 2, not the
  // most permissive 6 (2026-10-07 - the Studio and its popup are public)
  if (model === 'flux-pro-fill') input.safety_tolerance = '2'
  /*
   * Every other model (2026-10-17): whatever the client or a route's own
   * defaults asked for, a non-admin runs with fal's checker ON and never
   * above fal's standard tolerance (4 on the 1-6 scales; the named models
   * above are held lower). Several routes hard-coded the checker off, or
   * took it - and the tolerance - straight from the request body, so any
   * account could turn moderation off for FLUX 2, Z-Image, NanoBanana Pro /
   * 2, SeeDream 4.5 / 5 Lite, Wan 2.7 Pro and the canvas.
   */
  if ('enable_safety_checker' in input) input.enable_safety_checker = true
  if (input.safety_tolerance != null) {
    const t = Number(input.safety_tolerance)
    if (!Number.isFinite(t) || t > 4) input.safety_tolerance = typeof input.safety_tolerance === 'number' ? 4 : '4'
  }
}

/** The same rule for a route that sets the checker directly: the value a request may have. */
export function publicSafetyChecker(requested: unknown, isAdmin: boolean): boolean {
  return isAdmin ? requested === true : true
}
