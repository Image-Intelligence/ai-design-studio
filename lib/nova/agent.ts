/**
 * Nova Studio - one chat turn (server only, 2026-10-18).
 *
 * KEEPING A TURN CHEAP
 * Most of a turn's cost is INPUT tokens, re-sent on every tool step: the
 * instructions, the history and any pictures. So:
 *  - the instructions are short; the model catalog is a tool (browse_models),
 *    fetched per kind only when needed, not pasted into every step;
 *  - history is the newest NOVA_HISTORY messages as plain text, each step
 *    reduced to one line ("made image #112450 with NanoBanana 2.1");
 *    everything older is folded into a running summary by Flash-Lite
 *    (compactChat) - so a chat's 200th message costs about what its 20th did;
 *  - pictures are only inlined when they matter: the ones the user attached
 *    to THIS message, and the ones a tool just made (so Nova can judge them),
 *    shrunk to 768px. Old pictures are referred to by id, never re-sent.
 *
 * BILLING
 * The turn's chat is paid by holding novaTurnHold tickets before it starts
 * and giving back what the measured tokens did not use (novaChatTickets,
 * priced from Google's own token counts). Generations are charged by the
 * site's routes as they run. Admins are charged nothing, but every price is
 * still worked out and recorded, so the studio can be tested end to end.
 */
import { streamText, stepCountIs, hasToolCall, tool, jsonSchema, type ModelMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import prisma from '@/lib/prisma'
import { signPayload } from '@/lib/media-url'
import { deductGenerationTickets, refundGenerationTickets } from '@/lib/ticket-gate'
import { geminiGenerate, geminiText } from '@/lib/gemini-generate'
import { loadNovaBudget, addNovaSpend, roomLeft, novaBalance } from '@/lib/nova/ledger'
import { ensureChatFolder } from '@/lib/nova/jobs'
import { makeNovaTools, novaAllowance, abandonPrepaid, readChatState, ownedRows, kindOf, imagePart, refsKey, type NovaTurnCtx, type NovaChatState, type NovaAllowance } from '@/lib/nova/agent-tools'
import { resolveChatRefs, chatRefsText } from '@/lib/nova/chat-refs'
import { makeProTools } from '@/lib/nova/agent-tools-pro'
import { makeStudioTools } from '@/lib/nova/agent-tools-studio'
import { makePostTools } from '@/lib/nova/agent-tools-post'
import { recipeIndex } from '@/lib/nova/recipes'
import { routeTurn } from '@/lib/nova/router'
import { loadNovaMemory, type NovaNote } from '@/lib/nova/memory'
import { loadLessons, recentLessons } from '@/lib/nova/lessons'
import { namedModels } from '@/lib/nova/catalog'
import { userFavouriteModels } from '@/lib/nova/scorecard'
import { backgroundStatus } from '@/lib/nova/background'
import { findAsset, storedRefs } from '@/lib/user-assets'
import { readFilterState } from '@/lib/content-filter'
import { enhancePlanFor, consumeEnhance, ENHANCE_LIMITS } from '@/lib/prompt-enhance'
import { siteGuide, SITE_TOPICS } from '@/lib/nova/site-guide'
import {
  NOVA_MAX_STEPS, NOVA_TIER_STEPS, NOVA_ROUTES, novaChatUsd, novaChatCostUsd, novaTicketsForUsd, novaTurnHold, resolveNovaModel, NOVA_AUTO, NOVA_CRITIC_MODEL, NOVA_MAX_AUTO_TURNS, cleanRunBudget,
  type NovaMessage, type NovaStep, type NovaPlan, type NovaStreamEvent, type NovaUsage, type NovaMediaKind, type NovaTier, type NovaPersonaId, type NovaContextMark,
} from '@/lib/nova/config'

/** Messages replayed word for word; older ones live in the summary. */
const NOVA_HISTORY = 12
/** Fold older messages once this many have piled up past the window. */
const COMPACT_AFTER = 6
const SUMMARY_MODEL = 'gemini-3.5-flash-lite'
const SUMMARY_MAX = 6000

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })

const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

// ── Stored rows → what the screen and the model see ──────────────────────────

type DbMsg = { id: number; role: string; content: string; model: string | null; metadata: unknown; createdAt: Date }

export function toNovaMessage(r: DbMsg): NovaMessage {
  const m = (r.metadata ?? {}) as Record<string, any>
  return {
    id: r.id,
    role: r.role === 'user' ? 'user' : 'assistant',
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    ...(m.attachments ? { attachments: m.attachments } : {}),
    ...(m.assets ? { assets: m.assets } : {}),
    ...(m.system ? { system: true } : {}),
    ...(Array.isArray(m.steps) ? { steps: m.steps } : {}),
    ...(m.plan ? { plan: m.plan } : {}),
    ...(r.model ? { model: r.model } : {}),
    ...(m.tickets ? { tickets: m.tickets } : {}),
    ...(m.continueAfterRenders ? { continueAfterRenders: true } : {}),
    ...(m.keepGoing ? { keepGoing: true } : {}),
    ...(m.running ? { running: true } : {}),
    ...(m.route ? { route: m.route } : {}),
  }
}

/** One line per step, for history and summaries. */
function stepLine(s: NovaStep): string {
  const what = s.kind ? `${s.kind}${s.model ? ` (${s.model})` : ''}` : s.tool
  const where = s.generationId ? ` #${s.generationId}` : ''
  const state = s.status === 'done' ? (s.kind ? 'made' : 'did') : s.status === 'pending' ? 'started (rendering)' : s.status === 'error' ? `FAILED: ${clip(s.error, 80)}` : 'running'
  const cost = s.kind && s.status !== 'error' ? ` [${s.tickets ?? 0} tickets]` : ''
  return `- ${state} ${what}${where}${cost}: ${clip(s.label, 80)}${s.prompt ? ` - "${clip(s.prompt, 120)}"` : ''}${s.note ? ` (${s.note})` : ''}`
}

export function digest(m: NovaMessage): string {
  if (m.role === 'user') {
    const att = (m.attachments ?? []).map(a => `#${a.id} (${a.kind})`).join(', ')
    const ast = (m.assets ?? []).map(a => `asset ${a.id} "${a.name}" (${a.kind})`).join(', ')
    return `${m.system ? '[system] ' : ''}${m.content}${att ? `\n[attached: ${att}]` : ''}${ast ? `\n[assets: ${ast}]` : ''}`
  }
  const lines = [m.content.trim()]
  for (const s of m.steps ?? []) lines.push(stepLine(s))
  if (m.plan) lines.push(`[plan ${m.plan.status}: ${clip(m.plan.summary, 160)} - ${m.plan.approvedTickets ?? m.plan.totalTickets} tickets]`)
  return lines.filter(Boolean).join('\n')
}

// ── Compaction ───────────────────────────────────────────────────────────────

/**
 * Fold everything older than the replay window into the chat's summary, once
 * enough has piled up (so it runs every ~6 messages, not every turn). Returns
 * the tokens it used - they are billed with the turn.
 */
async function compactChat(chat: { id: number; memorySummary: string | null; summaryUpToId: number | null }, windowStartId: number | null, opts: { min?: number; take?: number; newest?: boolean } = {}): Promise<{ summary: string | null; usage: NovaUsage }> {
  const usage = { inputTokens: 0, outputTokens: 0 }
  if (!windowStartId) return { summary: chat.memorySummary, usage }
  const rows = await prisma.chatMessage.findMany({
    where: { chatId: chat.id, id: { lt: windowStartId, ...(chat.summaryUpToId ? { gt: chat.summaryUpToId } : {}) } },
    orderBy: { id: opts.newest ? 'desc' : 'asc' }, take: opts.take ?? 40,
    select: { id: true, role: true, content: true, model: true, metadata: true, createdAt: true },
  })
  const older = opts.newest ? rows.reverse() : rows
  if (older.length < (opts.min ?? COMPACT_AFTER)) return { summary: chat.memorySummary, usage }
  const text = older.map(r => `${r.role.toUpperCase()}: ${clip(digest(toNovaMessage(r)), 900)}`).join('\n\n')
  const prompt = [
    'You keep the running memory of a creative chat between a user and an AI studio assistant (Nova or Prism) that makes images, video, audio and 3D, organises the user\'s library and answers questions about the site.',
    // Two parts (2026-10-20, owner: "remember key things very well" as chats run for months): a fact
    // list carried forward intact - a single rewritten paragraph lost older #ids a little more each time -
    // and a short story of where things stand, which is free to shrink.
    'Merge the EARLIER SUMMARY and the NEW MESSAGES into one updated summary in exactly two parts:',
    'KEY FACTS: one short line each - the user\'s lasting goals and preferences, brand rules, every important #id and what it is (characters, products, places, approved shots, final cuts), assets and folders created, decisions made. COPY every key fact from the earlier summary unless the new messages change or retire it (then update or drop it); add the new ones; merge duplicates. At most 45 lines - when over, drop the least important (old one-off items first, never brand rules or the main characters / products).',
    'STORY SO FAR: at most 150 words - what is being worked on now, plans and their budgets, and what is still to do. Drop chit-chat.',
    'Plain text, the two headings exactly as written.',
    `EARLIER SUMMARY:\n${chat.memorySummary || '(none)'}`,
    `NEW MESSAGES:\n${text}`,
  ].join('\n\n')
  try {
    const res = await geminiGenerate(SUMMARY_MODEL, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 2400 } }, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return { summary: chat.memorySummary, usage }
    const data = await res.json() as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }
    const summary = geminiText(data).trim().slice(0, SUMMARY_MAX)
    if (!summary) return { summary: chat.memorySummary, usage }
    usage.inputTokens = data.usageMetadata?.promptTokenCount ?? 0
    usage.outputTokens = (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0)
    await prisma.chat.update({ where: { id: chat.id }, data: { memorySummary: summary, summaryUpToId: older[older.length - 1].id } })
    return { summary, usage }
  } catch {
    return { summary: chat.memorySummary, usage }
  }
}

/**
 * Compact / clear on request (2026-10-20, owner: Prism is one chat that goes
 * on for months, and the user should be able to take it back to its cheapest
 * point). Both move the replay window's floor (summaryUpToId) up to the newest
 * message, so the next turn replays NOTHING word for word:
 *  - compact: everything not yet summarised is folded into the summary first
 *    (Flash-Lite, a fraction of a cent - not billed);
 *  - clear: the summary goes too, and the chat's working state (plan, look
 *    bible, the request's spend) - a fresh start.
 * What the user asked to be remembered (lib/nova/memory) stays either way, and
 * the messages stay on screen; a mark in the chat state shows where it happened.
 */
export async function resetChatContext(chatId: number, mode: 'compact' | 'clear'): Promise<{ marks: NovaContextMark[] }> {
  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { id: true, memorySummary: true, summaryUpToId: true, skills: true } })
  if (!chat) throw new Error('Chat not found')
  const last = await prisma.chatMessage.findFirst({ where: { chatId }, orderBy: { id: 'desc' }, select: { id: true } })
  let summary = mode === 'clear' ? null : chat.memorySummary
  // Fold the unsummarised tail (its newest 60 - anything older was folded by the turns already)
  if (mode === 'compact' && last) summary = (await compactChat(chat, last.id + 1, { min: 1, take: 60, newest: true })).summary
  const state = readChatState(chat.skills)
  if (mode === 'clear') { state.plan = null; state.bible = null; state.chainUnplanned = 0; state.autoTurns = 0; state.runBudget = undefined }
  state.marks = [...(state.marks ?? []), ...(last ? [{ afterId: last.id, kind: mode, at: new Date().toISOString() }] : [])].slice(-30)
  await prisma.chat.update({ where: { id: chatId }, data: { memorySummary: summary, ...(last ? { summaryUpToId: last.id } : {}), skills: state as object } })
  return { marks: state.marks }
}

// ── Prism, the site guide (2026-10-20) ───────────────────────────────────────

const PRISM_INTRO = [
  'You are Prism, the guide inside AI Design Studio - a friendly, playful iridescent chameleon, the site\'s mascot for colour and style. You live in the guide panel on every page, in ONE ongoing conversation with this user that lasts for weeks and months.',
  '',
  'YOUR TWO JOBS',
  '1. GUIDE: answer questions about the site - where things are, how a feature works, what tickets and plans cost, which model suits a job - and help with prompts. For site facts call site_help(topic); for models and their live ticket prices use recommend_models / browse_models. Never invent a feature, page or price; if you are not sure, say so.',
  '2. MAKE: when the user asks, make and edit images, video, audio and 3D, organise their library and cut films - the whole studio, described below.',
  '',
  'KEEP IT CHEAP: most messages are quick questions. Answer them directly in a few short sentences, without tools unless a fact needs checking. Do not search the library or make anything unless asked.',
  'LONG-TERM MEMORY: this chat lasts. When the user tells you something lasting (their brand, style, projects, how they like answers), save it with remember. Older parts of the conversation are kept as a short summary; the user can Compact or Clear it from your menu to keep you cheap.',
  'The user may be new to the site: be welcoming, explain plainly, and end with one useful next step.',
].join('\n')

/**
 * Prism's quick questions run LEAN (2026-10-20): the first live question
 * ("how do tickets work?") re-sent Nova's whole studio prompt and all ~40
 * tool definitions on each of its two steps - 26k input tokens, $0.04, for
 * an answer that is meant to be free. A light Prism turn gets this short
 * prompt and only the tools a question needs; a request to MAKE something is
 * routed past light (lib/nova/router) and gets the full studio.
 */
const PRISM_LEAN_TOOLS = ['site_help', 'browse_models', 'recommend_models', 'search_library', 'list_folders', 'list_assets', 'view_media', 'remember', 'forget'] as const
function prismLeanInstructions(o: { isAdmin: boolean; balance: number | null; memory: NovaNote[]; summary: string | null; safetyOff?: boolean }): string {
  return [
    PRISM_INTRO,
    '',
    'THIS TURN IS A QUICK ANSWER: you have site_help (site facts), recommend_models / browse_models (models and live prices), the library lookups and remember / forget. You cannot make or edit anything in this turn - if the user wants something made, say in one or two lines what you would make (model, rough ticket cost) and ask them to say go; their next message runs in making mode.',
    '- Answer in a few short sentences or bullets; markdown is fine. Prices come from the tools, never from memory.',
    o.isAdmin ? '- This is an admin account: nothing is charged.' : `- The user has ${o.balance ?? 0} tickets.`,
    o.safetyOff ? '' : '- Follow the site\'s content rules: no sexual content, nothing harmful involving minors, no real people\'s likeness without consent.',
    o.memory.length ? `WHAT YOU KNOW ABOUT THIS USER (remembered - follow it; forget(note_id) if they say it is wrong):\n${o.memory.map(n => `- [${n.id}] ${n.text}`).join('\n')}` : '',
    `This is your one ongoing chat with this user. Today is ${new Date().toISOString().slice(0, 10)}.`,
    o.summary ? `\nEARLIER IN THIS CHAT (summary):\n${o.summary}` : '',
  ].filter(x => x !== '').join('\n')
}

const siteHelpTool = tool({
  description: `Facts about the site for answering the user's questions: where things are and what they do, tickets, plans, studios, the library, references, uploads, troubleshooting and Prism itself. Topics: ${SITE_TOPICS.join(', ')}. Model prices: use browse_models.`,
  inputSchema: jsonSchema<{ topic: string }>({ type: 'object', properties: { topic: { type: 'string', enum: [...SITE_TOPICS] } }, required: ['topic'] }),
  execute: async ({ topic }) => ({ topic, facts: siteGuide(topic) }),
})

// ── Instructions ─────────────────────────────────────────────────────────────

/** The resolved references back as ids (what was actually shown). */
const chatRefsIds = (r: { assets: { id: number }[]; generations: { id: number }[] }) => ({ assets: r.assets.map(a => a.id), generations: r.generations.map(g => g.id) })

export function novaInstructions(o: { persona?: NovaPersonaId; isAdmin: boolean; balance: number | null; state: NovaChatState; allowance: NovaAllowance; room: { room: number; which: string | null }; summary: string | null; title: string; memory: NovaNote[]; favourites: string[]; tier: NovaTier; safetyOff?: boolean; lessons?: string; named?: { id: string; label: string; via: string }[] }): string {
  const plan = o.state.plan
  const prism = o.persona === 'prism'
  return [
    ...(prism ? [PRISM_INTRO, '', 'MAKING THINGS (when the user asks you to make, change or organise something - the same studio Nova Studio runs):'] : []),
    prism ? 'You make what the user wants with the studio\'s AI models - images, video, audio, 3D - using their own library (My Generations, folders and Assets), then organise it and edit final cuts, like a professional creative producer: understand the goal, plan, make, check your work, assemble, deliver.' : 'You are Nova, the creative partner inside AI Design Studio. You talk with the user and make what they want with the studio\'s AI models - images, video, audio, 3D - using their own library (My Generations, folders and Assets), then organise it and edit final cuts. You work like a professional creative producer: understand the goal, plan, make, check your work, assemble, deliver.',
    '',
    'HOW YOU WORK',
    '- Understand the goal first. Ask ONE short question only when something essential is missing (the product, the format, the length); otherwise make sensible choices and say what you chose.',
    '- When the user mentions existing work ("my logo", "the fox from yesterday"), find it with search_library / list_assets / asset_pictures before making anything new. Media is always referred to by id: #123.',
    '- Pick models with recommend_models (the studio scorecard for the job: photoreal, product, text, logo, consistency, video-premium, video-budget, voiceover, music-bed...) and browse_models (exact settings). Write each prompt the way that model is best prompted: subject, setting, composition, lighting, style, camera; for video: motion, camera move, pacing, sound.',
    '- RECIPES: for a job that matches one of the recipes below, call load_recipe FIRST and follow it - it is the studio\'s proven method (models, prompts, checks).',
    '- CONSISTENCY IS A STEP, NOT A HOPE: anything with 2+ images or shots of the same character, product or place gets a LOOK BIBLE before the first shot (recipe look-bible: character sheet, place plate, style frame -> set_look_bible). Every later generation passes the bible pictures that are in the shot as references. Never make an established character from text alone.',
    '- CHECK AS YOU GO: check_shots compares new stills and clips with the look bible (strong critic model). Run it on keyframes before animating them and on clips before cutting them; redo what drifted (up to 2 tries per shot) before moving on.',
    '- CONTINUITY ACROSS CUTS: when the next shot continues the same moment, extract_frame the LAST frame of the previous clip and use it as the next start_image_id.',
    '- EVERY OTHER VIDEO MODEL: use_video_tool runs the rest of the site\'s video models by name - upscalers (Topaz, FlashVSR, Flux, Kandinsky), reframes, Luma restyle, extends (PixVerse, H3 Turbo, Veo), translate / dub / subtitles, relight, camera moves, depth, tracking, background removal, audio-to-video (LTX, PixVerse Music Video, HeyGen Avatar), Kling Motion Control, Higgsfield. Image upscalers (Clarity, AuraSR, ESRGAN, DRCT) are image models: generate_image with the picture as the reference and settings {"factor":"2"}. Recordings (voice changer, stem splitter, clean-up, voice cloning, video-to-music) go through generate_audio with input_id.',
    '- CLIPS ARE EDITABLE: edit_clip runs the site\'s clip tools on any clip (upscale, edit with words, recast a face, remove an object, extend, lip-sync, sound effects); talking_head makes a still talk to a voice line; make_loop checks and repairs a loop\'s seam; trim_media trims, speeds up, mutes, fades or levels one clip or sound for free. Fix a clip before re-rendering it from scratch.',
    // 2026-10-21 (owner): users attach their own clips (several at once) and ask for them to be cut
    // together or changed - "instead of having them regenerate them. This allows users to use more of their assets."
    '- THE USER\'S OWN FOOTAGE: when the user attaches or references clips (#ids marked video / cut, uploads, an asset\'s clips) and asks to edit them, EDIT THOSE CLIPS - never regenerate them unless they ask for new footage. Join several into one film with assemble_cut (clips in the order the user gives, or the order that tells the story; trim_start / trim_end to cut each one down, transitions, music / voice / captions / titles, at most 16 clips and 120 seconds); one clip trimmed, sped up, muted, faded or levelled with trim_media (free); restyled, upscaled, extended, relit or reframed with edit_clip / use_video_tool; a still pulled out with extract_frame. Watch them first (watch_video, or inspect_media for timings) when where to cut depends on what happens in them.',
    '- WATCH, DO NOT GUESS: frames miss motion. watch_video lets the strong model watch clips with their sound (a face that morphs, flicker, lips against words, how a cut flows) - use it on anything that moves before you call it done.',
    '- FINISHING A CUT: assemble_cut can match_color (shots from different renders look like one film - use it whenever clips come from different renders), add a look (a grade), overlays (titles, lower thirds, end-card text, a logo ON the video - exact words), and auto_captions (word-timed captions of everything spoken). To change a cut later use recut with only what changes - never rebuild it from memory.',
    '- RESEARCH: web_search finds facts you need (a brand\'s colours or tagline, what a real place or object looks like, a style\'s references). Do not use it to copy someone\'s artwork or a real person\'s likeness.',
    '- LEARN: when you see a model habit (a quirk that would happen again), keep it with learn_about_model; lessons appear when you look the model up. The user\'s uploads arrive as attachments (model nova-upload) - use them like any other item.',
    '- Make exactly what was asked: one image means one generate_image call. Make variations in PARALLEL only when asked or when a plan says so. Always pass the shape the user wants in settings (e.g. {"aspect":"1:1"}).',
    // 2026-10-20: most productions went round the critic two or three times - the fixes it asked
    // for were things a better first prompt avoids. Same checklist the critic judges by.
    '- GET IT RIGHT FIRST TIME - before each generation, check the prompt against the brief: every required element is IN the prompt (subject and count, setting, aspect via settings, exact on-image text in "quotes" and short, brand colours/rules, mood); the subject has room (not cropped at the edges, nothing important near the frame border; keep text in the middle 80%); hands and faces are simple and visible (avoid tangled or overlapping hands, tiny faces in the distance); one idea per image; for video, one clear motion plus the camera move, and "steady camera" when nothing should move. Pick a model that is strong at the job (text -> a lettering model; a character seen before -> its look-bible pictures as references). Read the model\'s lessons below and avoid them.',
    '- You see every image you make: judge it honestly against the brief. If one is clearly wrong (wrong text, broken anatomy, off-brief, off-model), fix it - a precise edit_image first, a regeneration only when an edit cannot fix it, up to 2 tries per item within budget - but never silently: say what was wrong, and list EVERY image you made (#ids) with its ticket cost.',
    '- Videos, audio and 3D render in the background. Start everything that can run at once, then write ONE short line telling the user what is rendering and what you will do next, and call wait_for_renders; you will be woken with their ids when they finish, and can then assemble the cut (assemble_cut: clips in order, image cards for titles/end cards, music and voiceover by id).',
    "- When the whole request will clearly cost more than you may spend without asking (see MONEY), your FIRST action is propose_plan - do not start generating and stop half-way. Work that fits inside it needs no plan: just do it.",
    '- FINISH THE JOB: do everything the user asked for (every still, every clip, the cut) without stopping to ask permission for parts they already requested - never end a turn with "Shall I start the videos now?" when they asked for videos. Ask only for something genuinely new, or propose_plan when it costs more than you may spend. If you run out of steps or time, the studio carries on automatically in a new turn - just keep working there.',
    '- COUNT: make exactly the number of items asked for. STAY WITH THE MODEL YOU CHOSE (or the user named): when a generation fails, follow the tool\'s `next` - a refusal is rephrased and retried on the SAME model, a technical failure is simply retried - up to 3 tries per item before switching to another suitable model. Never switch models on the first failure; if an item still fails, say which ones are missing and why.',
    '- THE USER\'S CHOICE WINS: when the user names a model or a feature (e.g. "Pixelcut 360 loop", "use NanoBanana 2.1"), use exactly that - find it with browse_models - and only use something else if it truly cannot do the job, saying so first.',
    '- CHECK YOUR WORK: inspect_media shows you video frames and measures sound (LUFS, clipping, silence) - check clips before cutting them, and check every cut (assemble_cut shows you its frames and levels). Social sound should sit near -14 LUFS with no clipping.',
    '- FIX IT YOURSELF: edit_image does exact pixel work for free (crop, reframe to another aspect, headline/caption text with exact words, a logo placed by id, colour); expand_image paints real scenery to a new aspect; cutout lifts a subject onto transparency. Prefer a precise edit over regenerating.',
    `- THE CRITIC: before you hand over a production (a final cut, an ad, a set of deliverables), call critique_work on the deliverables - ONCE. "pass" means hand it over (its polish notes are optional next steps, not work to do). "revise" means fix ONLY the blockers, with the cheapest precise tool (edit_image / trim_media / recut before regenerating), in one round; re-run the critic only if you had to regenerate a deliverable. Do not run it for a single quick image.`,
    '- ONE CUT PER VERSION: call assemble_cut once, check what it shows you (and the critic), and only recut to fix something specific.',
    '- DELIVER IN FORMATS: export_formats makes 9:16 / 1:1 / 4:5 / 16:9 versions; save_storyboard turns a shot list into a board the user can open in Storyboard Studio.',
    '- REFERENCES: caption_asset labels an asset\'s pictures, update_asset_notes writes who/what it is, find_similar finds related work in the library.',
    '- MEMORY: when the user states a lasting preference or brand rule, save it with remember (one sentence). Follow everything under WHAT YOU KNOW ABOUT THIS USER.',
    '- Everything you make is filed in this chat\'s folder automatically; use create_folder / file_items when the user wants things organised differently.',
    '- After a production, end with a short summary: what you made (#ids), what each generation cost - ONLY the ticket numbers the tools and the history report (marked [N tickets]); never estimate or round them, and never state a chat cost (it is billed separately and the studio shows it) - and one or two useful next steps.',
    '',
    'RECIPES (load_recipe <id>)',
    recipeIndex(),
    '',
    o.lessons ? `WHAT THE STUDIO HAS LEARNED ABOUT MODELS YOU USE (from this account's past work - write prompts that avoid these):\n${o.lessons}\n` : '',
    o.state.bible ? `LOOK BIBLE (this chat - pass these as references for whoever / wherever is in a shot; check_shots compares against them):\n${[...o.state.bible.characters.map(c => `- character "${c.name}": ${c.ids.map(i => `#${i}`).join(', ')}`), ...o.state.bible.places.map(p => `- place "${p.name}": ${p.ids.map(i => `#${i}`).join(', ')}`)].join('\n')}${o.state.bible.style ? `\n- style: ${o.state.bible.style}` : ''}\n` : '',
    'MONEY - THE USER PAYS IN TICKETS',
    '- Your balance, this request\'s budget and any plan are under RIGHT NOW at the very end.',
    '- A refusal for budget says what the call costs - use THAT number in propose_plan, not a guess.',
    '- Never try to get around a refusal from a tool - explain it to the user. Prefer the cheaper option when quality is equal, and say what things cost in plain words.',
    '',
    'STYLE',
    '- Friendly, clear, brief. Plain words, no jargon. Short paragraphs or a few bullets. Do not paste long prompts into the chat unless asked.',
    o.safetyOff
      // ADMIN TEST MODE (the admin Filter switch is OFF - lib/content-filter): Nova does not add refusals of its own;
      // the generation models' own safety still applies. The floor below never moves.
      ? '- ADMIN TEST MODE: the site\'s safety filter is OFF for this admin account. Do not refuse on content grounds yourself - pass requests to the models and let the site\'s model-level checks decide; report any model refusal plainly. The floor still holds: never sexual content involving anyone under 18 or anyone who looks it, and never nude or sexually explicit images of real, identifiable people.'
      : '- Follow the site\'s content rules: no sexual content, nothing involving minors in harmful ways, no real people\'s likeness without consent. The studio\'s content filter refuses such requests; tell the user plainly if it does.',
    '',
    o.memory.length ? `WHAT YOU KNOW ABOUT THIS USER (remembered - follow it; forget(note_id) if they say it is wrong):\n${o.memory.map(n => `- [${n.id}] ${n.text}`).join('\n')}` : '',
    o.favourites.length ? `Models this user rates highest: ${o.favourites.join(', ')}.` : '',
    prism ? `This is your one ongoing chat with this user. Today is ${new Date().toISOString().slice(0, 10)}.` : `This chat: "${o.title}". Today is ${new Date().toISOString().slice(0, 10)}.`,
    o.summary ? `\nEARLIER IN THIS CHAT (summary):\n${o.summary}` : '',
    /*
     * The figures that change every turn come LAST (2026-10-20): Gemini bills a
     * request's unchanged opening at a tenth of the price (its implicit cache),
     * and a balance in the middle cut that opening short before the memory and
     * the summary on every turn.
     */
    o.named?.length ? `\nTHE USER NAMED THESE MODELS - use exactly these for that part of the work (a carry-on turn included), with the settings they asked for; anything else only if one truly cannot do it, and say so first:\n${o.named.map(n => `- ${n.label}: ${n.via} with "${n.id}"`).join('\n')}` : '',
    '',
    'RIGHT NOW',
    o.isAdmin ? '- This is an admin account: nothing is charged, but show costs as if it were.' : `- The user has ${o.balance ?? 0} tickets.`,
    o.allowance.run
      ? `- The user set this request's budget in the prompt box: you may spend up to ${o.allowance.request} tickets on it without asking, in all (with every turn it carries on by itself). When the WHOLE request will clearly cost more, call propose_plan first (each step with its ticket cost from browse_models), then STOP and wait for approval. A plan that fits inside the budget is approved automatically - you carry straight on.`
      : `- You may spend up to ${o.allowance.turn} tickets in a turn without asking (a request that carries on by itself over several turns: up to ${o.allowance.request} in all). When the WHOLE request will clearly cost more, call propose_plan first (each step with its ticket cost from browse_models), then STOP and wait for approval. A plan that fits inside that is approved automatically - you carry straight on.`,
    plan ? `- An approved plan is running: ${plan.spent}/${plan.total} tickets spent. Work inside it; if it runs short, propose_plan again with the extra needed.` : '- No plan is approved right now.',
    o.room.which ? `- The user's own limit: ${o.room.room} tickets left under ${o.room.which}.` : '',
  ].filter(s => s !== '').join('\n')
}

// ── Keeping each step cheap ──────────────────────────────────────────────────

/**
 * Before every step, pictures that earlier tool calls returned are swapped for
 * a one-line note; only the newest tool results keep theirs. Every step
 * re-sends the whole turn, so a turn that inspected a clip, made a cut and had
 * it reviewed was re-sending a dozen frames on each later step - 134k input
 * tokens for one small production (2026-10-19). Nova has already judged those
 * pictures; their ids and its notes about them stay in the context.
 */
export function prunePictures(messages: ModelMessage[]): ModelMessage[] {
  let keepFrom = messages.length
  // Keep the pictures of the last tool message (the results the model is about to read)
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'tool') { keepFrom = i; break } }
  return messages.map((m, i) => {
    if (m.role !== 'tool' || i >= keepFrom || !Array.isArray(m.content)) return m
    let changed = false
    const content = m.content.map((part: any) => {
      if (part?.type !== 'tool-result' || part.output?.type !== 'content' || !Array.isArray(part.output.value)) return part
      const value = part.output.value.filter((v: any) => v?.type !== 'file' && v?.type !== 'file-data' && v?.type !== 'image-data')
      if (value.length === part.output.value.length) return part
      changed = true
      return { ...part, output: { ...part.output, value: [...value, { type: 'text', text: `[${part.output.value.length - value.length} picture(s) shown earlier - removed to save cost]` }] } }
    })
    return changed ? ({ ...m, content } as ModelMessage) : m
  })
}

// ── Which model runs each STEP (2026-10-19) ──────────────────────────────────

/*
 * The owner: "use Argon where it needs to (consistency, etc) and delegate to
 * Flash to save money for things it doesn't need to". A turn is many steps -
 * look up models, read assets, make a still, LOOK at it, file it, start the
 * clips - and only some need the strong model. Each step picks:
 *  - Argon (the STRONG model): the planning step of a production, and any step
 *    that follows a tool which showed pictures or a check result - that step
 *    judges the work (is it on-model, is the seam clean, what to redo);
 *  - Flash: steps after mechanical tools (lookups, saving, filing, starting a
 *    render, recipes) and the closing summary.
 * Light turns stay on Flash; a create turn escalates only once the chat has a
 * look bible (consistency is then the job). Each step is billed at its own
 * model's rate. An admin who pins a model gets it on every step.
 */
const STRONG_MODEL = NOVA_ROUTES.production
const FAST_MODEL = NOVA_ROUTES.run
/** Tools whose results the next step must JUDGE: pictures, frames, measurements, verdicts. */
const JUDGE_TOOLS = new Set([
  'generate_image', 'edit_image', 'expand_image', 'cutout', 'view_media', 'asset_pictures', 'inspect_media', 'watch_video',
  'extract_frame', 'make_loop', 'assemble_cut', 'recut', 'export_formats', 'check_shots', 'critique_work', 'trim_media',
])
export function stepModel(o: { tier: NovaTier; pinned: string | null; stepNumber: number; maxSteps: number; lastTools: string[]; hasBible: boolean }): string {
  if (o.pinned) return o.pinned
  if (o.tier === 'light') return FAST_MODEL
  if (o.stepNumber === 0) return o.tier === 'production' ? STRONG_MODEL : FAST_MODEL
  // The last step only writes the summary
  if (o.stepNumber >= o.maxSteps - 1) return FAST_MODEL
  const judging = o.lastTools.some(t => JUDGE_TOOLS.has(t))
  if (!judging) return FAST_MODEL
  return o.tier === 'production' || o.tier === 'run' || o.hasBible ? STRONG_MODEL : FAST_MODEL
}
/** "Argon ×3 + Flash ×5" for the route chip. */
const shortName = (id: string) => id.replace(/^gemini-[\d.]+-?/, '').replace(/-preview$/, '').replace(/^./, c => c.toUpperCase()) || id

// ── Interrupted turns ────────────────────────────────────────────────────────

/** Longer than any turn can run (the route's limit is 300s). */
const STALE_TURN_MS = 6 * 60_000
/** No new step starts after this... */
const TURN_SOFT_MS = 200_000
/** ...and picture waits end here, well inside the 285s hard stop (the final write needs a few seconds). */
const TURN_WAIT_MS = 240_000

/**
 * A reply that ended (finished, stopped, timed out or was cut off) cannot leave
 * steps "running" - the studio would show "Making the image..." forever. A
 * render that was already submitted (it has its queue job) is handed to the
 * jobs route to settle like any other; anything else is marked as cut off.
 */
export function closeOpenSteps(steps: NovaStep[]): NovaStep[] {
  return steps.map(s => s.status !== 'running' ? s
    : s.queueId ? { ...s, status: 'pending' as const }
    : { ...s, status: 'error' as const, error: s.kind ? 'Cut off before it finished - if it rendered, it is in My Generations' : 'Cut off before it finished' })
}

/**
 * Close replies left running by a crash, a deploy or a killed function: they
 * keep the steps they saved, get a note, and their whole chat hold goes back
 * (a broken turn's tokens are on us). Returns true while a turn is genuinely
 * still running.
 */
export async function sweepStaleTurns(chatId: number, user: { id: number; email: string }, isAdmin: boolean): Promise<boolean> {
  const rows = await prisma.chatMessage.findMany({ where: { chatId, role: 'assistant' }, orderBy: { id: 'desc' }, take: 3, select: { id: true, content: true, metadata: true } })
  let busy = false
  for (const r of rows) {
    const m = (r.metadata ?? {}) as Record<string, any>
    if (!m.running) continue
    if (Date.now() - (Number(m.startedAt) || 0) < STALE_TURN_MS) { busy = true; continue }
    const held = Math.max(0, Number(m.held) || 0)
    // Claim it first, so two sweeps can never refund twice
    const claimed = await prisma.$executeRaw`UPDATE "ChatMessage" SET metadata = (metadata::jsonb - 'running') || '{"interrupted":true}'::jsonb WHERE id = ${r.id} AND metadata->>'running' = 'true'`
    if (!claimed) continue
    /*
     * Its open steps are closed (a submitted render is settled later), and the
     * production is marked to carry on - by the open studio, or by the cron
     * with background runs on - like a turn that ran out of time. Only the
     * newest reply, only if the chat has not chained too many turns already.
     */
    /*
     * Billing sweep 2026-10-23 (review): a pay-first tool (cut, loop, export)
     * cut off mid-render never reached its own refund - its prepaid tickets
     * are on the step (`prepaid`). Every step this sweep closes as an error
     * gives them back, and `prepaid` is zeroed in the steps written below.
     * The `running` claim above makes this exactly once (only the sweep that
     * won it gets here, and the dead turn can no longer settle the step).
     */
    const before = Array.isArray(m.steps) ? (m.steps as NovaStep[]) : []
    const steps = closeOpenSteps(before).map(s => s.status === 'error' && (s.prepaid ?? 0) > 0 ? { ...s, prepaid: 0, tickets: 0 } : s)
    const prepaid = before.reduce((sum, s, i) => sum + (s.status === 'running' && steps[i]?.status === 'error' ? Math.max(0, Math.round(Number(s.prepaid) || 0)) : 0), 0)
    // Never resumed when the user stopped it (the Stop button's `cancel`)
    const resume = r.id === rows[0].id && !m.cancel && readChatState((await prisma.chat.findUnique({ where: { id: chatId }, select: { skills: true } }))?.skills).autoTurns! < NOVA_MAX_AUTO_TURNS
    const pending = steps.some(s => s.status === 'pending')
    const patch = { steps, ...(resume ? (pending ? { continueAfterRenders: true } : { keepGoing: 'time' }) : {}) }
    await prisma.$executeRaw`UPDATE "ChatMessage" SET metadata = metadata::jsonb || ${JSON.stringify(patch)}::jsonb WHERE id = ${r.id}`.catch(() => {})
    if (!isAdmin && held + prepaid > 0) await refundGenerationTickets(user.id, user.email, held + prepaid).catch(() => {})
    if (!r.content) await prisma.chatMessage.update({ where: { id: r.id }, data: { content: 'This reply was interrupted before it finished. Anything it made is saved in My Generations and shown above.' } }).catch(() => {})
  }
  return busy
}

/** The user's last real (typed) message - what a wake-up or plan approval is still working towards. */
async function originalBrief(chatId: number): Promise<string> {
  const rows = await prisma.chatMessage.findMany({ where: { chatId, role: 'user' }, orderBy: { id: 'desc' }, take: 12, select: { content: true, metadata: true } })
  const real = rows.find(r => !((r.metadata ?? {}) as Record<string, any>).system)
  return real?.content ?? ''
}

// ── The turn ─────────────────────────────────────────────────────────────────

export type NovaTurnInput = {
  user: { id: number; email: string }
  isAdmin: boolean
  /** Which personas' chats this caller may open (lib/nova/auth requireAgentUser); default Nova's. */
  sources?: ('nova' | 'prism')[]
  chatId: number
  text: string
  attachmentIds: number[]
  /** Assets the user picked for this message (their notes and pictures go to Nova). */
  assetIds?: number[]
  attachmentUrls: string[]
  model?: string
  approvePlan?: { messageId: number; tickets: number }
  declinePlan?: { messageId: number }
  continueRenders?: boolean
  /** The run budget set in the prompt box for this request (lib/nova/config cleanRunBudget). */
  runBudget?: number
  signal?: AbortSignal
  /** A turn the cron runs with nobody watching (lib/nova/runner): the user's background-run key header. */
  background?: { headers: Record<string, string> }
}

/** Errors before streaming starts come back as a JSON status; then it is an NDJSON stream. */
export async function runNovaTurn(input: NovaTurnInput): Promise<{ status: number; json: Record<string, unknown> } | { stream: ReadableStream<Uint8Array> }> {
  const { user, isAdmin } = input
  const chat = await prisma.chat.findFirst({ where: { id: input.chatId, userId: user.id, source: { in: input.sources ?? ['nova'] } } })
  if (!chat) return { status: 404, json: { error: 'Chat not found' } }
  const persona: NovaPersonaId = chat.source === 'prism' ? 'prism' : 'nova'
  const personaName = persona === 'prism' ? 'Prism' : 'Nova'
  // A turn cut off by a crash or deploy is closed (and its hold refunded); a
  // turn still running blocks a second one, so two can never spend at once
  if (await sweepStaleTurns(chat.id, user, isAdmin)) return { status: 409, json: { error: 'Nova is still working on the last message - wait for it, or press Stop.' } }
  const state = readChatState(chat.skills)
  const pinned = resolveNovaModel(input.model ?? chat.model, isAdmin)
  const { budget, spend } = await loadNovaBudget(user.id)
  const room = roomLeft(budget, spend, state.spent)
  if (room.room < 1) return { status: 402, json: { error: `Nova has reached ${room.which}. Raise it in Budget to keep going.`, limit: true } }

  // ── what this turn is: a message, a plan decision, or a wake-up ──
  let userText = clip(input.text, 8000)
  let system = false
  if (input.approvePlan || input.declinePlan) {
    const mid = (input.approvePlan ?? input.declinePlan)!.messageId
    const row = await prisma.chatMessage.findFirst({ where: { id: mid, chatId: chat.id, role: 'assistant' }, select: { id: true, metadata: true } })
    const meta = (row?.metadata ?? {}) as Record<string, any>
    const plan = meta.plan as NovaPlan | undefined
    if (!row || !plan || plan.status !== 'proposed') return { status: 400, json: { error: 'That plan is no longer open' } }
    if (input.approvePlan) {
      const tickets = Math.max(1, Math.min(100_000, Math.round(Number(input.approvePlan.tickets) || plan.totalTickets)))
      if (!isAdmin) {
        const have = await novaBalance(user.id)
        if (have < tickets) return { status: 402, json: { error: `This plan needs ${tickets} tickets - you have ${have}.`, needTickets: true } }
      }
      plan.status = 'approved'; plan.approvedTickets = tickets
      // A new plan replaces what was left of the last one
      state.plan = { messageId: row.id, total: tickets, spent: 0 }
      userText = `[Plan approved with a budget of ${tickets} tickets${tickets !== plan.totalTickets ? ` (you asked for ${plan.totalTickets} - fit the work to this)` : ''}. Go ahead.]${userText ? ` ${userText}` : ''}`
    } else {
      plan.status = 'declined'
      userText = `[Plan declined.]${userText ? ` ${userText}` : ' Ask what they would like instead.'}`
    }
    /*
     * Billing sweep 2026-10-23: the decision is claimed atomically. The read
     * above is only a fast refusal - two approve clicks (a double tap, two
     * tabs, a retry) both saw 'proposed' and both ran the whole production.
     * Now the write only lands WHERE the stored plan is still 'proposed', so
     * exactly one request flips it; the other changes no row and gets a 409
     * before any hold, model call or render happens.
     */
    const decided = await prisma.$executeRaw`UPDATE "ChatMessage" SET metadata = ${JSON.stringify({ ...meta, plan })}::jsonb WHERE id = ${row.id} AND metadata::jsonb -> 'plan' ->> 'status' = 'proposed'`
    if (!decided) return { status: 409, json: { error: 'That plan was already decided' } }
    system = true
  } else if (input.continueRenders) {
    const last = await prisma.chatMessage.findFirst({ where: { chatId: chat.id, role: 'assistant' }, orderBy: { id: 'desc' }, select: { id: true, metadata: true } })
    const meta = (last?.metadata ?? {}) as Record<string, any>
    if (!last || !(meta.continueAfterRenders || meta.keepGoing) || meta.continued) return { status: 400, json: { error: 'Nothing is waiting to continue' } }
    if ((state.autoTurns ?? 0) >= NOVA_MAX_AUTO_TURNS) return { status: 400, json: { error: `Nova has carried on by itself ${NOVA_MAX_AUTO_TURNS} times - send a message to keep going.` } }
    const steps = (meta.steps ?? []) as NovaStep[]
    if (steps.some(s => s.status === 'pending')) return { status: 400, json: { error: 'Renders are still running' } }
    // Claimed atomically: an open tab and another poller can never both continue it
    const claimed = await prisma.$executeRaw`UPDATE "ChatMessage" SET metadata = metadata::jsonb || '{"continued":true}'::jsonb WHERE id = ${last.id} AND COALESCE(metadata->>'continued', 'false') <> 'true'`
    if (!claimed) return { status: 409, json: { error: 'Already continuing' } }
    state.autoTurns = (state.autoTurns ?? 0) + 1
    // Billing sweep 2026-10-23: a failed step is NOT told it "was refunded" - a cut-off step or a
    // render whose refund did not happen would have Nova promise the user money back that never came
    const finished = steps.filter(s => s.kind).map(s => s.status === 'done' ? `#${s.generationId ?? '?'} ${s.kind} (${s.model ?? s.tool}, ${s.tickets ?? 0} tickets) ready` : `${s.kind} (${s.model ?? s.tool}) failed: ${clip(s.error, 80)}`)
    const brief = clip(await originalBrief(chat.id), 600)
    userText = meta.continueAfterRenders
      ? `[Your renders finished: ${finished.join('; ') || 'nothing'}. Continue with what you planned.]`
      : `[Your last turn ran out of ${meta.keepGoing === 'time' ? 'time' : 'steps'} before the work was done. Carry on from where you left off - do not redo finished work${state.plan ? ', and stay inside the approved plan' : ''}.${brief ? ` The request: "${brief}"` : ''}]`
    system = true
  }
  if (!userText && !input.attachmentIds.length && !input.assetIds?.length) return { status: 400, json: { error: 'Say something to Nova' } }
  if (!system) state.autoTurns = 0
  // A new request takes the prompt box's budget (or none); approvals and wake-ups keep the request's
  if (!system) state.runBudget = cleanRunBudget(input.runBudget)

  // ── which model runs this turn: an admin's pinned model, else the router ──
  const lastReply = (await prisma.chatMessage.findFirst({ where: { chatId: chat.id, role: 'assistant' }, orderBy: { id: 'desc' }, select: { content: true } }))?.content ?? ''
  // Attached clips (2026-10-21): "cut these together" is an edit of the user's footage - never a light, tool-less turn
  const attachedClips = input.attachmentIds.length ? (await ownedRows(user.id, input.attachmentIds)).filter(r => kindOf(r) === 'video' || kindOf(r) === 'cut').length : 0
  const routed = pinned === NOVA_AUTO
    ? await routeTurn(userText, { planActive: !!state.plan, continuing: !!input.continueRenders, attachments: input.attachmentIds.length + input.attachmentUrls.length, clips: attachedClips, lastReply })
    : { tier: 'production' as NovaTier, model: pinned, usage: { inputTokens: 0, outputTokens: 0 }, why: 'pinned by an admin' }
  const model = routed.model
  const routerUsd = novaChatUsd('gemini-3.5-flash-lite', routed.usage)

  // ── hold the chat's price (refunded down to the real cost after) ──
  // Steps for this kind of turn (production and run turns need room to make, check and redo)
  const maxSteps = NOVA_TIER_STEPS[routed.tier] ?? NOVA_MAX_STEPS
  // Steps may run on the strong model (judging) or Flash: the hold assumes up to half on the strong one
  const mixed = pinned === NOVA_AUTO && routed.tier !== 'light'
  const hold = mixed
    ? Math.max(novaTurnHold(FAST_MODEL, true, maxSteps), novaTurnHold(STRONG_MODEL, true, Math.ceil(maxSteps / 2)))
    : novaTurnHold(model, routed.tier === 'production' || routed.tier === 'run', maxSteps)
  /*
   * Prism's quick questions are free (2026-10-20): a light turn the user typed
   * (no attachments) takes one action from the daily free AI-text allowance
   * that Enhance and Storyboard share (lib/prompt-enhance), instead of a hold.
   * A light turn is Flash for a handful of steps - a cent or so at most - and
   * this is what the old guide was: free help. Past the allowance, and for any
   * turn that works (create / production), the chat is billed like Nova's.
   */
  let free = false
  if (persona === 'prism' && !isAdmin && !system && routed.tier === 'light' && !input.attachmentIds.length && !input.attachmentUrls.length) {
    const plan = await enhancePlanFor(user)
    free = (await consumeEnhance(user.id, ENHANCE_LIMITS[plan])) !== null
  }
  let held = 0
  if (!isAdmin && !free) {
    const paid = await deductGenerationTickets(user.id, user.email, hold)
    if (!paid.ok) return { status: 402, json: { error: `A turn with ${personaName} holds up to ${hold} tickets while it works (you only pay what it uses) - you have ${paid.have}.`, needTickets: true } }
    held = hold
  }

  try {
    // ── the user's message ──
    const attachRows = (await ownedRows(user.id, input.attachmentIds)).slice(0, 8)
    /*
     * Assets the user picked (2026-10-19, owner): "this is the character /
     * product I mean". Each one's name, kind and notes go to Nova as text, its
     * pictures become My Generations ids Nova can pass as references, and the
     * first pictures are shown to it. Only the user's own assets are read.
     */
    const picked = (await Promise.all((input.assetIds ?? []).slice(0, 6).map(id => findAsset(user.id, id)))).filter((a): a is NonNullable<typeof a> => !!a)
    const assetInfo = await Promise.all(picked.map(async a => {
      // Pictures (shown, usable as references) and clips (footage to edit - assets hold video since 2026-10-21)
      const all = storedRefs(a.refs)
      const refs = all.filter(r => r.kind !== 'video'), clipRefs = all.filter(r => r.kind === 'video')
      const rows = all.length ? await prisma.generatedImage.findMany({ where: { userId: user.id, isDeleted: false, imageUrl: { in: all.map(r => r.url) } }, select: { id: true, imageUrl: true, thumbnailUrl: true } }) : []
      const ids = refs.map(r => rows.find(x => x.imageUrl === r.url)?.id).filter((v): v is number => !!v)
      const clipIds = clipRefs.map(r => rows.find(x => x.imageUrl === r.url)?.id).filter((v): v is number => !!v)
      const first = rows.find(x => x.imageUrl === refs[0]?.url)
      return { a, refs, ids, clipIds, thumb: first?.thumbnailUrl ?? refs[0]?.url ?? (clipIds[0] ? `/api/images/${clipIds[0]}?thumb=1` : null) }
    }))
    const assetMeta = assetInfo.map(x => ({ id: x.a.id, name: x.a.name, kind: x.a.kind, thumb: x.thumb }))
    const seenAssetIds: number[] = []
    /*
     * The chat's references (the studio panel's switches): told to Nova every
     * turn, their pictures shown again only when the set changed since Nova
     * last saw it - showing them on every turn would bill the same pictures
     * over and over.
     */
    const chatRefs = await resolveChatRefs(user.id, state.refs)
    const refsNew = refsKey(chatRefsIds(chatRefs)) !== (state.refsShown ?? '')
    const attachments = attachRows.map(r => ({ id: r.id, url: r.imageUrl, kind: kindOf(r) as NovaMediaKind }))
    /*
     * Attached clips are not shown as pictures (2026-10-21): Nova is told each
     * one's length and shape so it can plan a cut from them, and watches them
     * (watch_video / inspect_media) when the edit depends on what happens.
     */
    const clipFacts = (r: (typeof attachRows)[number]) => {
      const m = (r.videoMetadata ?? {}) as { duration?: unknown; durationSec?: unknown; aspectRatio?: unknown; upload?: boolean }
      const sec = Number(m.durationSec ?? m.duration)
      return [Number.isFinite(sec) && sec > 0 ? `${m.upload || m.durationSec ? '' : 'about '}${Math.round(sec * 10) / 10}s` : '', typeof m.aspectRatio === 'string' ? m.aspectRatio : ''].filter(Boolean).join(', ')
    }
    const attachLabel = (r: (typeof attachRows)[number]) => { const k = kindOf(r); const f = k === 'video' || k === 'cut' ? clipFacts(r) : ''; return `#${r.id} (${k}${f ? `, ${f}` : ''}${r.model === 'nova-upload' ? ', uploaded' : ''})` }
    // Prism files what it makes in one top-level "Prism" folder; each Nova chat gets its own under "Nova Studio"
    if (!state.folderId) state.folderId = persona === 'prism' ? await ensureChatFolder(user.id, 'Prism', null) : await ensureChatFolder(user.id, chat.title === 'New chat' ? (clip(userText, 60) || 'New chat') : chat.title)
    const userRow = await prisma.chatMessage.create({
      data: { chatId: chat.id, role: 'user', content: userText, metadata: { ...(attachments.length ? { attachments } : {}), ...(assetMeta.length ? { assets: assetMeta } : {}), ...(system ? { system: true } : {}) } as object, imageUrls: attachments.map(a => a.url) },
      select: { id: true },
    })
    let title = chat.title
    if (title === 'New chat' && !system && userText) {
      title = clip(userText.replace(/\[.*?\]/g, ''), 48) || 'New chat'
      await prisma.chat.update({ where: { id: chat.id }, data: { title } })
    }

    // ── history: the window word for word, older folded into the summary ──
    const recent = (await prisma.chatMessage.findMany({
      // Nothing at or before summaryUpToId is replayed: that is in the summary (or was cleared)
      where: { chatId: chat.id, id: { lt: userRow.id, ...(chat.summaryUpToId ? { gt: chat.summaryUpToId } : {}) } }, orderBy: { id: 'desc' }, take: NOVA_HISTORY,
      select: { id: true, role: true, content: true, model: true, metadata: true, createdAt: true },
    })).reverse()
    const compact = await compactChat(chat, recent[0]?.id ?? null)
    const messages: ModelMessage[] = recent.map(r => {
      const m = toNovaMessage(r)
      return m.role === 'user' ? { role: 'user' as const, content: digest(m) } : { role: 'assistant' as const, content: digest(m) || '(no reply)' }
    })
    const assetText = assetInfo.map(x => `- Asset ${x.a.id} "${x.a.name}" (${x.a.kind})${x.a.notes ? ` - notes: ${clip(x.a.notes, 500)}` : ''}\n  pictures (use as reference_ids, most representative first): ${x.ids.length ? x.ids.map(i => `#${i}`).join(', ') : 'none in My Generations'}${x.refs.length > x.ids.length ? ` (+${x.refs.length - x.ids.length} uploaded straight into the asset - shown, not usable as references)` : ''}${x.clipIds.length ? `\n  video clips (the user's footage - edit / cut these): ${x.clipIds.map(i => `#${i}`).join(', ')}` : ''}`).join('\n')
    const refsText = chatRefsText(chatRefs)
    const attachedClipCount = attachRows.filter(r => kindOf(r) === 'video' || kindOf(r) === 'cut').length
    const parts: any[] = [{ type: 'text', text: `${userText}${attachRows.length ? `\n[attached: ${attachRows.map(attachLabel).join(', ')}]${attachedClipCount ? `\n[${attachedClipCount > 1 ? `These ${attachedClipCount} clips are` : 'This clip is'} the user's own footage, in the order attached - edit it as asked (see THE USER'S OWN FOOTAGE); do not regenerate it unless they ask for new footage.]` : ''}` : ''}${assetText ? `\n[The user picked these Assets - this is what they mean; keep them consistent with these pictures and notes:\n${assetText}]` : ''}${refsText ? `\n${refsText}` : ''}` }]
    // The pictures attached to THIS message are shown, so Nova can see what the user means
    for (const a of attachRows.filter(r => kindOf(r) === 'image').slice(0, 4)) { const p = await imagePart(a.imageUrl); if (p) parts.push(p) }
    for (const url of input.attachmentUrls.slice(0, 2)) { const p = await imagePart(url); if (p) parts.push(p) }
    // The picked assets' first pictures (two each, four in all), so Nova sees who / what they are
    for (const x of assetInfo) for (const r of x.refs.slice(0, 2)) { if (parts.filter(p => p.type === 'file').length >= 6) break; const p = await imagePart(r.url); if (p) parts.push(p) }
    for (const x of assetInfo) seenAssetIds.push(...x.ids, ...x.clipIds)
    // The chat's references: newly switched on -> their first pictures, so Nova sees them (six pictures in all at most)
    if (refsNew) {
      const pics = [...chatRefs.assets.flatMap(a => a.pictures.filter(p => p.kind !== 'video').slice(0, 1).map(p => p.url)), ...chatRefs.generations.filter(g => g.kind === 'image').map(g => g.url)]
      for (const u of pics) { if (parts.filter(p => p.type === 'file').length >= 6) break; const p = await imagePart(u); if (p) parts.push(p) }
    }
    for (const a of chatRefs.assets) seenAssetIds.push(...a.ids, ...a.clipIds)
    seenAssetIds.push(...chatRefs.generations.map(g => g.id))
    if (input.attachmentUrls.length) parts.push({ type: 'text', text: '(The last picture(s) are from an asset and are not in My Generations: look at them, but they cannot be passed as references.)' })
    messages.push({ role: 'user', content: parts.map(p => p.type === 'file' ? { type: 'file', data: p.data.data, mediaType: p.mediaType } : p) as any })

    // ── run ──
    const enc = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    const send = (e: NovaStreamEvent) => { try { controller.enqueue(enc.encode(JSON.stringify(signPayload(e)) + '\n')) } catch { /* closed */ } }

    // The reply's row exists from the start (metadata.running), and its steps
    // are saved as they happen: a turn cut off mid-way still leaves what it
    // made on record, and sweepStaleTurns can refund its hold
    const asst = await prisma.chatMessage.create({
      data: { chatId: chat.id, role: 'assistant', content: '', model, metadata: { running: true, held, startedAt: Date.now(), steps: [] } as object },
      select: { id: true },
    })
    /*
     * How the turn can be stopped. With background runs on, closing the tab
     * must NOT kill a production, so the connection is not what stops it: the
     * Stop button sets `cancel` on this reply (POST .../stop) and the turn
     * checks it every few seconds. Without background runs, a closed
     * connection still stops the turn, as before.
     */
    const stopper = new AbortController()
    /*
     * The turn's clock (2026-10-19): the route has 300s, and a production of a
     * dozen 4K stills used to run into the hard limit while it waited on them -
     * the turn died silently, short of what was asked. Now no new step starts
     * after TURN_SOFT_MS, picture waits end at TURN_WAIT_MS (a still that is
     * not ready yet is settled later like a video), and a turn stopped by the
     * clock carries on by itself.
     */
    const turnStart = Date.now()
    const outOfTime = () => Date.now() - turnStart > TURN_SOFT_MS
    const detached = !!input.background || (await backgroundStatus(user.id).catch(() => ({ enabled: false }))).enabled
    if (!detached && input.signal) input.signal.addEventListener('abort', () => stopper.abort(), { once: true })
    const cancelPoll = setInterval(() => {
      void prisma.chatMessage.findUnique({ where: { id: asst.id }, select: { metadata: true } }).then(r => {
        if (((r?.metadata ?? {}) as Record<string, any>).cancel) stopper.abort()
      }).catch(() => {})
    }, 3000)
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    /*
     * Progress is saved every couple of seconds (the steps AND the text so far),
     * so a page reloaded mid-turn shows where Nova is. Once the turn has written
     * its final row nothing more is saved: a tool still finishing after a stop
     * or a timeout used to write `running` back over the finished reply, and
     * the reply then read as "interrupted" with its steps stuck on "Making...".
     */
    let closed = false
    const live = { text: '' }
    const saveSteps = () => {
      if (saveTimer || closed) return
      saveTimer = setTimeout(() => {
        saveTimer = null
        if (closed) return
        void prisma.chatMessage.update({ where: { id: asst.id }, data: { content: live.text, metadata: { running: true, held, startedAt: turnStart, steps: ctx.steps } as object } }).catch(() => {})
      }, 2000)
    }
    const ctx: NovaTurnCtx = {
      user, isAdmin, chatId: chat.id, state, budget, spend, persona,
      steps: [], emit: step => { send({ t: 'step', step: { ...step } }); saveSteps() }, textLength: () => live.text.length,
      // A turn that carries on by itself keeps counting the request's spend against its allowance
      allowance: novaAllowance(budget, state),
      mediaTickets: 0, unplanned: 0, chainBefore: input.continueRenders ? (state.chainUnplanned ?? 0) : 0, reserved: 0, proposedPlan: null, waitForRenders: false,
      deadline: turnStart + TURN_WAIT_MS,
      extraUsd: 0, criticRuns: 0, modelFailures: {}, authHeaders: input.background?.headers, brief: system ? (await originalBrief(chat.id)) : userText,
      seenIds: new Set([...attachRows.map(r => r.id), ...seenAssetIds]),
    }
    const balanceNow = isAdmin ? null : await novaBalance(user.id)
    // Prism's quick questions: a short prompt and the few tools a question needs (see PRISM_LEAN_TOOLS)
    const lean = persona === 'prism' && routed.tier === 'light'
    const allTools = { ...makeNovaTools(ctx), ...makeProTools(ctx), ...makeStudioTools(ctx), ...makePostTools(ctx), ...(persona === 'prism' ? { site_help: siteHelpTool } : {}) }
    const leanTools = Object.fromEntries(Object.entries(allTools).filter(([k]) => (PRISM_LEAN_TOOLS as readonly string[]).includes(k))) as Partial<typeof allTools>
    const [memory, favourites, lessons] = await Promise.all([loadNovaMemory(user.id), userFavouriteModels(user.id), loadLessons(user.id).then(s => recentLessons(s)).catch(() => '')])
    // Admins share one safety switch with the rest of the site (the composer's admin Filter ON/OFF); everyone else is always filtered
    const safetyOff = isAdmin && !(await readFilterState().catch(() => ({ on: true }))).on

    void (async () => {
      let text = ''
      let usage: NovaUsage = { inputTokens: 0, outputTokens: 0 }
      let failed: string | null = null
      let stepsUsed = 0
      let timedOut = false
      // The model each step ran on, and what each cost (per-step billing)
      const stepModels: string[] = []
      let stepUsd = 0
      /** The same steps at what Google bills - cached input at its discount (recorded, not charged on). */
      let stepCostUsd = 0
      try {
        const result = streamText({
          model: google(model),
          instructions: lean
            ? prismLeanInstructions({ isAdmin, balance: balanceNow != null ? balanceNow + held : null, memory, summary: compact.summary, safetyOff })
            : novaInstructions({ persona, isAdmin, balance: balanceNow != null ? balanceNow + held : null, state, allowance: ctx.allowance, room: roomLeft(budget, spend, state.spent), summary: compact.summary, title, memory, favourites, tier: routed.tier, safetyOff, lessons, named: namedModels(ctx.brief, isAdmin) }),
          messages,
          tools: lean ? leanTools : allTools,
          // A plan the studio approved by itself does not end the turn
          stopWhen: [stepCountIs(maxSteps), () => !!ctx.proposedPlan, hasToolCall('wait_for_renders'), () => { if (outOfTime()) timedOut = true; return timedOut }],
          // Old pictures out of the context; the last allowed step is reserved for the summary,
          // so a turn that used its steps on work still tells the user what it did
          prepareStep: ({ stepNumber, messages, steps }) => {
            const m = stepModel({ tier: routed.tier, pinned: pinned === NOVA_AUTO ? null : pinned, stepNumber, maxSteps, lastTools: (steps.at(-1)?.toolCalls ?? []).map(c => c?.toolName ?? ''), hasBible: !!state.bible })
            stepModels[stepNumber] = m
            return {
              model: google(m),
              messages: prunePictures(messages),
              ...(stepNumber >= maxSteps - 1 ? { toolChoice: 'none' as const } : {}),
            }
          },
          maxOutputTokens: 8192,
          abortSignal: AbortSignal.any([stopper.signal, AbortSignal.timeout(285_000)]),
          providerOptions: { google: {
            thinkingConfig: model.startsWith('gemini-2.5') ? { thinkingBudget: 1024 } : { thinkingLevel: 'low' },
            // Admin test mode: Gemini's own blocking relaxed to high-risk only (never off) - the
            // generation models' checks and the floor in the instructions still apply
            ...(safetyOff ? { safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' })) } : {}),
          } } as any,
        })
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') { text += part.text; live.text = text; send({ t: 'text', d: part.text }); saveSteps() }
          else if (part.type === 'error') failed = String((part as any).error?.message ?? (part as any).error ?? 'error').slice(0, 300)
          // A stop or the hard time limit ends the stream with an 'abort' part (no error is thrown)
          else if (part.type === 'abort') { if (stopper.signal.aborted) failed = 'Stopped'; else timedOut = true }
        }
        const allSteps = await result.steps
        stepsUsed = allSteps.length
        const u = await result.totalUsage
        usage = { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, cachedInputTokens: u.inputTokenDetails?.cacheReadTokens ?? 0 }
        allSteps.forEach((s, k) => {
          stepUsd += novaChatUsd(stepModels[k] ?? model, { inputTokens: s.usage?.inputTokens ?? 0, outputTokens: s.usage?.outputTokens ?? 0 })
          stepCostUsd += novaChatCostUsd(stepModels[k] ?? model, { inputTokens: s.usage?.inputTokens ?? 0, outputTokens: s.usage?.outputTokens ?? 0, cachedInputTokens: s.usage?.inputTokenDetails?.cacheReadTokens ?? 0 })
        })
      } catch (e: any) {
        if (stopper.signal.aborted) failed = 'Stopped'
        else if (e?.name === 'TimeoutError' || e?.name === 'AbortError') timedOut = true
        else failed = String(e?.message || e).slice(0, 300)
      }
      closed = true
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      /*
       * Pay-first tools still rendering when the turn ended (Stop, time limit):
       * their prepaid tickets go back now, and the tool - which may still
       * finish in this process - is told not to deliver or refund again
       * (lib/nova/agent-tools abandonPrepaid / commitPrepaid). A tool already
       * committing settles itself. (Billing sweep 2026-10-23, review.)
       */
      const cutOff = ctx.steps.filter(s => s.status === 'running' && (s.prepaid ?? 0) > 0 && abandonPrepaid(s))
      const cutOffTickets = cutOff.reduce((n, s) => n + Math.max(0, Math.round(Number(s.prepaid) || 0)), 0)
      for (const s of cutOff) { s.prepaid = 0; s.tickets = 0 }
      if (!isAdmin && cutOffTickets > 0) await refundGenerationTickets(user.id, user.email, cutOffTickets).catch(() => {})
      ctx.steps = closeOpenSteps(ctx.steps)
      // The saved reply is trimmed: the steps' places in it move with the text they followed
      const leadTrim = text.length - text.trimStart().length, kept = text.trim().length
      if (leadTrim || kept < text.length) for (const s of ctx.steps) if (s.textAt != null) s.textAt = Math.min(kept, Math.max(0, s.textAt - leadTrim))

      // ── pay for the chat: the measured tokens (and the summary's), never more than was held ──
      usage = { inputTokens: usage.inputTokens + compact.usage.inputTokens, outputTokens: usage.outputTokens + compact.usage.outputTokens, cachedInputTokens: usage.cachedInputTokens ?? 0 }
      // Every model this turn used, in dollars: the orchestrator, the summary (Flash-Lite), the router and the critic
      // Each step at its own model's rate (falls back to the turn's model when the steps could not be read)
      const orchestratorUsd = stepUsd > 0 ? stepUsd : novaChatUsd(model, { inputTokens: usage.inputTokens - compact.usage.inputTokens, outputTokens: usage.outputTokens - compact.usage.outputTokens })
      const turnUsd = orchestratorUsd + novaChatUsd('gemini-3.5-flash-lite', compact.usage) + routerUsd + ctx.extraUsd
      const mix: Record<string, number> = {}
      for (const m of stepModels.filter(Boolean)) mix[shortName(m)] = (mix[shortName(m)] ?? 0) + 1
      const chatTickets = free ? 0 : turnUsd > 0 ? Math.min(hold, novaTicketsForUsd(turnUsd)) : 0
      let balance: number | null = null
      try {
        if (!isAdmin && held > chatTickets) await refundGenerationTickets(user.id, user.email, held - chatTickets)
        if (chatTickets) { state.spent += chatTickets; await addNovaSpend(user.id, chatTickets) }
        if (state.plan && state.plan.spent >= state.plan.total) state.plan = null
        // A turn nobody watched: the chat shows as new until it is opened
        if (input.background) state.unread = true
        state.chainUnplanned = (ctx.chainBefore ?? 0) + ctx.unplanned
        const plan = ctx.proposedPlan
        const pending = ctx.steps.some(s => s.status === 'pending')
        // Out of steps or time with the work unfinished (and nobody asked to stop): carry on by itself
        const cutShort = timedOut ? 'time' : stepsUsed >= maxSteps ? 'steps' : null
        const keepGoing = !!cutShort && !failed && !plan && (state.autoTurns ?? 0) < NOVA_MAX_AUTO_TURNS
        const meta = {
          steps: ctx.steps, ...(plan ? { plan } : ctx.autoPlan ? { plan: ctx.autoPlan } : {}),
          // charged = whether the CHAT was billed (admins chat free; the site's routes bill generations by their own rules)
          tickets: { chat: chatTickets, media: ctx.mediaTickets, charged: !isAdmin, ...(free ? { free: true } : {}) },
          usage, model, ...(failed ? { error: failed } : {}),
          // What the turn really cost us (Google's cache discount applied) - for the owner's numbers; billing uses `usd`
          costUsd: Math.round((stepCostUsd + novaChatUsd('gemini-3.5-flash-lite', compact.usage) + routerUsd + ctx.extraUsd) * 10000) / 10000,
          // Waiting on renders - including stills the clock handed over as 'pending' - then carrying on
          // ...unless the user pressed Stop (2026-10-20: a stopped turn with renders cooking
          // carried on by itself when they landed - "I pressed stop but it kept going")
          ...(pending && (ctx.waitForRenders || keepGoing) && failed !== 'Stopped' ? { continueAfterRenders: true } : {}),
          ...(keepGoing && !pending ? { keepGoing: cutShort } : {}),
          route: { tier: routed.tier, model, why: routed.why, ...(Object.keys(mix).length > 1 ? { mix } : {}) },
          ...(safetyOff ? { safetyOff: true } : {}),
          usd: Math.round(turnUsd * 10000) / 10000,
        }
        const content = text.trim() || (failed ? (failed === 'Stopped' ? 'Stopped. Anything already made is kept above.' : `Something went wrong: ${failed}`) : plan ? 'Here is my plan.' : cutShort ? 'Still working on it - carrying on…' : '')
        const row = await prisma.chatMessage.update({
          where: { id: asst.id },
          data: { content, model, metadata: meta as object, imageUrls: ctx.steps.map(s => s.mediaUrl).filter((u): u is string => !!u) },
          select: { id: true, role: true, content: true, model: true, metadata: true, createdAt: true },
        })
        // The references are the panel's: whatever it set during the turn stays; the set shown this turn counts as seen
        state.refs = readChatState((await prisma.chat.findUnique({ where: { id: chat.id }, select: { skills: true } }))?.skills).refs
        state.refsShown = refsKey(chatRefsIds(chatRefs))
        await prisma.chat.update({ where: { id: chat.id }, data: { skills: state as object, model: pinned, updatedAt: new Date() } })
        const fresh = await loadNovaBudget(user.id)
        if (!isAdmin) balance = await novaBalance(user.id)
        console.log(`[ai-usage] nova tier=${routed.tier} model=${model} usd=${turnUsd.toFixed(4)} critic=${ctx.criticRuns} in=${usage.inputTokens} out=${usage.outputTokens} chatTickets=${chatTickets} media=${ctx.mediaTickets} steps=${ctx.steps.length}${isAdmin ? ' (admin, not charged)' : ''}`)
        if (failed && !text.trim() && !ctx.steps.length) send({ t: 'error', error: failed })
        send({ t: 'done', message: toNovaMessage(row), balance, spend: fresh.spend, chatSpent: state.spent })
      } catch (e: any) {
        send({ t: 'error', error: String(e?.message || e).slice(0, 300) })
      } finally {
        clearInterval(cancelPoll)
        try { controller.close() } catch { /* already closed */ }
      }
    })()

    return { stream }
  } catch (e) {
    if (held) await refundGenerationTickets(user.id, user.email, held).catch(() => {})
    throw e
  }
}
