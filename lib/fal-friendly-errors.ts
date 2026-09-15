// fal 422 validation details are engineer-speak (e.g. "The parameter 'content[4]'
// specified in the request is not valid: the parameter video aspect ratio ... must
// be less than or equal to 2.5 for model dreamina-seedance-2-0 in r2v") — translate
// the common ones into something a user can act on. Unknown messages pass through.
export function friendlyFalError(raw: string, model?: string): string {
  const d = raw.toLowerCase()

  /*
   * A fault inside fal's own LoRA loader, not in the weights. Verified by
   * sending a LoRA fal trained itself, hosted by fal, to the same endpoint:
   * identical failure. Without this the message blames the file.
   */
  if (d.includes('cache_dir') || d.includes('_build_lora_manager')) {
    return "Z-Image Base cannot load LoRAs at the moment — the fault is inside fal's endpoint, not your LoRA file (their own trained LoRAs fail there too). Use Z-Image Turbo with this LoRA until fal fixes it."
  }

  if (d.includes('safety system') || d.includes('moderation')) {
    return 'The model\'s safety system declined this request. Adjust your prompt or swap the reference image and try again.'
  }

  if (d.includes('unsupported image') || d.includes('invalid image') || d.includes('could not be decoded')) {
    return 'A reference image couldn\'t be read by the model. Re-save it as PNG or JPG and re-upload.'
  }

  if (d === 'unprocessable entity') {
    return 'The model rejected this request\'s inputs. Try removing or re-adding the reference images, or simplify the prompt.'
  }

  if (d.includes('aspect ratio')) {
    if (d.includes('video')) {
      return 'One of your reference videos has an unsupported shape: reference clips must be no wider than 2.5:1 and no taller than 1:2.5. Very wide or very tall clips (like some screen recordings) are rejected — re-crop or replace that clip and try again.'
    }
    return 'The input aspect ratio is not supported by this model. Try a more standard shape like 16:9, 9:16, 4:3 or 1:1.'
  }

  if (d.includes('duration') && (d.includes('not valid') || d.includes('must be'))) {
    return 'A clip duration is outside what this model accepts — reference videos must total between 2 and 15 seconds. Trim your clips and try again.'
  }

  if (d.includes('resolution') && (d.includes('not valid') || d.includes('must be'))) {
    return 'An input file\'s resolution is outside what this model accepts. Try a smaller or more standard-resolution file.'
  }

  if (d.includes('content_policy') || d.includes('content policy') || d.includes('flagged')) {
    return 'Your prompt or an input file was flagged by the model\'s content policy. Please adjust and try again.'
  }

  // fal's client throws this when a provider fails the job with a body it can't
  // parse into a validation error, leaving only the status code. For
  // google/virtual-try-on this was confirmed by replaying a failed job against
  // the live endpoint: the body underneath is content_policy_violation on
  // person_image_url and/or product_image_url — Google's own checker, and the
  // endpoint exposes no safety parameter to relax it.
  if (d.includes('unexpected status code: 422') || d.includes('status code 422')) {
    if (model === 'google-virtual-try-on') {
      return 'Virtual Try-On refused these photos: Google flagged one or both images with its content checker. This endpoint has no safety setting to turn down, so the only fix is different source images — a fully clothed, conservatively framed person shot is what passes. Images that work fine in other models are often rejected here.'
    }
    return 'The model rejected this request with a bare 422 — usually an input image its content checker or decoder refused. Try a different reference image.'
  }

  /*
   * A provider-side 5xx. fal's own infrastructure failed the job — nothing
   * about the prompt or the images caused it, and nothing the user changes
   * will avoid it. Measured on a 27-job batch: two jobs ran 147s and 455s at
   * fal before coming back 500, while the other 25 averaged 40s. Saying
   * "Unexpected status code: 500" invites someone to rewrite a prompt that
   * was never the problem.
   */
  // A number alone is not enough: "duration must be 500ms" and "aspect ratio
  // 500px wide" both contain one. Either a 5xx code sits next to status/error
  // wording, or the phrase names the fault outright.
  if (/\b5\d{2}\b/.test(d)
    ? (d.includes('status code') || d.includes('error') || d.includes('gateway') || d.includes('unavailable'))
    : /internal server error|bad gateway|service unavailable|gateway time-?out/.test(d)) {
    return 'fal\'s servers failed this one on their side — not your prompt or your images. Retrying usually works.'
  }

  return raw
}

// Back-compat alias (video routes imported this name first)
export const friendlyFalVideoError = friendlyFalError

// Pull the useful detail out of a fal client error — `err.message` is often just
// the HTTP status text ("Unprocessable Entity") while the real explanation lives
// in `err.body.detail`.
export function extractFalErrorDetail(err: any): string {
  const detail = err?.body?.detail
  if (Array.isArray(detail)) {
    return detail.map((d: any) => d?.msg || d?.message || (typeof d === 'string' ? d : JSON.stringify(d))).join('; ')
  }
  if (typeof detail === 'string' && detail.trim()) return detail
  return err?.body?.message || err?.message || 'Generation failed'
}
