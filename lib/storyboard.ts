/**
 * Storyboard Studio - shared shapes and limits (client-safe).
 *
 * A storyboard is a film planned as an ordered row of stills before any motion
 * is shot: each slot carries its still, the model that made it, what the shot
 * shows, the prompt planned for its video and how it cuts to the next one.
 * Stored as one JSON array on the Storyboard row (see prisma/schema.prisma),
 * so a reorder or an edit is a single write.
 *
 * SCENES (2026-10-05): a board can be split into scenes, the way a film is
 * shot - each scene a place and time, the cast and locations in it, and its
 * own run of shots. Scenes are their own list (Storyboard.scenes); a shot
 * names its scene by `sceneId`, and the shot array is kept in scene order, so
 * everything that reads "the board in order" (the animatic, the Final Cut)
 * still just reads `shots`. A board with no scenes is a single run of shots,
 * exactly as before.
 */

import { getCreateModel, computeCreateCost } from '@/lib/chat-hub-models'
import { getTicketCost } from '@/config/ai-models.config'
import { flux3ImageTicketCost, gptImage25TicketCost, ideogramTicketCost, nb21TicketCost } from '@/lib/ticket-pricing'

export type StoryboardShot = {
  id: string
  title: string
  /** What we see - the plain-language description of the shot. */
  description: string
  /** The prompt the still is (re)generated from. */
  imagePrompt: string
  imageModel: string
  stillUrl: string | null
  /** The planned prompt for the video shot made from this still. */
  videoPrompt: string
  videoModel: string
  /** Planned seconds on screen. */
  duration: number
  /** How this shot hands over to the next one (cut, match cut, dissolve...). */
  transition: string
  /** The still's quality (2k / 4k / ...): one of its model's options; empty = the model's default. */
  imageQuality?: string
  /**
   * The still model's other settings (FLUX 3's nothing, Ideogram's speed,
   * Krea's creativity...), keyed as stillSettings(imageModel) lists them.
   * A key missing here is that setting's default. Cleared when the model changes.
   */
  imageOptions?: Record<string, string>
  /** The shot's video, once it has been shot (see /api/employees/storyboards/[id]/shoot). */
  video?: ShotVideo | null
  /**
   * Every finished clip this slot has had, oldest first - the video takes, the
   * way `stills` keeps the still takes. Written only by the server (a reshoot
   * keeps the clip it replaces; a finished render is added), and the slot
   * plays whichever take `video` is; picking another goes through the shoot
   * route's `pick`, never the autosave.
   */
  videos?: ShotVideo[]
  /**
   * Every still this slot has had, oldest first. Make and Redo add one; the
   * slot shows whichever `stillUrl` points at, so an earlier take is one tap
   * away instead of lost to the redo.
   */
  stills?: StillVersion[]
  /**
   * Final Cut keeps this shot's whole clip instead of trimming it - for a
   * moment worth watching in full (the edit plan otherwise picks the window).
   */
  keepWhole?: boolean
  /** The scene this shot belongs to (StoryScene.id); absent on a board without scenes. */
  sceneId?: string
  /**
   * This still's own references, each switched on or off - set by the AI
   * draft (from the assets it says the shot shows) or by hand in Details.
   * Absent = automatic: the scene's cast, else the board's switched-on refs.
   */
  refs?: ShotRef[]
  /**
   * The still being made for this slot, on the SERVER (the still route writes
   * it): queued in a batch, being made, or failed. Every session of the
   * account reads it, so a refresh or another device still shows "Queued" /
   * the spinner, and queued stills carry on after a reload. Cleared when the
   * still lands (the route puts it on the slot itself). Never the page's to set.
   */
  stillJob?: StillJob | null
  /**
   * The shot whose still this one EDITS (its id): that still goes first among
   * the references, so a chain of edits - new outfit, new pose, new background
   * - keeps everything the prompt does not change. Absent = a fresh image.
   */
  editOf?: string
  /**
   * This still's own frame shape when it differs from the board's (a 4:1
   * panorama on a 4:3 board, a 9:16 poster...). The still is made in it; a
   * model that cannot render it is cropped or fitted to it. Videos and the
   * Final Cut stay in the board's frame; the Stills cut pans or fits it.
   */
  aspect?: string
  /**
   * A "before" picture (an upload, an old photo, another still): the still is
   * made as an edit of it, and the Stills cut plays before -> after with a wipe.
   */
  beforeUrl?: string | null
  /** The Stills cut's caption for this shot (empty = the AI writes one from the title). */
  caption?: string
  /** A smaller line under the caption. */
  captionSub?: string
}

/** Frame shapes a single still may take (SHOT_ASPECTS) - wider and taller than a board's. */
export const SHOT_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3', '4:5', '5:4', '4:1', '1:4', '8:1', '1:8'] as const
/** The frame a still is made in: its own, else the board's. */
export const shotAspect = (shot: Pick<StoryboardShot, 'aspect'>, boardAspect: string) =>
  shot.aspect && (SHOT_ASPECTS as readonly string[]).includes(shot.aspect) ? shot.aspect : boardAspect

/** One of a shot's own references; `assetId` = the asset it came from, if any. */
export type ShotRef = { id: string; url: string; on: boolean; assetId?: string }
export const MAX_SHOT_REFS = 40

export type StillJob = { status: 'queued' | 'making' | 'failed'; at: number; model?: string; error?: string }
/**
 * A still that has been "making" this long is dead (the route gives up at
 * 300s): the slot is free again. A queued one waits for a page to run it.
 */
export const STILL_JOB_STALE_MS = 6 * 60_000
/** The job as it stands now: a stale "making" counts as none. */
export function liveStillJob(j: StillJob | null | undefined, now = Date.now()): StillJob | null {
  if (!j) return null
  if (j.status === 'making' && now - j.at > STILL_JOB_STALE_MS) return null
  return j
}

/** One take of a slot's still. */
export type StillVersion = { url: string; prompt: string; model: string; at: number }
export const MAX_STILL_VERSIONS = 24
/** Video takes kept per slot - the oldest drop off first (they stay in My Generations). */
export const MAX_VIDEO_TAKES = 16
/**
 * A still's identity across signing: the page holds signed links and the
 * board stores canonical ones, but the file name (storyboard-<user>-<board>-
 * <time>.png) is the same in both.
 */
export const stillKey = (url: string) => url.split('?')[0].split('/').pop() ?? url

export type ShotVideo = {
  /** The GenerationQueue row the render owns. */
  queueId: number
  status: 'rendering' | 'done' | 'failed'
  url: string | null
  error: string | null
  /** Catalog id actually used, and the length actually requested. */
  model: string
  seconds: number
  /** The still and prompt it was shot from, so an edited slot shows it is out of date. */
  fromStill: string | null
  fromPrompt: string
  at: number
  /**
   * The clip as the model rendered it, when that was not the board's frame
   * (Kling 3.0 has no 3:4) - `url` is then the conformed copy (lib/storyboard-shoot).
   */
  rawUrl?: string | null
  /** The original's pixel size ("1080x1920"), to label the toggle between the two. */
  rawSize?: string | null
}

/** "1080x1920" -> "9:16" (the nearest common frame), else the pixel size. */
export function frameLabel(size: string | null | undefined): string {
  const [w, h] = String(size ?? '').split('x').map(Number)
  if (!(w > 0 && h > 0)) return 'Original'
  const r = Math.log(w / h)
  const known = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3', '4:5', '5:4']
  const best = known.reduce((b, k) => { const [a, c] = k.split(':').map(Number); const d = Math.abs(Math.log(a / c) - r); return d < b.d ? { k, d } : b }, { k: '', d: Infinity })
  return best.d < 0.03 ? best.k : `${w}×${h}`
}

export type StoryboardDoc = {
  id: number
  title: string
  story: string
  look: string
  aspect: string
  shots: StoryboardShot[]
  /** The cast, vehicles, props and places, each with its reference images. */
  assets: StoryAsset[]
  /** What kind of video this board plans (BOARD_MODES) - shapes drafting and the Final Cut. */
  mode: BoardModeId
  /** The board's scenes, in order (empty = one run of shots, no scenes). */
  scenes: StoryScene[]
  updatedAt?: string
}

// ── Board modes ──────────────────────────────────────────────────────────────
//
// What kind of video a board plans. A mode is a brief for the AI: the shape of
// the piece, what every shot must hold to, and how the Final Cut should edit
// it. It applies to every draft action (new board, polish, rewrite, extend),
// so a character board stays a character board when it is extended.
// `framing`: the kind puts characters on screen, so the Draft box offers the
// Framing choice (waist up / full body / mix) for it.

export const BOARD_MODES = [
  {
    id: 'story', label: 'Story', shots: 8, framing: true,
    blurb: 'A short film - beginning, middle and end, shots that cut together.',
    placeholder: 'Describe the video: who, where, what happens, the feeling…',
    brief: 'A short narrative film with a clear beginning, middle and end. Shots cut together into one continuous piece: motivated cuts, match cuts, continuity of light, place and time.',
    edit: 'Edit for story: let moments breathe, cut on action, dissolve only for time passing.',
  },
  {
    id: 'trailer', label: 'Trailer', shots: 10, framing: true,
    blurb: 'Hook, rising tension, a title beat - sells the film without spoiling it.',
    placeholder: 'The film being sold: genre, hero, the threat, the tone…',
    brief: 'A movie trailer. Open on an arresting hook, set up the world and the hero, escalate with faster and bigger moments, land a title beat near the end and a final sting after it. Tease, never resolve. Pace accelerates: early shots longer, late shots shorter.',
    edit: 'Edit like a trailer: start measured, accelerate, hard cuts and fade-to-black beats between acts, a sting after the title.',
  },
  {
    id: 'ad', label: 'Advertisement', shots: 8, framing: true,
    blurb: 'Hook in 2 seconds, desire, the product, the payoff, a brand end card.',
    placeholder: 'The brand and product, who it is for, the one thing it should make people feel or do…',
    brief: 'A video advertisement. Shot 1 is a scroll-stopping hook (under 3 seconds). Then the desire or problem, the product revealed as the answer, two or three benefits SHOWN not told, the payoff (the life with it), and a final brand / call-to-action shot with clean space for an end card. Every shot polished, commercial lighting, the product always recognisable. No on-screen text in the stills.',
    edit: 'Edit like a commercial: tight, rhythmic hard cuts, the hook short, the product reveal held a beat longer, end on the brand shot.',
  },
  {
    id: 'product', label: 'Product showcase', shots: 6, framing: false,
    blurb: 'The product is the hero of every shot, placed in full scenes.',
    placeholder: 'The product - what it is, its materials and colours - and the world it belongs in…',
    brief: 'A product showcase. THE PRODUCT IS THE HERO OF EVERY SHOT: describe it IDENTICALLY in every imagePrompt (same shape, materials, colours, logo placement) so it stays the same object. Place it in complete, believable scenes - in use, in its environment, in hero close-ups and detail macros - with premium product-photography lighting. Camera moves are slow and deliberate (orbits, push-ins, rack focus).',
    edit: 'Edit for the product: smooth dissolves and slow moves, each shot held long enough to see the product, end on the hero shot.',
  },
  {
    id: 'character', label: 'Character board', shots: 8, framing: true,
    blurb: 'One character, one outfit - every shot a different pose, angle and expression.',
    placeholder: 'The character - face, build, hair, the exact outfit - and the setting or backdrop…',
    brief: 'A character board: ONE character in ONE outfit throughout. Repeat the same full character and wardrobe description VERBATIM in every imagePrompt (face, hair, build, every garment and accessory, colours) so the model draws the same person every time. Each shot changes only the pose, action, camera angle, framing (full body, medium, close-up, profile, three-quarter, back) and expression. Keep one consistent backdrop or setting. Motion is small and in character (a turn, a gesture, a look).',
    edit: 'Edit as a character reel: steady hard cuts on the beat of each pose, every shot held long enough to read the character.',
  },
  {
    /*
     * For a character known only by their face: references that show little
     * or none of the body. Every shot is a head shot of that same face - the
     * angles, expressions and light a face library needs - and nothing below
     * the shoulders is invented. Always close, so no Framing choice.
     */
    id: 'face', label: 'Face study', shots: 8, framing: false,
    blurb: 'Face-only references in - the same face from every angle, expression and light.',
    placeholder: 'The character - add their face as references - and the look and lighting you want…',
    brief: 'A FACE STUDY. The reference images show a character\'s FACE, with little or none of the body. Every shot is a head shot of THAT SAME FACE: keep every facial feature identical to the references - face shape, jaw and chin, eyes and eye colour, brows, nose, lips, ears, skin tone, freckles, marks and scars, hair colour, hairline and hairstyle, age - and repeat the same full face description VERBATIM in every imagePrompt. Vary only the angle (front, three-quarter left, three-quarter right, profile, slightly high, slightly low, looking back over the shoulder), the expression (neutral, gentle smile, laugh, serious, surprised, thoughtful, determined), where the eyes look, and the light (soft beauty key, window light, rim light, dramatic side light, golden hour). Frame close-ups, extreme close-ups and head-and-shoulders portraits only: never show or invent the body below the shoulders, and never change the identity, age or features of the face. Keep clothing at the neckline simple and the same throughout. A plain or softly blurred backdrop so the face reads. Motion is small and natural: a blink, a breath, a slow turn of the head, a change of expression, a gentle push-in.',
    edit: 'Edit as a portrait reel: gentle cuts or slow dissolves, every face held long enough to read the expression.',
  },
  {
    id: 'lookbook', label: 'Fashion lookbook', shots: 8, framing: true,
    blurb: 'One model and setting, a different look in every shot.',
    placeholder: 'The model, the setting, the collection - colours, fabrics, the mood…',
    brief: 'A fashion lookbook film. The same model (describe them identically every time) in the same setting and light; each shot is a NEW LOOK described garment by garment, with an editorial pose. Camera language of a fashion film: walking shots, slow turns, fabric in motion, detail close-ups of texture and accessories.',
    edit: 'Edit like a fashion film: cut on the walk and the turn, one look per beat, smooth and confident.',
  },
  {
    /*
     * The garments alone - no model, no mannequin with a face - for building a
     * library of a specific outfit. Each outfit (a Wardrobe asset, or one
     * named in the brief) becomes its own scene with that asset attached, so
     * every still of an outfit is made from that outfit's own photos only.
     * `shots` here is per outfit.
     */
    id: 'outfit', label: 'Outfit pack', shots: 6, framing: false,
    blurb: 'No people - each outfit shot from every angle, as clean assets.',
    placeholder: 'The outfit(s) - or add them as Wardrobe assets - and the backdrop you want…',
    brief: 'An OUTFIT ASSET PACK: the clothes themselves, with NO PEOPLE - no model, no body, no face, no hands, no mannequin head. Each outfit is shot as a set of clean, consistent product photographs of the garments alone, for example: a front flat lay of the whole outfit, a back flat lay, an invisible / ghost-mannequin front (the clothes holding their 3D shape with nothing inside), a ghost-mannequin side or three-quarter view, on a hanger against a plain wall, close-up detail macros (fabric weave, stitching, buttons, zips, hardware, trims), the shoes and accessories arranged together, and one styled still life. Describe EVERY garment of the outfit IDENTICALLY in every shot of that outfit - cut, colour, material, pattern, every visible detail from its reference photos - so it stays the same clothes. One backdrop for the whole pack (seamless paper or a plain surface, soft even studio light, gentle shadows) unless the brief asks for another. Never add a person. No readable text or brand names unless they are on the reference garment. Motion is minimal and product-like: a slow turntable spin, fabric settling, a gentle push-in or orbit.',
    edit: 'Edit as a clean product reel: grouped by outfit, steady cuts or quick dissolves, every shot held long enough to read the garment.',
  },
  {
    id: 'music', label: 'Music video', shots: 10, framing: true,
    blurb: 'Performance and story B-roll, cut to a beat.',
    placeholder: 'The song - genre, tempo, mood - the artist, the visual concept…',
    brief: 'A music video. Alternate performance shots (the artist performing, consistent look) with concept / story B-roll that carries a visual idea. Strong stylised lighting, bold compositions, motion that would cut on a beat. Shots are short (2-4 seconds) except one or two signature moments.',
    edit: 'Edit to the music: short hard cuts on the beat, a couple of held signature shots, energy building to the end.',
  },
  {
    id: 'social', label: 'Social short', shots: 6, framing: true,
    blurb: 'Vertical-first, a thumb-stopping first shot, fast beats, a loopable end.',
    placeholder: 'The idea in one line - the hook, the payoff, who it is for…',
    brief: 'A short-form social video (Reels / TikTok / Shorts). The first shot must stop the scroll in under 2 seconds. Fast beats, one idea, a satisfying payoff, and a last shot that loops back into the first. Compose for a phone screen: subject large and centred, close framing.',
    edit: 'Edit for social: fast hard cuts, no slow fades, the end flowing back into the start.',
  },
  {
    id: 'location', label: 'Location tour', shots: 8, framing: false,
    blurb: 'A place shown space by space - property, venue, destination.',
    placeholder: 'The place - what it is, its style, the spaces and views worth showing…',
    brief: 'A location tour (property, venue, hotel, destination). Open on an establishing exterior or vista, then move through the space in a logical path - arrival, main spaces, details, the signature view - ending on the best shot. Architectural / travel photography: level verticals, wide lenses, golden or soft natural light, smooth gimbal and drone moves.',
    edit: 'Edit as a tour: smooth dissolves and directional moves that carry you from one space to the next.',
  },
  {
    id: 'explainer', label: 'Explainer', shots: 7, framing: false,
    blurb: 'How something works, step by step, in clear visuals.',
    placeholder: 'What is being explained, to whom, the steps or idea in order…',
    brief: 'An explainer: show how something works or how to do something, one clear step per shot, in order. Clean, uncluttered compositions with the subject obvious; consistent style (e.g. one setting or one visual language) across shots; the last shot shows the result or the takeaway.',
    edit: 'Edit for clarity: steady pacing, simple cuts, each step held long enough to understand.',
  },
] as const
export type BoardModeId = (typeof BOARD_MODES)[number]['id']

/**
 * How the characters are framed, for the kinds of video with people in them.
 * Mix is no rule at all - the kind of video and the shot decide. The rest go
 * tightest to widest (the picker shows them in this order, three a row).
 */
export const FRAMINGS = [
  { id: 'mix', label: 'Mix', hint: 'No rule - each shot frames itself' },
  { id: 'close', label: 'Close-up', hint: 'Faces: head and shoulders - expression and likeness first' },
  { id: 'waist', label: 'Waist up', hint: 'Medium shots and closer - no full-body shots' },
  { id: 'knee', label: 'Knee up', hint: 'Cut at the knees - more of the outfit and pose than waist up, still close enough for the face' },
  { id: 'full', label: 'Full body', hint: 'Head to toe in frame, feet visible' },
  { id: 'wide', label: 'Wide', hint: 'The place first - characters full-body and small in a big setting' },
] as const
export type FramingId = (typeof FRAMINGS)[number]['id']
export const isFraming = (v: unknown): v is FramingId => FRAMINGS.some(f => f.id === v)
/** The planner's rule for a framing (empty for mix). It overrides any framing the kind of video suggests. */
export function framingRule(f: FramingId): string {
  if (f === 'close') return 'FRAMING - CLOSE-UP: frame the characters\' faces in (nearly) every shot - close-ups and medium close-ups showing the head and shoulders, cut at or above the chest, so expression and likeness carry the story; now and then an extreme close-up of the eyes, the hands or a telling detail. Do NOT plan waist-up, full-body or wide shots of the characters; an establishing shot of a place may be wide only if the characters are absent or tiny in it. Say the framing in every imagePrompt (e.g. "close-up, head and shoulders"). This overrides any other framing the brief above suggests.'
  if (f === 'knee') return 'FRAMING - KNEE UP: frame the characters from the knees up in (nearly) every shot - medium-long ("American" / cowboy) shots cut at or just above the knees, showing the head, the whole torso, the hands and most of the legs, so the outfit and the pose read as well as the face. Do NOT plan full-body shots that show the feet, and do not go tighter than waist-up except for an occasional close-up insert; an establishing shot of a place may be wide only if the characters are absent or tiny in it. Say the framing in every imagePrompt (e.g. "knee-up medium-long shot, cut at the knees"). This overrides any other framing the brief above suggests.'
  if (f === 'wide') return 'FRAMING - WIDE: frame the characters within their setting in (nearly) every shot - wide and extreme-wide shots where the place matters as much as the people: the characters full-body and small to mid-size in the frame, with plenty of environment around them (architecture, landscape, sky, crowd). At most an occasional full shot or close-up insert; no run of tight shots. Say the framing in every imagePrompt (e.g. "wide shot, characters small in the frame"). This overrides any other framing the brief above suggests.'
  if (f === 'waist') return 'FRAMING - WAIST UP: frame the characters from the waist up in (nearly) every shot - medium shots, medium close-ups, close-ups and over-the-shoulder shots that show the head, shoulders, torso and hands, cut off at or above the waist. Do NOT plan full-body or wide shots that show a character\'s legs or feet; an establishing shot of a place may be wide only if the characters are absent or tiny in it. Say the framing in every imagePrompt (e.g. "waist-up medium shot"). This overrides any other framing the brief above suggests.'
  if (f === 'full') return 'FRAMING - FULL BODY: frame the characters head to toe in (nearly) every shot - full shots and wide shots with the feet in frame and a little room above the head and below the feet; at most an occasional close-up insert of a detail. Say the framing in every imagePrompt (e.g. "full-body shot, head to toe"). This overrides any other framing the brief above suggests.'
  return ''
}
export type BoardMode = (typeof BOARD_MODES)[number]
export const boardMode = (id: string | null | undefined): BoardMode => BOARD_MODES.find(m => m.id === id) ?? BOARD_MODES[0]
export const isBoardMode = (id: unknown): id is BoardModeId => BOARD_MODES.some(m => m.id === id)

// ── Assets ───────────────────────────────────────────────────────────────────
//
// What a cut is made of - characters, vehicles, objects, places - each a set of
// reference images. Any ref of any asset can be switched on, and the switched-on
// refs (in asset order) go with the next still, up to what that still's model
// takes. Lives on the board (Storyboard.assets), autosaved with it.

export const ASSET_KINDS = [
  { id: 'character', label: 'Character' },
  { id: 'creature', label: 'Creature' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'object', label: 'Object / prop' },
  { id: 'wardrobe', label: 'Wardrobe' },
  { id: 'location', label: 'Location' },
  { id: 'landmark', label: 'Landmark' },
  { id: 'scenery', label: 'Scenery' },
  { id: 'style', label: 'Style / look' },
  { id: 'other', label: 'Other' },
] as const
export type AssetKind = (typeof ASSET_KINDS)[number]['id']
/**
 * One picture of an asset. `caption` (2026-10-08): what's distinct about THIS
 * picture - the angle, pose, expression, outfit detail - written by hand or by
 * Auto caption (Gemini), with short `tags`. The AI draft reads them to pick the
 * right pictures for each shot instead of sending all of an asset's photos.
 */
export type AssetRef = { id: string; url: string; active: boolean; caption?: string; tags?: string[] }
export const MAX_CAPTION = 300
export const cleanCaption = (c: unknown) => (typeof c === 'string' ? c.trim().slice(0, MAX_CAPTION) : '')
export const cleanTags = (t: unknown): string[] =>
  Array.isArray(t) ? [...new Set(t.filter((x): x is string => typeof x === 'string').map(x => x.trim().toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 8) : []
/**
 * `libraryId`: the account's saved asset (UserAsset, lib/user-assets) this
 * board copy came from or was saved to - "Save to My Assets" updates that one
 * rather than making another. The board keeps its own copy either way.
 */
export type StoryAsset = { id: string; kind: AssetKind; name: string; notes: string; refs: AssetRef[]; libraryId?: number }
export const MAX_ASSETS = 40
export const MAX_ASSET_REFS = 24

const newId = (p: string) => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${p}${Date.now()}${Math.random().toString(36).slice(2, 9)}`)
export const newAsset = (kind: AssetKind, name: string): StoryAsset => ({ id: newId('a'), kind, name, notes: '', refs: [] })
export const newAssetRef = (url: string, active = true): AssetRef => ({ id: newId('r'), url, active })

export function sanitizeAssets(raw: unknown): StoryAsset[] {
  if (!Array.isArray(raw)) return []
  const kinds = ASSET_KINDS.map(k => k.id) as string[]
  return raw.slice(0, MAX_ASSETS).map((a: any) => ({
    id: str(a?.id, 64) || newId('a'),
    kind: (kinds.includes(a?.kind) ? a.kind : 'other') as AssetKind,
    name: str(a?.name, 80) || 'Untitled',
    notes: str(a?.notes, 1000),
    ...(Number.isInteger(a?.libraryId) && a.libraryId > 0 ? { libraryId: a.libraryId as number } : {}),
    refs: (Array.isArray(a?.refs) ? a.refs : [])
      .filter((r: any) => /^https:\/\//.test(str(r?.url, 2000)))
      .slice(0, MAX_ASSET_REFS)
      .map((r: any) => {
        const caption = cleanCaption(r?.caption), tags = cleanTags(r?.tags)
        return { id: str(r?.id, 64) || newId('r'), url: str(r?.url, 2000), active: r?.active === true, ...(caption ? { caption } : {}), ...(tags.length ? { tags } : {}) }
      }),
  }))
}

/** The switched-on refs, in asset order then ref order. */
export const activeAssetRefs = (assets: StoryAsset[]) => assets.flatMap(a => a.refs.filter(r => r.active).map(r => ({ ...r, assetId: a.id, assetName: a.name })))

// ── Scenes ───────────────────────────────────────────────────────────────────

export type StoryScene = {
  id: string
  title: string
  /** The slug line: where and when ("INT. LIGHTHOUSE - NIGHT"). */
  setting: string
  /** What happens in the scene - what its shots are drafted from. */
  summary: string
  /**
   * The board assets in this scene (its cast, the location, the outfit...).
   * Their references go with every still made in the scene, in place of the
   * board-wide switched-on set - so scene 3's stills carry scene 3's cast.
   */
  assetIds: string[]
  /**
   * The scene as a reference for the AI draft (2026-10-08): `asRef` switches
   * the whole scene on, and its stills become pictures the draft may hand to
   * new shots ("Scene 2 #3") - the same faces, set and outfits carried into
   * the scenes that follow. `refOff` = the shots of it left out. A still made
   * later in a switched-on scene joins automatically. See sceneRefAssets.
   */
  asRef?: boolean
  refOff?: string[]
}
export const MAX_SCENES = 30
export const newScene = (partial: Partial<StoryScene> = {}): StoryScene => ({
  title: '', setting: '', summary: '', assetIds: [], ...partial, id: partial.id || newId('c'),
})

export function sanitizeScenes(raw: unknown): StoryScene[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StoryScene[] = []
  for (const r of raw.slice(0, MAX_SCENES) as any[]) {
    const id = str(r?.id, 64) || newId('c')
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      title: str(r?.title, 120),
      setting: str(r?.setting, 160),
      summary: str(r?.summary, 2000),
      assetIds: (Array.isArray(r?.assetIds) ? r.assetIds : []).filter((x: unknown) => typeof x === 'string').slice(0, MAX_ASSETS).map((x: string) => x.slice(0, 64)),
      ...(r?.asRef === true ? { asRef: true } : {}),
      ...(r?.asRef === true && Array.isArray(r?.refOff) && r.refOff.length
        ? { refOff: (r.refOff as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, MAX_SHOTS).map(x => x.slice(0, 64)) }
        : {}),
    })
  }
  return out
}

/** A still's description, from its shot: the title and the plain-language "what we see". */
export const shotCaption = (s: Pick<StoryboardShot, 'title' | 'description' | 'imagePrompt'>) => {
  const what = (s.description || s.imagePrompt.split(/(?<=[.!?])\s/)[0] || '').trim()
  return [s.title.trim(), what].filter(Boolean).join(': ').slice(0, MAX_CAPTION)
}

/** How the draft names a scene used as a reference: "Scene 2". */
export const sceneRefName = (k: number) => `Scene ${k + 1}`
/** The id a scene's pseudo-asset carries ("scene:<scene id>") - never a board asset's. */
export const SCENE_REF_PREFIX = 'scene:'

/** The shots of a scene that go into its reference set: those with a still, minus the ones left out. */
export const sceneRefShots = (shots: StoryboardShot[], scene: StoryScene) =>
  scene.asRef ? shots.filter(s => s.sceneId === scene.id && s.stillUrl && !scene.refOff?.includes(s.id)) : []

/**
 * The switched-on scenes as assets the AI draft can pick pictures from: one
 * per scene, named "Scene N", each still described from its own shot (led by
 * the scene's name, the same shape Auto caption writes). Not stored - built
 * from the board each time, so a remade still is the one that goes.
 */
export function sceneRefAssets(board: { scenes: StoryScene[]; shots: StoryboardShot[] }): StoryAsset[] {
  return board.scenes.flatMap((c, k) => {
    const own = sceneRefShots(board.shots, c)
    if (!own.length) return []
    const name = sceneRefName(k)
    const about = [c.title, c.setting, c.summary].filter(Boolean).join(' - ').slice(0, 1000)
    return [{
      id: `${SCENE_REF_PREFIX}${c.id}`, kind: 'other' as AssetKind, name, notes: about,
      refs: own.map(s => ({ id: `s${s.id}`, url: s.stillUrl!, active: false, caption: `${name} - ${shotCaption(s)}`.slice(0, MAX_CAPTION) })),
    }]
  }).slice(0, MAX_SCENES)
}

/**
 * Shots in scene order. Every shot is placed in a scene that exists (a shot
 * with none, or a deleted scene's, joins the first), and within a scene shots
 * keep their order. A board without scenes comes back with no scene ids.
 */
export function orderByScenes(shots: StoryboardShot[], scenes: StoryScene[]): StoryboardShot[] {
  if (!scenes.length) return shots.some(s => s.sceneId) ? shots.map(({ sceneId: _drop, ...s }) => s) : shots
  const rank = new Map(scenes.map((c, i) => [c.id, i]))
  return shots
    .map((s, i) => {
      const placed = s.sceneId && rank.has(s.sceneId) ? s : { ...s, sceneId: scenes[0].id }
      return { s: placed, i, r: rank.get(placed.sceneId!)! }
    })
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.s)
}

/**
 * Shots always live in a scene: a board with shots and no scenes (one made
 * before scenes, or drafted as a single run) gets a Scene 1 holding them all,
 * and the shots are put in scene order. An empty board stays without scenes.
 */
export function ensureScenes<T extends { shots: StoryboardShot[]; scenes: StoryScene[] }>(b: T): T {
  if (b.scenes.length) return { ...b, shots: orderByScenes(b.shots, b.scenes) }
  if (!b.shots.length) return b
  const first = newScene()
  return { ...b, scenes: [first], shots: b.shots.map(s => ({ ...s, sceneId: first.id })) }
}

/** The shots of one scene, in order. */
export const sceneShots = (shots: StoryboardShot[], sceneId: string) => shots.filter(s => s.sceneId === sceneId)

type RefOut = { id: string; url: string; assetId?: string; assetName?: string }

/**
 * The references a shot's still is made with, before the model's limit: the
 * shot's own list when it has one (the switched-on ones), else automatic -
 * see autoShotRefs.
 */
export function shotRefs(board: Pick<StoryboardDoc, 'assets' | 'scenes'>, shot: Pick<StoryboardShot, 'sceneId' | 'refs'>): RefOut[] {
  if (Array.isArray(shot.refs)) {
    return shot.refs.filter(r => r.on).map(r => ({ id: r.id, url: r.url, assetId: r.assetId, assetName: board.assets.find(a => a.id === r.assetId)?.name }))
  }
  return autoShotRefs(board, shot)
}

/**
 * Automatic references, for a shot without its own list: every photo of the
 * assets cast in its scene - else none. Assets have no switches any more
 * (2026-10-05): the AI draft gives each shot its own list, and a shot added
 * by hand gets one from "Match references" or its Details.
 */
export function autoShotRefs(board: Pick<StoryboardDoc, 'assets' | 'scenes'>, shot: Pick<StoryboardShot, 'sceneId'>): RefOut[] {
  const scene = shot.sceneId ? board.scenes?.find(c => c.id === shot.sceneId) : undefined
  if (!scene?.assetIds.length) return []
  return scene.assetIds.flatMap(id => {
    const a = board.assets.find(x => x.id === id)
    return a ? a.refs.map(r => ({ id: r.id, url: r.url, assetId: a.id, assetName: a.name })) : []
  })
}

/**
 * A board from the days of switched-on refs: the shots that used them (no
 * list of their own, no scene cast) get those refs as their own list - so
 * nothing changes for them, and it is now visible in Details - and the
 * switches are cleared. Null when there is nothing to convert.
 */
export function migrateActiveRefs<T extends Pick<StoryboardDoc, 'assets' | 'scenes' | 'shots'>>(b: T): T | null {
  const on = activeAssetRefs(b.assets)
  if (!on.length) return null
  const shots = b.shots.map(s => {
    const scene = s.sceneId ? b.scenes.find(c => c.id === s.sceneId) : undefined
    if (Array.isArray(s.refs) || scene?.assetIds.length) return s
    return { ...s, refs: on.map(r => ({ id: newId('r'), url: r.url, on: true, assetId: r.assetId })).slice(0, MAX_SHOT_REFS) }
  })
  return { ...b, shots, assets: b.assets.map(a => ({ ...a, refs: a.refs.map(r => ({ ...r, active: false })) })) }
}

/** How the AI draft names one picture: "<asset name> #<n>" (1-based). */
export const photoLabel = (a: Pick<StoryAsset, 'name'>, k: number) => `${a.name} #${k + 1}`

/**
 * The pictures the AI draft named for a shot ("Mara #2", "Red dress #1"...),
 * from any asset, as the shot's own list. Labels that don't match are dropped;
 * none matching = null (the caller falls back to whole assets).
 */
export function refsFromPhotos(assets: StoryAsset[], labels: unknown): ShotRef[] | null {
  if (!Array.isArray(labels)) return null
  const out: ShotRef[] = []
  const seen = new Set<string>()
  for (const raw of labels) {
    if (typeof raw !== 'string') continue
    const m = raw.trim().match(/^(.*?)\s*#\s*(\d+)$/)
    if (!m) continue
    const name = m[1].trim().toLowerCase(), k = parseInt(m[2]) - 1
    const a = assets.find(x => x.name.trim().toLowerCase() === name)
    const r = a?.refs[k]
    if (!a || !r || seen.has(r.url)) continue
    seen.add(r.url)
    out.push({ id: newId('r'), url: r.url, on: true, assetId: a.id })
    if (out.length >= MAX_SHOT_REFS) break
  }
  return out.length ? out : null
}

/**
 * Models that need EVERY reference slot filled to hold a character's likeness
 * (2026-10-08). Their few slots (2-5: Ideogram 4.5, FLUX 2, Qwen, Grok, Luma
 * Uni, Wan 2.7...) are all the identity they get, and the owner saw an
 * Ideogram character board made from one picture each while the asset had
 * eleven. Models with many slots (Nano Banana's 14) stay with the plan's own
 * picks - more pictures there do not help.
 */
export const isRefHungryModel = (id: string) => {
  const n = stillModelSpec(id).maxRefs
  return n >= 2 && n <= 5
}

/**
 * A shot's list topped up to its model's slots with more pictures of the
 * characters / creatures already in it, for a ref-hungry model: those
 * pictures go after the plan's picks (so "the first reference image" in the
 * prompt still means the same one), a turn from each character at a time,
 * in each asset's order (Auto caption sorts it best-first, then by view). An
 * edit's source still takes one slot. Other models' lists come back as is.
 */
export function fillCharacterSlots(assets: StoryAsset[], refs: ShotRef[], model: string, editing: boolean): ShotRef[] {
  if (!isRefHungryModel(model)) return refs
  const room = stillModelSpec(model).maxRefs - (editing ? 1 : 0) - refs.length
  if (room <= 0) return refs
  const cast = [...new Set(refs.map(r => r.assetId).filter((x): x is string => !!x))]
    .map(id => assets.find(a => a.id === id))
    .filter((a): a is StoryAsset => !!a && (a.kind === 'character' || a.kind === 'creature'))
  if (!cast.length) return refs
  const have = new Set(refs.map(r => stillKey(r.url)))
  const queues = cast.map(a => a.refs.filter(r => !have.has(stillKey(r.url))).map(r => ({ url: r.url, assetId: a.id })))
  const extra: ShotRef[] = []
  for (let k = 0; extra.length < room && queues.some(q => q.length); k = (k + 1) % queues.length) {
    const next = queues[k].shift()
    if (next) extra.push({ id: newId('r'), url: next.url, on: true, assetId: next.assetId })
  }
  return [...refs, ...extra]
}

/** Every ref of these assets, switched on - a shot's list as the AI draft sets it. */
export function refsFromAssets(assets: StoryAsset[], ids: string[]): ShotRef[] {
  return ids.flatMap(id => {
    const a = assets.find(x => x.id === id)
    return a ? a.refs.map(r => ({ id: newId('r'), url: r.url, on: true, assetId: a.id })) : []
  }).slice(0, MAX_SHOT_REFS)
}

/** The shot this one edits, when it still exists and has a still. */
export function editSource(shots: Pick<StoryboardShot, 'id' | 'stillUrl' | 'title'>[], shot: Pick<StoryboardShot, 'editOf' | 'id'>) {
  if (!shot.editOf || shot.editOf === shot.id) return null
  const src = shots.find(s => s.id === shot.editOf)
  return src?.stillUrl ? src : null
}

/**
 * Every reference a still is made with, in the order the model sees them: the
 * "before" picture, then the still it edits, then its own refs (a turn from
 * each asset) - as many as the model takes. URLs, deduplicated.
 */
export function stillRefUrls(board: Pick<StoryboardDoc, 'assets' | 'scenes' | 'shots'>, shot: StoryboardShot, max: number): string[] {
  const lead = [shot.beforeUrl, editSource(board.shots, shot)?.stillUrl].filter((u): u is string => !!u)
  const seen = new Set(lead.map(stillKey))
  const own = shotRefs(board, shot).filter(r => !seen.has(stillKey(r.url)))
  return [...lead, ...pickRefs(own, Math.max(0, max - lead.length)).map(r => r.url)].slice(0, Math.max(0, max))
}

/**
 * The refs that fit the model: when there are more than it takes, they are
 * taken in turns from each asset (one of each, then a second of each...), so
 * two characters with six photos each both make it into a four-ref model.
 */
export function pickRefs<T extends { assetId?: string }>(list: T[], max: number): T[] {
  if (max <= 0) return []
  if (list.length <= max) return list
  const groups = new Map<string, T[]>()
  for (const r of list) {
    const k = r.assetId ?? '_own'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const queues = [...groups.values()]
  const out: T[] = []
  for (let i = 0; out.length < max; i++) {
    let any = false
    for (const q of queues) {
      if (i < q.length) { out.push(q[i]); any = true; if (out.length >= max) break }
    }
    if (!any) break
  }
  return out
}

// ── A still model's knobs: quality options, reference limit, ticket price ───
// From the chat hub's create catalog (lib/chat-hub-models), so a storyboard
// still is priced and limited exactly like the same model anywhere else.

/**
 * One setting a still's model offers in the shot's Details. `key` 'quality'
 * is the shot's imageQuality; any other key lives in imageOptions and is
 * passed to the model's builder (lib/fal-image-models reads it from
 * ctx.options under the same name). `as` says how the builder wants it.
 */
export type StillSetting = {
  key: string
  label: string
  options: { value: string; label: string }[]
  def: string
  as?: 'bool' | 'number'
  /** One line on what it changes (the control's tooltip). */
  hint?: string
  /** Shown to admins only - the routes ignore it for everyone else (publicStillSafety). */
  admin?: boolean
}
const o = (...vals: (string | [string, string])[]) => vals.map(v => Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v.toUpperCase() })
const RES = (vals: string[], def: string): StillSetting => ({ key: 'quality', label: 'Resolution', options: o(...vals), def })

/*
 * The settings of the models built from lib/fal-image-models (buildFalCall's
 * registry fallback) - the chat hub's catalog has no fields for them, which is
 * why FLUX 3 & co showed no resolution at all. Mirrors the portal's prompt bar
 * (IMAGE_MODEL_CONFIGS qualityOptions) and the ctx.options each builder reads.
 * Defaults are what the still route used before, so nothing re-prices itself.
 */
const REGISTRY_STILL_SETTINGS: Record<string, StillSetting[]> = {
  'gpt-image-2.5': [
    RES(['1k', '2k', '4k'], '2k'),
    { key: 'gptVariant', label: 'Renderer', options: o(['sunburst', 'Sunburst'], ['flare', 'Flare']), def: 'sunburst', hint: 'Two renderers of the same model - Flare leans more stylised' },
  ],
  'ideogram-4.5': [
    { key: 'quality', label: 'Quality', options: o(['low', 'Low'], ['medium', 'Medium'], ['high', 'High']), def: 'medium', hint: 'Size is always the largest for the frame; quality sets the detail' },
  ],
  'ideogram-v4': [
    RES(['1k', '2k'], '2k'),
    { key: 'ideogramRenderingSpeed', label: 'Speed', options: o(['TURBO', 'Turbo'], ['BALANCED', 'Balanced'], ['QUALITY', 'Quality']), def: 'BALANCED' },
    { key: 'ideogramExpansionModel', label: 'Magic prompt', options: o(['None', 'Off'], ['Medium', 'Medium'], ['Large', 'Large']), def: 'Medium', hint: 'Lets Ideogram expand the prompt - Off keeps it word for word' },
  ],
  'flux-3-image': [RES(['1k', '2k', '4k'], '2k')],
  'qwen-image-3': [
    RES(['1k', '2k'], '2k'),
    { key: 'qwenPromptExpansion', label: 'Prompt expansion', options: o(['true', 'On'], ['false', 'Off']), def: 'true', as: 'bool' },
  ],
  // Thinking and web search as in the portal (lib/fal-image-models nb21Knobs);
  // both priced by nb21TicketCost
  'nano-banana-2.1': [
    RES(['1k', '2k', '4k'], '2k'),
    { key: 'nb21Thinking', label: 'Thinking', options: o(['minimal', 'Minimal'], ['medium', 'Medium'], ['high', 'High']), def: 'medium', hint: 'High plans complex scenes, text and many references more carefully' },
    { key: 'nb21WebSearch', label: 'Web search', options: o(['false', 'Off'], ['true', 'On']), def: 'false', as: 'bool', hint: 'Looks up real, current facts (an infographic, a landmark, today\'s news) before drawing' },
    // As the portal's admin picker (nb21Knobs reads it); everyone else is held at 4 by publicStillSafety
    { key: 'nb21SafetyTolerance', label: 'Safety', options: o(['1', '1 - strictest'], ['2', '2'], ['3', '3'], ['4', '4 - what users get'], ['5', '5'], ['6', '6 - most permissive']), def: '6', admin: true, hint: 'Safety tolerance (admins only). Everyone else runs at 4.' },
  ],
  'grok-imagine-2': [
    RES(['1k', '2k'], '2k'),
    { key: 'grokQuality', label: 'Detail', options: o(['low', 'Low'], ['medium', 'Medium']), def: 'medium' },
  ],
  'bria-fibo': [
    { key: 'quality', label: 'Resolution', options: o(['1k', '1MP'], ['4k', '4MP']), def: '4k' },
    { key: 'briaStyle', label: 'Style', options: o(['none', 'None'], ['photoreal', 'Photoreal'], ['illustration', 'Illustration'], ['cinematic', 'Cinematic']), def: 'none' },
  ],
  'krea-2-large': [{ key: 'kreaCreativity', label: 'Creativity', options: o(['raw', 'Raw'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']), def: 'medium', hint: 'Raw follows the prompt closely; High takes more liberties' }],
  'luma-photon': [{ key: 'lumaStrength', label: 'Reference pull', options: o(['0.3', 'Light'], ['0.6', 'Medium'], ['0.9', 'Strong']), def: '0.6', as: 'number', hint: 'How closely it keeps the first reference (only with refs on)' }],
  'luma-uni-1': [{ key: 'lumaUniStyle', label: 'Style', options: o(['auto', 'Auto'], ['manga', 'Manga']), def: 'auto' }],
}
REGISTRY_STILL_SETTINGS['krea-2-medium'] = REGISTRY_STILL_SETTINGS['krea-2-large']
REGISTRY_STILL_SETTINGS['krea-2-medium-turbo'] = REGISTRY_STILL_SETTINGS['krea-2-large']
REGISTRY_STILL_SETTINGS['luma-photon-flash'] = REGISTRY_STILL_SETTINGS['luma-photon']
REGISTRY_STILL_SETTINGS['luma-uni-1-max'] = REGISTRY_STILL_SETTINGS['luma-uni-1']

/** Every setting this still model offers, quality first. Empty = the model has none (it renders one size). */
export function stillSettings(id: string): StillSetting[] {
  const reg = REGISTRY_STILL_SETTINGS[id]
  if (reg) return reg
  // Hand-built models: their quality field from the chat hub's catalog
  const q = getCreateModel(id)?.fields?.find(f => f.key === 'quality')
  if (!q || q.options.length < 2) return []
  const label = q.options.every(x => /^\dk$/.test(x)) ? 'Resolution' : 'Quality'
  return [{ key: 'quality', label, options: o(...q.options.map(x => /^\dk$/.test(x) ? x : [x, x[0].toUpperCase() + x.slice(1)] as [string, string])), def: q.def }]
}

/** The shot's value for one setting, falling back to its default. */
export function stillSettingValue(set: StillSetting, quality: string | undefined, options: Record<string, string> | undefined): string {
  const v = set.key === 'quality' ? quality : options?.[set.key]
  return v && set.options.some(x => x.value === v) ? v : set.def
}

/**
 * A shot's options as the model's builder takes them: only known keys with
 * allowed values, typed per `as`. Server-side guard and client both use it.
 */
export function stillBuildOptions(id: string, options: unknown): Record<string, string | number | boolean> {
  const src = options && typeof options === 'object' ? options as Record<string, unknown> : {}
  const out: Record<string, string | number | boolean> = {}
  for (const set of stillSettings(id)) {
    if (set.key === 'quality') continue
    const raw = typeof src[set.key] === 'string' ? src[set.key] as string : ''
    const v = set.options.some(x => x.value === raw) ? raw : set.def
    out[set.key] = set.as === 'bool' ? v === 'true' : set.as === 'number' ? Number(v) : v
  }
  return out
}

export type StillModelSpec = { qualities: string[]; defQuality: string; maxRefs: number; settings: StillSetting[] }
export function stillModelSpec(id: string): StillModelSpec {
  const m = getCreateModel(id)
  const settings = stillSettings(id)
  const q = settings.find(s => s.key === 'quality')
  return {
    qualities: q?.options.map(x => x.value) ?? [],
    defQuality: q?.def ?? '',
    maxRefs: m?.noRefs ? 0 : Math.max(0, m?.maxRefs ?? 0),
    settings,
  }
}
/** GPT Image takes pixel sizes, not ratios: the nearest it offers to the board's frame. */
export const GPT_SIZE_FOR_ASPECT: Record<string, string> = {
  '16:9': '1920x1080', '21:9': '1920x1080', '9:16': '1024x1536', '3:4': '1024x1536', '4:3': '1024x768', '1:1': '1024x1024',
}
/**
 * Tickets for one still on this model with these settings and frame (what a
 * user would pay) - the registry models priced as app/api/generate prices
 * them, so a 4K FLUX 3 or a high Ideogram costs what it does in the portal.
 */
export function stillTickets(id: string, quality: string | undefined, aspect: string, options?: Record<string, string>, refs = 0): number {
  const m = getCreateModel(id)
  if (!m) return 0
  const spec = stillModelSpec(id)
  const q = quality && spec.qualities.includes(quality) ? quality : spec.defQuality || undefined
  const opt = (key: string) => {
    const set = spec.settings.find(s => s.key === key)
    return set ? stillSettingValue(set, q, options) : undefined
  }
  try {
    if (REGISTRY_STILL_SETTINGS[id] || !m.fields) {
      switch (id) {
        case 'gpt-image-2.5': return gptImage25TicketCost({ quality: q ?? '2k', aspectRatio: aspect, refCount: refs })
        case 'nano-banana-2.1': return nb21TicketCost({ quality: q ?? '2k', refCount: refs, thinking: opt('nb21Thinking'), webSearch: opt('nb21WebSearch') === 'true' })
        case 'flux-3-image': return flux3ImageTicketCost({ quality: q, aspectRatio: aspect, refs })
        case 'qwen-image-3': return (q === '1k' ? 1 : 2) + (refs > 0 ? 1 : 0)
        case 'ideogram-v4': return ideogramTicketCost({ tier: id, quality: q, aspectRatio: aspect, ref: refs > 0, speed: opt('ideogramRenderingSpeed'), expansion: opt('ideogramExpansionModel') })
        case 'grok-imagine-2': return getTicketCost(refs > 0 ? 'grok-imagine-2-edit' : id, q)
        case 'mai-image-2.5-pro': return getTicketCost(refs > 0 ? 'mai-image-2.5-pro-edit' : id, q)
        default: return getTicketCost(id, q)
      }
    }
    // The chat catalog prices Z-Image Turbo flat; the portal charges by size
    if (id === 'z-image-turbo') return q === '4k' ? 8 : q === '2k' ? 2 : 1
    const size = id === 'gpt-image-2' ? (GPT_SIZE_FOR_ASPECT[aspect] ?? '1024x1024') : aspect
    return computeCreateCost(m, q ? { quality: q, aspect: size } : { aspect: size })
  } catch { return m.ticketCost ?? 0 }
}

export const STORYBOARD_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const
/** Shots a board holds in all - scenes made boards longer (it was 40). */
export const MAX_SHOTS = 120
export const DURATIONS = [2, 3, 4, 5, 6, 8, 10, 12, 15] as const
/** How many shots one draft (or one Extend) may ask for. A board holds MAX_SHOTS in all. */
export const MAX_DRAFT_SHOTS = 20
/** Target lengths a draft can aim for, in seconds; 0 = Auto (the kind of video decides). */
export const TARGET_LENGTHS = [0, 15, 30, 45, 60, 90, 120, 180] as const
/** A target length as a person says it: 30s, 1 min, 1:30, 3 min. */
export const lengthLabel = (s: number) => s === 0 ? 'Auto' : s < 60 ? `${s}s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
/** The runtimes `count` shots can reach with the lengths a shot may have. */
export const runtimeRange = (count: number) => ({ min: count * DURATIONS[0], max: count * DURATIONS[DURATIONS.length - 1] })

/**
 * Make shot lengths add up to `target` seconds - the planner aims for it, but
 * models add up loosely. Every shot is scaled by the same factor first (so the
 * pacing the planner chose survives: the long shot stays the long one), then
 * snapped to the lengths a shot may have (DURATIONS), and the leftover is
 * nudged one notch at a time onto the shot furthest from its scaled length.
 * Stops at the closest sum it can reach.
 */
export function fitDurations(shots: StoryboardShot[], target: number): StoryboardShot[] {
  if (!target || !shots.length) return shots
  const steps = DURATIONS as readonly number[]
  const total = shots.reduce((a, s) => a + (s.duration > 0 ? s.duration : 5), 0)
  const ideal = shots.map(s => ((s.duration > 0 ? s.duration : 5) * target) / total)
  const snap = (d: number) => steps.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a))
  const out = shots.map((s, i) => ({ ...s, duration: snap(ideal[i]) }))
  const sum = () => out.reduce((a, s) => a + s.duration, 0)
  for (let guard = 0; guard < 400; guard++) {
    const diff = target - sum()
    if (diff === 0) break
    const up = diff > 0
    // The shot furthest short of (or past) its scaled length, that can still move
    let best = -1
    for (let i = 0; i < out.length; i++) {
      const k = steps.indexOf(out[i].duration)
      if (up ? k >= steps.length - 1 : k <= 0) continue
      const gap = up ? ideal[i] - out[i].duration : out[i].duration - ideal[i]
      if (best < 0 || gap > (up ? ideal[best] - out[best].duration : out[best].duration - ideal[best])) best = i
    }
    if (best < 0) break
    const next = steps[steps.indexOf(out[best].duration) + (up ? 1 : -1)]
    // Stop rather than overshoot further than we are now
    if (Math.abs(diff - (next - out[best].duration)) >= Math.abs(diff)) break
    out[best].duration = next
  }
  return out
}

/**
 * The image models a still can be made with: the ones whose fal call
 * lib/chat-hub-create's buildFalCall builds in full (references included), so
 * every option in the picker actually runs.
 */
export const STORYBOARD_IMAGE_MODELS: { id: string; label: string; refs: boolean }[] = [
  // First: the house default (2026-10-07) - the menus and the planners read this order
  { id: 'nano-banana-2.1', label: 'NanoBanana 2.1', refs: true },
  { id: 'nano-banana-pro-2', label: 'NanoBanana Pro 2', refs: true },
  { id: 'nano-banana-pro', label: 'NanoBanana Pro', refs: true },
  { id: 'seedream-5-pro', label: 'SeeDream 5.0 Pro', refs: true },
  { id: 'seedream-5-lite', label: 'SeeDream 5.0 Lite', refs: true },
  { id: 'seedream-4.5', label: 'SeeDream 4.5', refs: true },
  { id: 'flux-2', label: 'FLUX 2', refs: true },
  { id: 'kling-o3-image', label: 'Kling O3', refs: true },
  { id: 'kling-image-v3', label: 'Kling V3', refs: true },
  { id: 'wan-2.7-pro', label: 'Wan 2.7 Pro', refs: true },
  { id: 'recraft-v4.1', label: 'Recraft v4.1', refs: false },
  { id: 'gpt-image-2', label: 'ChatGPT Images 2.0', refs: true },
  { id: 'z-image-turbo', label: 'Z-Image Turbo', refs: true },
  // Public 2026-10-01/02 - built through lib/fal-image-models (buildFalCall's
  // registry fallback), references through each model's edit endpoint
  { id: 'gpt-image-2.5', label: 'ChatGPT Images 2.5', refs: true },
  { id: 'ideogram-4.5', label: 'Ideogram v4.5', refs: true },
  { id: 'ideogram-v4', label: 'Ideogram v4', refs: true },
  { id: 'flux-3-image', label: 'FLUX 3', refs: true },
  { id: 'qwen-image-3', label: 'Qwen Image 3', refs: true },
  { id: 'meta-muse', label: 'Meta Muse', refs: true },
  { id: 'seedream-5-flash', label: 'SeeDream 5.0 Flash', refs: true },
  { id: 'grok-imagine-2', label: 'Grok Imagine 2', refs: true },
  { id: 'nano-banana-2-lite', label: 'NanoBanana 2 Lite', refs: false },
  { id: 'mai-image-2.5-pro', label: 'MAI Image 2.5 Pro', refs: true },
  { id: 'hunyuan-image-3', label: 'Hunyuan Image 3', refs: false },
  { id: 'hunyuan-image-3-instruct', label: 'Hunyuan Image 3 Instruct', refs: true },
  { id: 'krea-2-large', label: 'Krea 2 Large', refs: true },
  { id: 'krea-2-medium', label: 'Krea 2 Medium', refs: true },
  { id: 'krea-2-medium-turbo', label: 'Krea 2 Medium Turbo', refs: true },
  { id: 'bria-fibo', label: 'Bria FIBO 1.5', refs: true },
  { id: 'luma-photon', label: 'Luma Photon', refs: true },
  { id: 'luma-photon-flash', label: 'Luma Photon Flash', refs: true },
  { id: 'luma-uni-1', label: 'Luma Uni-1', refs: true },
  { id: 'luma-uni-1-max', label: 'Luma Uni-1 Max', refs: true },
  { id: 'recraft-v4.1-flash', label: 'Recraft V4.1 Flash', refs: false },
]
// NanoBanana 2.1 since the Studio went public (2026-10-07): Pro 2 is admin-only
export const DEFAULT_IMAGE_MODEL = 'nano-banana-2.1'

/** The video models a shot can be planned for (a plan label - nothing is shot here yet). */
export const STORYBOARD_VIDEO_MODELS = [
  'SeeDance 2.5', 'SeeDance 2.0', 'Kling 3.0', 'Kling O3 Pro', 'Veo 3.1', 'LTX 2.5 Pro',
  'Wan 2.7', 'Wan 2.5', 'Hailuo 2.3 Pro', 'Luma Ray 3.2', 'PixVerse V6', 'Happy Horse',
  // public 2026-10-01
  'LTX 2.5 Fast', 'Gemini Omni Flash', 'Omni Flash 1.1', 'Flux 3', 'Grok Imagine 1.5',
  // public 2026-10-01/02 - every one animates a start frame
  'Veo 3.1 Fast', 'Veo 3.1 Lite', 'Kling O3 4K', 'Kling V3 Turbo Pro', 'Kling V3 Turbo',
  'SeeDance 2.0 Fast', 'SeeDance 2.0 Mini', 'SeeDance 1.5', 'PixVerse C1', 'Vidu Q3', 'Vidu Q3 Turbo',
  'Pika 2.2', 'Hailuo 2.3', 'Hailuo 2.3 Fast Pro', 'Hailuo 2.3 Fast', 'MiniMax H3 Max', 'MiniMax H3 Max Turbo',
  'Wan 3.0', 'Wan 3.0 Prime', 'Luma Ray 2', 'Luma Ray 2 Flash', 'Hunyuan Video 1.5', 'Grok Imagine 1.5 Lite',
  // 2026-10-06 (public): 5s with sound, 480p or upscaled in the same job
  'Kandinsky 6 Pro', 'Kandinsky 6 Lite',
  // 2026-10-08 (public): the still is its start frame (fal's image-to-video), 3-16s, sound always on
  'Vidu Q4',
] as const
export const DEFAULT_VIDEO_MODEL = 'SeeDance 2.5'
/**
 * The plan label -> the site's video model id (lib/chat-video-catalog), which is
 * what /api/video/generate takes. Every one of these animates a start frame.
 */
export const STORYBOARD_VIDEO_IDS: Record<string, string> = {
  'SeeDance 2.5': 'seedance-2.5', 'SeeDance 2.0': 'seedance-2.0', 'Kling 3.0': 'kling-v3', 'Kling O3 Pro': 'kling-o3-pro',
  'Veo 3.1': 'veo-3.1', 'LTX 2.5 Pro': 'ltx-2.5-pro', 'Wan 2.7': 'wan-2.7', 'Wan 2.5': 'wan-2.5', 'Hailuo 2.3 Pro': 'hailuo-2.3-pro',
  'Luma Ray 3.2': 'luma-ray-3.2', 'PixVerse V6': 'pixverse-v6', 'Happy Horse': 'happy-horse',
  'LTX 2.5 Fast': 'ltx-2.5-fast', 'Gemini Omni Flash': 'gemini-omni-flash', 'Omni Flash 1.1': 'gemini-omni-1.1',
  'Flux 3': 'flux-3', 'Grok Imagine 1.5': 'grok-video-1.5',
  'Veo 3.1 Fast': 'veo-3.1-fast', 'Veo 3.1 Lite': 'veo-3.1-lite', 'Kling O3 4K': 'kling-o3-4k',
  'Kling V3 Turbo Pro': 'kling-v3-turbo-pro', 'Kling V3 Turbo': 'kling-v3-turbo',
  'SeeDance 2.0 Fast': 'seedance-2.0-fast', 'SeeDance 2.0 Mini': 'seedance-2.0-mini', 'SeeDance 1.5': 'seedance-1.5',
  'PixVerse C1': 'pixverse-c1', 'Vidu Q3': 'vidu-q3', 'Vidu Q3 Turbo': 'vidu-q3-turbo', 'Pika 2.2': 'pika-2.2',
  'Hailuo 2.3': 'hailuo-2.3', 'Hailuo 2.3 Fast Pro': 'hailuo-2.3-fast-pro', 'Hailuo 2.3 Fast': 'hailuo-2.3-fast',
  'MiniMax H3 Max': 'minimax-h3-max', 'MiniMax H3 Max Turbo': 'minimax-h3-max-turbo',
  'Wan 3.0': 'wan-3.0', 'Wan 3.0 Prime': 'wan-3.0-prime', 'Luma Ray 2': 'luma-ray-2', 'Luma Ray 2 Flash': 'luma-ray-2-flash',
  'Hunyuan Video 1.5': 'hunyuan-video-1.5', 'Grok Imagine 1.5 Lite': 'grok-video-1.5-lite',
  'Kandinsky 6 Pro': 'kandinsky6-pro', 'Kandinsky 6 Lite': 'kandinsky6-lite',
  'Vidu Q4': 'vidu-q4',
}

/**
 * What each storyboard model is FOR, in one planning line - what the AI draft
 * reads to cast a model per shot. Plain craft notes (not prices): the
 * catalog's own text is pricing detail, which says nothing about which shot a
 * model suits.
 */
export const STORYBOARD_MODEL_NOTES: Record<string, string> = {
  // images (by id)
  'nano-banana-2.1': 'THE DEFAULT for every still: newest NanoBanana - holds faces and outfits across up to 14 refs, changes pose/angle/outfit/background, several subjects, clean in-image text, long prompts; cheaper than Pro',
  'nano-banana-pro-2': 'older premium NanoBanana; only when NanoBanana 2.1 has failed a shot',
  'nano-banana-pro': 'older NanoBanana; NanoBanana 2.1 does the same job better',
  'seedream-5-pro': 'sharp 2K photoreal detail; cinematic lighting',
  'seedream-5-lite': 'quick, cheap drafts', 'seedream-4.5': 'dependable general images',
  'seedream-5-flash': 'fast and cheap; fine for many filler or background shots',
  'flux-2': 'fast, strong prompt adherence', 'flux-3-image': 'newest FLUX; crisp detail, follows long prompts; edits with up to 10 refs',
  'kling-o3-image': 'high-fidelity stylised art', 'kling-image-v3': 'stylised art and illustration',
  'wan-2.7-pro': 'detailed scenes, strong composition', 'recraft-v4.1': 'design work, logos and layout',
  'recraft-v4.1-flash': 'cheap design-y graphics', 'gpt-image-2': 'follows instructions exactly; short text in scene',
  'gpt-image-2.5': 'best at complex instructions, diagrams and in-scene text', 'z-image-turbo': 'fastest cheap drafts',
  'ideogram-4.5': 'TITLE CARDS, signage, posters - the most reliable lettering; precise edits from refs',
  'ideogram-v4': 'text inside images, speed tiers', 'qwen-image-3': 'strong text rendering; edits with refs',
  'meta-muse': 'cheap, clean general images; edits with up to 10 refs', 'grok-imagine-2': 'expressive, bold style',
  'nano-banana-2-lite': 'cheap NanoBanana for simple frames', 'mai-image-2.5-pro': 'photoreal people and products',
  'hunyuan-image-3': 'rich detailed illustration', 'hunyuan-image-3-instruct': 'follows complex instructions; edits up to 3 images',
  'krea-2-large': 'aesthetic, art-directed looks; copies a style from refs', 'krea-2-medium': 'art-directed looks, cheaper',
  'krea-2-medium-turbo': 'fastest Krea look', 'bria-fibo': 'licensed-data, commercially safe imagery',
  'luma-photon': 'cinematic, moody photographic frames', 'luma-photon-flash': 'cheap cinematic frames',
  'luma-uni-1': 'stylised scenes with refs', 'luma-uni-1-max': 'highest-quality Luma stills',
  // videos (by plan label)
  'SeeDance 2.5': 'best general motion and acting, native audio; refuses close-ups of realistic faces',
  'SeeDance 2.0': 'multi-reference motion with audio', 'SeeDance 2.0 Fast': 'cheaper SeeDance 2.0',
  'SeeDance 2.0 Mini': 'budget SeeDance with audio', 'SeeDance 1.5': 'reliable simple image-to-video',
  'Kling 3.0': 'smooth realistic motion, good with faces', 'Kling O3 Pro': 'expressive motion with audio',
  'Kling O3 4K': 'Kling O3 at 4K for hero shots', 'Kling V3 Turbo Pro': 'fast Kling up to 15s', 'Kling V3 Turbo': 'cheapest Kling',
  'Veo 3.1': "Google's flagship: cinematic realism and synced dialogue/sound", 'Veo 3.1 Fast': 'Veo quality, faster and cheaper',
  'Veo 3.1 Lite': 'lowest-cost Veo for simple shots', 'LTX 2.5 Pro': 'fast 1080p with directed camera and audio',
  'LTX 2.5 Fast': 'up to 4K and long takes, cheap', 'Wan 2.7': 'start/end frame control', 'Wan 2.5': 'solid 1080p image-to-video',
  'Wan 3.0': 'latest Wan, native audio', 'Wan 3.0 Prime': 'top Wan quality', 'Hailuo 2.3 Pro': 'MiniMax Hailuo at 1080p, dynamic action',
  'Hailuo 2.3': 'Hailuo 6 or 10s', 'Hailuo 2.3 Fast Pro': 'fast Hailuo at 1080p', 'Hailuo 2.3 Fast': 'cheapest Hailuo',
  'MiniMax H3 Max': 'strong prompt following', 'MiniMax H3 Max Turbo': 'fast cheap H3',
  'Luma Ray 3.2': 'cinematic camera moves, start + end frames', 'Luma Ray 2': 'Dream Machine motion', 'Luma Ray 2 Flash': 'cheaper Ray 2',
  'PixVerse V6': 'cheap and quick, stylised', 'PixVerse C1': 'PixVerse with stronger subjects',
  'Vidu Q3': 'up to 16s with audio, anime and stylised', 'Vidu Q3 Turbo': 'faster half-price Vidu',
  'Pika 2.2': 'playful stylised effects', 'Happy Horse': 'stylised character animation',
  'Gemini Omni Flash': 'versatile, follows complex direction', 'Omni Flash 1.1': 'Omni with 4K',
  'Flux 3': 'keyframe-precise motion with audio', 'Grok Imagine 1.5': 'bold expressive motion', 'Grok Imagine 1.5 Lite': 'cheapest Grok motion',
  'Hunyuan Video 1.5': 'open model, permissive, simple motion',
  'Kandinsky 6 Pro': 'rich 5s shots with generated sound; slow and dear - hero moments',
  'Kandinsky 6 Lite': 'cheap 5s shots with sound; quick drafts and filler',
  'Vidu Q4': 'newest Vidu: 3-16s with native sound, up to 4K; strong anime and stylised motion, holds the start frame closely',
}

/** The planner's menu: one line per model, image ids and video labels. */
export function storyboardModelMenu(): { images: string; videos: string } {
  // Each model's reference slots, so the plan picks as many pictures as the
  // model takes (2026-10-08: Ideogram's 5 slots got one picture of a character)
  const slots = (id: string, refs: boolean) => {
    const n = refs ? stillModelSpec(id).maxRefs : 0
    return n ? `, takes up to ${n} reference image${n === 1 ? '' : 's'}` : ', no reference images'
  }
  return {
    images: STORYBOARD_IMAGE_MODELS.map(m => `- ${m.id} (${m.label}${slots(m.id, !!m.refs)}): ${STORYBOARD_MODEL_NOTES[m.id] ?? 'general image model'}`).join('\n'),
    videos: STORYBOARD_VIDEO_MODELS.map(l => `- ${l}: ${STORYBOARD_MODEL_NOTES[l] ?? 'image-to-video'}`).join('\n'),
  }
}
export const SHOOT_RESOLUTIONS = ['720p', '1080p'] as const
/** The shortest length the model offers that covers the planned one (the edit trims), else its longest. */
export function pickDuration(options: string[], planned: number): string {
  const n = options.filter(o => /^\d+$/.test(o)).map(Number).sort((a, b) => a - b)
  if (!n.length) return options[0] ?? '5'
  return String(n.find(v => v >= planned) ?? n[n.length - 1])
}

export const imageModelLabel = (id: string) => STORYBOARD_IMAGE_MODELS.find(m => m.id === id)?.label ?? id

export function newShot(partial: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    title: '', description: '', imagePrompt: '', stillUrl: null,
    videoPrompt: '', duration: 5, transition: 'Cut',
    ...partial,
    // Same for the models: the first shot of an empty board is made with the
    // previous shot's models, which are `undefined` there - it showed blank
    // pickers and "undefined takes no references"
    imageModel: partial.imageModel || DEFAULT_IMAGE_MODEL,
    videoModel: partial.videoModel || DEFAULT_VIDEO_MODEL,
    // After the spread: a partial carrying `id: undefined` (a drafted shot, a
    // duplicate) must still get its own id - shared ids made every slot
    // react to one slot's edits and spinner
    id: partial.id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 9)}`),
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** A shot's still settings: short string pairs only (values are checked against the model at generation). */
function sanitizeImageOptions(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 12)) {
    if (/^[a-zA-Z]{1,40}$/.test(k) && typeof v === 'string' && v.length <= 24) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

function sanitizeStills(raw: unknown, current: string | null, prompt: string, model: string): StillVersion[] {
  const out: StillVersion[] = []
  const seen = new Set<string>()
  for (const v of Array.isArray(raw) ? raw : []) {
    const url = str((v as any)?.url, 2000)
    if (!/^https:\/\//.test(url) || seen.has(stillKey(url))) continue
    seen.add(stillKey(url))
    const at = Number((v as any)?.at)
    out.push({ url, prompt: str((v as any)?.prompt, 4000), model: str((v as any)?.model, 60), at: Number.isFinite(at) ? at : 0 })
  }
  // A slot from before versions (or a still set some other way) still lists
  // the still it shows, so its first redo does not lose it
  if (current && !seen.has(stillKey(current))) out.push({ url: current, prompt, model, at: 0 })
  return out.slice(-MAX_STILL_VERSIONS)
}

/**
 * The stored takes plus any the page adds, never fewer: autosave sends the
 * page's copy of the board, and a stale copy must not drop a take made
 * meanwhile (from another tab or device).
 */
export function mergeStills(stored: StillVersion[] | undefined, incoming: StillVersion[] | undefined): StillVersion[] {
  const out = [...(stored ?? [])]
  const seen = new Set(out.map(v => stillKey(v.url)))
  for (const v of incoming ?? []) if (!seen.has(stillKey(v.url))) { seen.add(stillKey(v.url)); out.push(v) }
  return out.slice(-MAX_STILL_VERSIONS)
}

/** Finished takes only, one per clip, the newest MAX_VIDEO_TAKES. */
function sanitizeVideoTakes(raw: unknown): ShotVideo[] | undefined {
  if (!Array.isArray(raw)) return undefined
  let out: ShotVideo[] = []
  for (const r of raw.slice(-MAX_VIDEO_TAKES * 2)) {
    const v = sanitizeVideo(r)
    if (v && v.status === 'done' && v.url) out = addVideoTake(out, v)
  }
  return out.length ? out : undefined
}
/** A take added to a slot's list - an already-kept clip moves to the end rather than repeating. */
export function addVideoTake(list: ShotVideo[] | undefined, v: ShotVideo): ShotVideo[] {
  if (v.status !== 'done' || !v.url) return list ?? []
  const k = stillKey(v.url)
  return [...(list ?? []).filter(t => !t.url || stillKey(t.url) !== k), v].slice(-MAX_VIDEO_TAKES)
}

/** A shot's own refs: absent stays absent (automatic); an empty list means "none". */
function sanitizeShotRefs(raw: unknown): ShotRef[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: ShotRef[] = []
  for (const r of raw.slice(0, MAX_SHOT_REFS * 2) as any[]) {
    const url = str(r?.url, 2000)
    if (!/^https:\/\//.test(url) || seen.has(stillKey(url))) continue
    seen.add(stillKey(url))
    out.push({ id: str(r?.id, 64) || newId('r'), url, on: r?.on !== false, ...(str(r?.assetId, 64) ? { assetId: str(r?.assetId, 64) } : {}) })
  }
  return out.slice(0, MAX_SHOT_REFS)
}

function sanitizeStillJob(j: any): StillJob | undefined {
  if (!j || typeof j !== 'object' || !['queued', 'making', 'failed'].includes(j.status)) return undefined
  const at = Number(j.at)
  return { status: j.status, at: Number.isFinite(at) ? at : 0, model: str(j.model, 60) || undefined, error: str(j.error, 400) || undefined }
}

function sanitizeVideo(v: any): ShotVideo | null {
  if (!v || typeof v !== 'object' || !Number.isInteger(v.queueId)) return null
  const url = str(v.url, 2000)
  return {
    queueId: v.queueId,
    status: v.status === 'done' || v.status === 'failed' ? v.status : 'rendering',
    url: /^https:\/\//.test(url) ? url : null,
    error: str(v.error, 400) || null,
    model: str(v.model, 60),
    seconds: Number.isFinite(Number(v.seconds)) ? Number(v.seconds) : 0,
    fromStill: /^https:\/\//.test(str(v.fromStill, 2000)) ? str(v.fromStill, 2000) : null,
    fromPrompt: str(v.fromPrompt, 4000),
    at: Number.isFinite(Number(v.at)) ? Number(v.at) : 0,
    rawUrl: /^https:\/\//.test(str(v.rawUrl, 2000)) ? str(v.rawUrl, 2000) : null,
    rawSize: /^\d{2,5}x\d{2,5}$/.test(str(v.rawSize, 20)) ? str(v.rawSize, 20) : null,
  }
}

/**
 * The frame to ask a video model for: the board's when the model offers it,
 * else the closest one in the SAME ORIENTATION - a 3:4 board asks for 9:16, a
 * 4:3 or 21:9 board for 16:9 - so the clip is conformed by trimming the long
 * side only, at full resolution (never squeezed or upscaled). Square only when
 * the model has nothing in that orientation.
 *
 * Models that animate a still mostly ignore this and follow the still, which
 * is already in the board's frame (Kling 3.0: a 3:4 still renders 3:4).
 */
export function shootAspect(aspectOptions: string[] | undefined, boardAspect: string): string {
  const opts = (aspectOptions ?? []).filter(o => /^\d+:\d+$/.test(o))
  if (!opts.length || opts.includes(boardAspect)) return boardAspect
  const lr = (a: string) => { const [w, h] = a.split(':').map(Number); return Math.log(w / h) }
  const t = lr(boardAspect)
  const side = (x: number) => Math.sign(Math.round(x * 1000))   // -1 portrait, 0 square, 1 landscape
  const same = opts.filter(o => side(lr(o)) === side(t))
  const pool = same.length ? same : opts
  return pool.reduce((best, o) => (Math.abs(lr(o) - t) < Math.abs(lr(best) - t) - 1e-9 ? o : best))
}

/** Clean whatever arrived into a valid shot list - the server never stores raw client JSON. */
export function sanitizeShots(raw: unknown): StoryboardShot[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_SHOTS).map((r: any) => {
    const d = Number(r?.duration)
    const still = str(r?.stillUrl, 2000)
    // An id, or a label from a planner that wrote the name
    const im = STORYBOARD_IMAGE_MODELS.find(m => m.id === r?.imageModel || m.label === r?.imageModel)
    const imageModel = im?.id ?? DEFAULT_IMAGE_MODEL
    return newShot({
      id: str(r?.id, 64) || undefined,
      title: str(r?.title, 120),
      description: str(r?.description, 2000),
      imagePrompt: str(r?.imagePrompt, 4000),
      imageModel,
      imageQuality: str(r?.imageQuality, 12),
      imageOptions: sanitizeImageOptions(r?.imageOptions),
      stillUrl: /^https:\/\//.test(still) ? still : null,
      videoPrompt: str(r?.videoPrompt, 4000),
      videoModel: str(r?.videoModel, 60) || DEFAULT_VIDEO_MODEL,
      duration: Number.isFinite(d) ? Math.min(30, Math.max(1, Math.round(d * 2) / 2)) : 5,
      transition: str(r?.transition, 300) || 'Cut',
      keepWhole: r?.keepWhole === true ? true : undefined,
      sceneId: str(r?.sceneId, 64) || undefined,
      refs: sanitizeShotRefs(r?.refs),
      editOf: str(r?.editOf, 64) || undefined,
      aspect: (SHOT_ASPECTS as readonly string[]).includes(r?.aspect) ? r.aspect : undefined,
      beforeUrl: /^https:\/\//.test(str(r?.beforeUrl, 2000)) ? str(r?.beforeUrl, 2000) : undefined,
      caption: str(r?.caption, 60) || undefined,
      captionSub: str(r?.captionSub, 90) || undefined,
      stillJob: sanitizeStillJob(r?.stillJob),
      video: sanitizeVideo(r?.video),
      videos: sanitizeVideoTakes(r?.videos),
      stills: sanitizeStills(r?.stills, /^https:\/\//.test(still) ? still : null, str(r?.imagePrompt, 4000), imageModel),
    })
  })
}

export const totalSeconds = (shots: StoryboardShot[]) => shots.reduce((a, s) => a + (s.duration || 0), 0)
export const fmtRuntime = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`

// ── Final Cut ────────────────────────────────────────────────────────────────

/** The Stills cut's flat price: the render and one AI look at every frame for the captions. */
export const STILLS_CUT_TICKETS = 2
/**
 * A Final Cut's own cost on top of the shots it shoots: the edit plan (~$0.02),
 * title and end cards (~$0.20), the score (~$0.01 a second), the mix (~$0.05),
 * narration (~$0.05) - in tickets at the $0.04 of fal cost a ticket covers
 * (lib/ticket-pricing's margin rule). The page shows it; the route charges it.
 */
export function finalCutExtraTickets(o: { cards: boolean; narration: boolean }, seconds: number): number {
  const usd = 0.02 + (o.cards ? 0.2 : 0) + seconds * 0.01 + 0.05 + (o.narration ? 0.05 : 0)
  return Math.ceil(usd / 0.04)
}

/** What the Final Cut button is asked for. */
export type FinalCutOptions = {
  /** Title and end cards (lettering by Ideogram v4). */
  cards: boolean
  /** A narrator over the film (lines written by the edit plan, voiced by ElevenLabs). */
  narration: boolean
  voice: string
  /** Resolution for any shots it still has to shoot. */
  resolution: string
}
export const DEFAULT_FINAL_CUT_OPTIONS: FinalCutOptions = { cards: true, narration: false, voice: 'Brian', resolution: '720p' }
export const NARRATOR_VOICES = ['Brian', 'George', 'Liam', 'Aria', 'Sarah', 'Laura', 'Charlotte', 'Daniel', 'Bill', 'Jessica'] as const

/** The steps, in order, as the page shows them. */
export const FINAL_CUT_PHASES = [
  { key: 'shoot', label: 'Shoot missing shots' },
  { key: 'plan', label: 'Plan the edit' },
  { key: 'cards', label: 'Title & end cards' },
  { key: 'cut', label: 'Cut the picture' },
  { key: 'voice', label: 'Narration' },
  { key: 'score', label: 'Score the music' },
  { key: 'mix', label: 'Mix & master' },
  { key: 'save', label: 'Save the cut' },
] as const
export type FinalCutPhase = (typeof FINAL_CUT_PHASES)[number]['key']

export type FinalCutVersion = {
  n: number; url: string; durationSec: number; at: number; imageId: number | null; note: string
  /** A frame from the middle of the cut. Every cut opens on black (the title card fades in), so without it the player is a black box. */
  posterUrl?: string | null
  /** The scene this cut is of ("Scene 2 · The Chase"); absent = the whole board. */
  scene?: string | null
}

/** The board's Final Cut record: the running (or last) job, and every version made. */
export type FinalCutState = {
  job: {
    status: 'running' | 'done' | 'failed' | 'cancelled'
    phase: FinalCutPhase
    message: string
    error: string | null
    startedAt: number
    options: FinalCutOptions
    /** Skipped phases (no cards / no narration), so the page can grey them out. */
    skip: FinalCutPhase[]
    /** Cutting one scene (its id) instead of the whole board. */
    sceneId?: string | null
    /** Tickets charged for the cut's own work (finalCutExtraTickets) - refunded if it is cancelled or started over. */
    charged?: number
  } | null
  versions: FinalCutVersion[]
}

/**
 * Shots the Final Cut can hold: the assembly route takes 16 clips (two are the
 * cards) and 2 minutes. A long board in scenes is cut a scene at a time.
 */
export const FINAL_CUT_MAX_SHOTS = 14
export const FINAL_CUT_MAX_SECONDS = 105
