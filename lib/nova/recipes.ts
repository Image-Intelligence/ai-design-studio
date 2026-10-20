/**
 * Nova Studio - recipes (client-safe, 2026-10-19).
 *
 * The owner compared Nova with Claude Code working on the project: Claude
 * knew HOW to make a seamless loop or keep a character on-model across shots,
 * Nova improvised every time. A recipe is that know-how written down: the
 * steps, the tools and models that work, and the checks - from what has
 * actually worked on this site (the mascot ads, the Prism colour-shift ad,
 * the Kling loops).
 *
 * Only each recipe's one-line summary sits in Nova's instructions; the full
 * text comes from load_recipe when a job matches, so it costs context only
 * when it is used (the Skills v2 pattern of the Chat Hub).
 */

export type NovaRecipe = { id: string; title: string; when: string; body: string }

export const NOVA_RECIPES: NovaRecipe[] = [
  {
    id: 'seamless-loop',
    title: 'Seamless looping video',
    when: 'a loop, a looping background, a cinemagraph, a GIF-like clip that repeats, an idle animation',
    body: `GOAL: a clip whose last frame flows back into its first with no visible jump.

1. CHOOSE MOTION THAT CAN RETURN TO ITS START. Cyclical or ambient motion loops: waves, flickering flames, steam, rain, drifting particles or clouds, hair or fabric in wind, breathing, a slow sway, a turntable rotation, blinking lights. One-way actions do NOT loop (walking out of frame, pouring, a door opening, a camera flying forward). Keep the camera LOCKED (or a move that ends where it began). Tell the user if their idea is one-way and suggest the loopable version.
2. MAKE THE HERO STILL in the final aspect on a premium image model (recommend_models photoreal / illustration). It is both the first AND the last frame, so compose it to hold: subject placed with room around it, nothing cut off at the edges.
3. RENDER WITH START = END FRAME. Use a video model with an end frame: kling-v3 (best motion), seedance-1.5 (budget), minimax-h3-max, wan-3.0, ltx-2.5-pro. Pass start_image_id AND end_image_id = the same still. Prompt the motion only, and say it returns: e.g. "Locked-off static camera. Gentle steam curls up from the cup and the window light flickers softly; the scene ends exactly as it began, seamless loop." No camera moves, no new objects, no cuts. 5 seconds is usually best (less drift than 10).
4. CHECK THE SEAM: make_loop with method "check", then pick ONE repair from the result - do not try methods one after another:
   - seamless (ratio about 1-1.6) -> done, no repair.
   - slight (1.6-3) -> "crossfade" 0.6-0.8s. For organic, random motion (a flame, water, smoke, foliage) slight is usually invisible in motion - look at the two seam frames and accept it if they read as the same moment.
   - visible (3+) -> "best_cut" when the motion repeats (flames, waves, a spin; pass min_sec = the asked length minus about 0.5s), otherwise "crossfade" 0.8-1.2s.
   - "pingpong" ONLY for motion with no direction (breathing, sway, a pulsing glow) - never for smoke, water or falling things.
   LENGTH: a repaired loop is a little shorter than the clip. To make a seamless loop longer, put it into assemble_cut twice or more (the same id, hard cuts, no transitions) - a seamless loop repeated stays seamless. At most 2 loop versions per clip.
5. LOOK at the frames make_loop shows you (the end and the start side by side). If the subject itself changes between them (a face, a pose, a colour) no blend will hide it: re-render once with a stronger "returns to the starting pose" prompt, or on another end-frame model.
6. SOUND: loops are usually silent or ambient. If the user wants music, the bed must be cut to the loop's exact length (assemble_cut with the loop as the only clip and the music end_sec = its length).
7. DELIVER the loop's id, its length, the seam verdict, and offer export_formats (9:16 / 1:1).`,
  },
  {
    id: 'look-bible',
    title: 'Look bible: lock a character, a place and a style before the shots',
    when: 'anything with 2+ images or shots of the same character, product or location - ads, scenes, series, a character in several poses',
    body: `GOAL: every shot shows the SAME character and the SAME place in the SAME style. Consistency comes from references, decided once, used every time.

1. USE WHAT EXISTS FIRST. The chat's references (the studio panel) and the user's Assets (list_assets, asset_pictures) are the truth: if they cover the character/product, build the bible from their pictures and skip to step 5.
2. CHARACTER SHEET (for each recurring character or product): one image on a plain light-grey studio background showing it front, three-quarter and side, same outfit, neutral expression, even soft light, full body or full product visible. Model: nano-banana-2.1 (or seedream-5-pro). If a picture of it already exists, pass it as reference 1 so the sheet matches it. Describe it precisely: face shape, hair, skin, eyes, outfit with colours and materials, distinctive marks - this description goes into EVERY later prompt word for word.
3. PLACE PLATE (for each recurring location): a wide establishing image of the location with NO people, in the project's aspect, the light and time of day of the story. Keep its key features nameable ("the red door on the left, the brass lamp, the arched window").
4. STYLE FRAME: one image that puts the character in the place in the intended style (nano-banana-2.1 with the sheet and plate as references 1 and 2). This is the look of the whole piece - show it to the user before spending on video when the job is big (over the ask-first limit), otherwise judge it yourself.
5. SAVE: save_asset for each new character/product (kind character / product) with its sheet + style frame, and update_asset_notes with the exact description. Then set_look_bible with the character pictures, the place pictures and a one-paragraph style note (medium, palette, lens, light, grain).
6. FROM THEN ON every generate_image / generate_video call in this chat passes the bible pictures that are in the shot as references (character first), and repeats the character description. Use an EDIT-capable model with references (nano-banana-2.1, seedream-5-pro, kling-o3-image) for stills - never text-only for an established character.
7. CHECK each new still or clip with check_shots against the bible; redo anything that drifted (up to 2 tries per shot) before moving on. Drift found early is cheap; drift found in the final cut is not.`,
  },
  {
    id: 'multi-shot-scene',
    title: 'Multi-shot scene or short film with consistent shots',
    when: 'a scene, short film, story, trailer or sequence of 3+ shots with the same characters',
    body: `1. LOOK BIBLE FIRST (load_recipe look-bible) - no shot is made before the character, place and style are locked.
2. SHOT LIST: 3-8 shots, each with framing (wide / medium / close-up / insert), the ONE action, the ONE camera move (or locked), and its length (5s typical). Give the edit a shape: establish (wide) -> action (medium) -> detail or emotion (close) -> resolve. Say the list to the user in one short block.
3. KEYFRAMES: one still per shot with an edit model (nano-banana-2.1) and the bible references: "the same woman from reference 1 (exact description...) in the kitchen from reference 2, medium shot, ...". Same aspect for all. check_shots on the keyframes as a set; redo drift (up to 2 tries).
4. CONTINUITY: when shot N+1 continues the same moment (no time jump, same place), extract_frame the LAST frame of shot N's clip and use it as shot N+1's start image (or as reference 1 of its keyframe) - this carries the light, the position and the background across the cut.
5. MOTION: one video model for all shots (the same look): kling-v3 for premium, seedance-1.5 on a budget. start_image_id = the keyframe. The prompt is motion + camera only; describe the subject briefly so the model does not reinvent it; "the character's face and outfit stay exactly the same". 5s clips drift less than 10s.
6. CHECK every clip: check_shots (it sees the first, middle and last frames). A face that changed mid-clip -> re-render, or edit_clip with kling-o3-pro-edit / minimax-h3-max-recast and the character's pictures as cast.
7. CUT: assemble_cut with hard cuts on action, a dissolve only for time passing; music bed (assemble_cut music, -14 dB under any voice), effects from edit_clip mirelo-sfx2-video or a generate_audio sfx. Captions only if asked.
8. CRITIC (critique_work) on the cut, apply its fixes within budget, deliver with every #id and its tickets.`,
  },
  {
    id: 'product-ad',
    title: 'Product ad (stills and/or a short video ad)',
    when: 'an ad, a commercial, product shots, a promo, a launch post for a product or brand',
    body: `1. THE PRODUCT IS SACRED: use the user's product picture (asset or attachment) as reference 1 in every shot; never let a model redesign it. No picture -> make one hero packshot first, show it, and save it as a product asset. A cutout of the product (cutout tool) is useful for placing it on scenes with edit_image.
2. BRAND RULES: check WHAT YOU KNOW ABOUT THIS USER (remembered rules: colours, logo placement, "never show prices"). Ask once for the product name and the one message if they are missing.
3. SHOTS (look-bible rules apply): hero shot (product on a styled surface, clean light), in-use / lifestyle shot, detail shot (texture, material), end card. nano-banana-2.1 with the product reference; describe surface, light and mood, not the product's design.
4. TEXT: never trust a generation model with exact words on a product ad - add headlines, prices-free taglines and CTAs with edit_image (exact words, position, weight, box). Logos: place the user's logo with edit_image overlay; an end card = a clean background + logo overlay + one line.
5. VIDEO (if asked): animate the hero and lifestyle stills with subtle, premium motion - slow push-in, gentle turntable rotation, steam/condensation, light sweep across the product (kling-v3, 5s). The product must not deform: say "the product stays perfectly still and unchanged, only the light / camera moves".
6. SOUND: a music bed (stable-audio-3 or eleven-music-v2.5, the cut's length), an optional voiceover (eleven-v4, write it to be spoken, one line per beat); voice at full level, music -14 dB under it; levelled to -14 LUFS.
7. CUT AND FORMATS: assemble_cut (15-30s), critique_work, then export_formats 9:16 + 1:1 (+16:9 if asked). Keep type inside the safe area (away from the top and bottom 12% on 9:16).`,
  },
  {
    id: 'talking-character',
    title: 'A character or mascot that talks to camera',
    when: 'a talking mascot, a spokesperson, a character saying a line, a presenter, lip-sync',
    body: `1. THE FACE: a still of the character facing the camera (or three-quarter), mouth closed and neutral, head and shoulders clearly visible, nothing covering the mouth, plain or softly blurred background, the final aspect (9:16 for social). Use the character's asset pictures as references (look-bible rules).
2. THE LINE: generate_audio with a voiceover model (eleven-v4 for character voices; keep the SAME voice for the same character in every line - remember it). Write it to be spoken: short sentences, punctuation for pauses. One line per take.
3. MAKE IT TALK with talking_head:
   - model "minimax-h3-max-lipsync" (1080P, sharpest, fastest): works on stylised and non-human faces (an orb, a chameleon). It refuses lines under 5 seconds - talking_head pads short lines with silence automatically; trim the extra in assemble_cut (trim_end).
   - model "omnihuman-v2": more body and hand movement, a prompt can direct gestures; slower.
   Alternative for a clip that already moves: edit_clip "lipsync-v3" with the audio.
4. CHECK with inspect_media (frames + sound): lips moving with the words, face unchanged, no warping.
5. CUT: talking shots between b-roll (assemble_cut); voice lines at full level, music bed -14 dB under, sound effects about 3 LU under the voices (gain_db around -9) so they never fight the words. Captions help on social (assemble_cut captions, timed to the line).`,
  },
]

export const recipeById = (id: string) => NOVA_RECIPES.find(r => r.id === id)

/** The one-line index that sits in Nova's instructions. */
export function recipeIndex(): string {
  return NOVA_RECIPES.map(r => `- ${r.id}: ${r.title} - use for ${r.when}`).join('\n')
}
