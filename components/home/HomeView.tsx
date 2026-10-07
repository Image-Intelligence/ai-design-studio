"use client"

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { Image as ImageIcon, Video, Shield, Wand2, Star, Music, Clapperboard, Film, Sparkles, ArrowRight, ArrowLeft, ScanSearch, Images, Search, X, LayoutGrid } from "lucide-react"
import { HomeMediaCard, type CardMedia } from "./HomeMediaCard"
import { AudioCardArt } from "./AudioCardArt"
import { GenerationsCarousel } from "./GenerationsCarousel"
import { FEATURED_MODELS, TALL_CARDS, FEATURED_COLUMNS, featuredSize, packFeatured, type FeaturedCell } from "./featured"
import { ProhibitedContentNotice } from "@/components/ProhibitedContentNotice"
import { SITE_EMPLOYEES, AdminModelBadge, isLabStudio } from "@/components/employees/EmployeesView"
import { EMPLOYEE_ADMIN_ONLY, employeeVisibleTo } from "@/lib/employees"
import { STORYBOARD_IMAGE_MODELS, STORYBOARD_VIDEO_MODELS, BOARD_MODES } from "@/lib/storyboard"

// Model group shape (matches IMAGE_MODEL_GROUPS / VIDEO_MODEL_GROUPS in portal-v2).
export type ModelGroup = { label: string; type: string; accent: string; dot: string; items: string[] }
/**
 * A tool-first section, subdivided by maker (matches IMAGE_MODEL_SECTIONS).
 *
 * Upscalers live here rather than in the company list, so a home page that
 * only read `imageGroups` never showed them at all — which is why SeedVR2 was
 * missing from this page after it went public.
 */
export type ModelSection = { label: string; note?: string; groups: ModelGroup[] }

// Home-page card order (overrides the group order). Listed models come first in this
// exact order; any model not listed follows in its original order.
const HOME_IMAGE_ORDER = ["NanoBanana 2.1", "NanoBanana Pro 2", "ChatGPT Images 2.5", "ChatGPT Images 2.0", "Kling O3", "SeeDream 5.0 Pro", "Recraft v4.1", "SeeDream 4.5", "Wan 2.7 Pro", "SeeDream 5.0 Lite"]
const HOME_VIDEO_ORDER = ["SeeDance 2.5", "SeeDance 2.0", "Kling 3.0", "Wan 2.5", "Happy Horse", "Kling V3 Motion", "SeeDance 1.5", "SeeDance 2.0 Fast", "Lipsync v3"]

function reorder<T extends { name: string }>(models: T[], order: string[]): T[] {
  const front = order.map(n => models.find(m => m.name === n)).filter((m): m is T => !!m)
  const rest = models.filter(m => !order.includes(m.name))
  return [...front, ...rest]
}

function Section({ icon, title, subtitle, children }: { icon?: ReactNode; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="mb-7 sm:mb-8">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-slate-300">{icon}</span>}
        <h2 className="text-base font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-white/85 to-white/55">{title}</h2>
        {subtitle && <span className="hidden sm:inline text-[9px] font-mono uppercase tracking-[0.18em] text-slate-600">{subtitle}</span>}
      </div>
      {children}
    </section>
  )
}

/** A quieter heading for a group inside a section (Generate / Upscale). */
function SubHead({ label, note }: { label: string; note?: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      {note && <span className="text-[9px] text-slate-600">· {note}</span>}
    </div>
  )
}


/*
 * Which admin-only groups are upscalers rather than generators, so an admin
 * model lands in the sub-section it belongs to instead of a separate Admin
 * block. By group label, plus the two local upscalers that share RunPod's
 * group with a generator (Custom Flux LoRA).
 */
const UPSCALE_GROUP_LABELS = new Set(["Upscalers", "Topaz"])
const UPSCALE_ITEMS = new Set(["Real-ESRGAN (Local)", "DAT-2 (Local)"])
const VIDEO_TOOL_GROUP_LABELS = new Set(["Lipsync", "Video Tools"])

type HomeModel = { name: string; accent: string; group: string; admin: boolean }

/** The model grids' widest column count (min-[2200px]:grid-cols-8). */
const MAX_GRID_COLS = 8
/** The fewest regular cards between two tall ones, so they never sit side by side. */
const TALL_CARD_GAP = 6

/**
 * A wrapping grid of model cards. The long single-file scrolling rows made a
 * wide screen look empty on the right and hid most models off the edge; a
 * grid shows all of them, as many across as the screen takes.
 */
function ModelGrid({ models, kind, cards, isAdmin, costByName, onSelect, onCardMediaChange }: {
  models: HomeModel[]
  kind: "image" | "video" | "audio"
  cards: Record<string, CardMedia>
  isAdmin: boolean
  costByName: Record<string, string>
  onSelect: (name: string) => void
  onCardMediaChange: (key: string, media: CardMedia | null) => void
}) {
  if (models.length === 0) return null
  /*
   * Placing the tall (two-row) cards.
   *
   * Near the end of the list a tall card leaves its second row mostly empty
   * (Pixelcut, then an admin model, came second to last and opened a near-
   * empty extra row), and two tall cards side by side read as one lopsided
   * block (Virtual Try-On and Pixelcut are neighbours in the list). So, in
   * terms of how many regular cards come before each tall one:
   *   - the last tall card has at least a full row of the widest layout
   *     (MAX_GRID_COLS) after it
   *   - any two tall cards have at least TALL_CARD_GAP regular cards between
   * A tall card keeps its own place when that already holds and only moves up
   * when it must. Dense packing fills the space beside each at every width.
   */
  const regular = models.filter(m => !TALL_CARDS.has(`${kind}:${m.name}`))
  const tallCards: { card: HomeModel; before: number }[] = []
  let seen = 0
  for (const m of models) {
    if (TALL_CARDS.has(`${kind}:${m.name}`)) tallCards.push({ card: m, before: seen })
    else seen++
  }
  for (let j = tallCards.length - 1; j >= 0; j--) {
    const limit = j === tallCards.length - 1
      ? regular.length - MAX_GRID_COLS
      : tallCards[j + 1].before - TALL_CARD_GAP
    tallCards[j].before = Math.max(0, Math.min(tallCards[j].before, limit))
  }
  // A short list may not fit both rules; keep the gap going forward as far as it can.
  for (let j = 1; j < tallCards.length; j++) {
    tallCards[j].before = Math.min(regular.length, Math.max(tallCards[j].before, tallCards[j - 1].before + TALL_CARD_GAP))
  }
  const ordered: HomeModel[] = []
  let t = 0
  regular.forEach((m, i) => {
    while (t < tallCards.length && tallCards[t].before === i) ordered.push(tallCards[t++].card)
    ordered.push(m)
  })
  while (t < tallCards.length) ordered.push(tallCards[t++].card)
  return (
    // dense packing: a two-row card leaves no hole beside it
    <div className="grid grid-flow-row-dense grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 min-[2200px]:grid-cols-8 gap-3 2xl:gap-4">
      {ordered.map(m => {
        const tall = TALL_CARDS.has(`${kind}:${m.name}`)
        return (
        <HomeMediaCard
          key={`${kind}:${m.name}`}
          cardKey={`${kind}:${m.name}`}
          title={m.name}
          subtitle={m.group}
          accent={m.accent}
          cost={costByName[m.name]}
          media={cards[`${kind}:${m.name}`]}
          altMedia={cards[`${kind}:${m.name}::alt`]}
          isAdmin={isAdmin}
          badge={m.admin ? <AdminModelBadge /> : undefined}
          onClick={() => onSelect(m.name)}
          onMediaChange={onCardMediaChange}
          tall={tall}
          // Two 4:3 rows are ~2:3 tall. The 2:3 floor keeps a tall card two rows
          // tall even at the end of the grid, where nothing beside it sets the
          // second row's height (that row collapsed and the card came out one
          // row tall); with neighbours, it fills the two rows exactly.
          className={tall ? "row-span-2 aspect-[2/3]" : ""}
          frameAspect={tall ? 3 / 4 : 4 / 3}
          // Audio models: waveform art until a thumbnail is uploaded, and a sample to play
          placeholder={kind === "audio" ? <AudioCardArt seed={m.name} tint={m.accent} /> : undefined}
          // Image and video card art carries the model's name; audio art does not
          nameInArt={kind !== "audio"}
          sampleUrl={kind === "audio" ? cards[`audio:${m.name}::sample`]?.mediaUrl : undefined}
        />
        )
      })}
    </div>
  )
}

/*
 * ── Models pages (2026-10-07) ───────────────────────────────────────────────
 *
 * The home page used to list every image, video and audio model in one long
 * scroll. Each kind now has its own page, reached from a card on the home
 * page: the models grouped by maker, a filter by maker and a search, and a
 * way straight to that kind's feed. They are views of the home page (the
 * cards still open a model in the composer), with their own history entry so
 * Back returns home, and remembered for a reload of this tab.
 */
export type ModelsPageKind = "image" | "video" | "audio"
const HOME_PAGE_KEY = "pv2-home-page"

const MODELS_PAGES: Record<ModelsPageKind, { title: string; feed: string; blurb: string; icon: ReactNode; toolsLabel?: string; toolsNote?: string }> = {
  image: {
    title: "Image Models", feed: "image feed", icon: <ImageIcon size={17} />,
    blurb: "Text to image, edits with references, upscalers and image tools - every image model on the site, by maker.",
    toolsLabel: "Upscale & tools", toolsNote: "enhance · enlarge · restore",
  },
  video: {
    title: "Video Models", feed: "video feed", icon: <Video size={17} />,
    blurb: "Text and image to video, references, start and end frames, native sound - plus the clip tools: lip sync, upscale, extend, restore.",
    toolsLabel: "Clip tools", toolsNote: "lip sync · upscale · restore",
  },
  audio: {
    title: "Audio Models", feed: "audio feed", icon: <Music size={17} />,
    blurb: "Voices, music, sound effects and audio tools. Tap a card's play button to hear a sample.",
  },
}

/** One maker's models, in list order. */
type MakerGroup = { label: string; accent: string; models: HomeModel[] }
function byMaker(models: HomeModel[]): MakerGroup[] {
  const out: MakerGroup[] = []
  for (const m of models) {
    const g = out.find(x => x.label === m.group)
    if (g) g.models.push(m)
    else out.push({ label: m.group, accent: m.accent, models: [m] })
  }
  return out
}

/** A still for a model card: its picture, or its alternate when the picture is the video. */
function cardStill(cards: Record<string, CardMedia>, key: string): string | null {
  const a = cards[key], b = cards[`${key}::alt`]
  if (a?.mediaType === "image" && a.mediaUrl) return a.mediaUrl
  if (b?.mediaType === "image" && b.mediaUrl) return b.mediaUrl
  return null
}

/**
 * The home page's door to a models page: a mosaic of that kind's own cards, a
 * search that opens a model straight from here, and links to the page and the feed.
 *
 * The mosaic's tiles keep the card art's own 4:3, so the lettering is never
 * cut (they were cropped from a fixed 16:10 box, which on a narrow card left
 * slivers). Phones stack the card; a tablet (md-lg, iPad portrait) lays it
 * sideways - the three sit one per row there; three across from lg.
 */
function ModelsHubCard({ kind, models, cards, costByName, onOpen, onFeed, onPick }: {
  kind: ModelsPageKind
  models: HomeModel[]
  cards: Record<string, CardMedia>
  costByName: Record<string, string>
  onOpen: () => void
  onFeed?: () => void
  /** Open this model in its feed. */
  onPick: (name: string) => void
}) {
  const meta = MODELS_PAGES[kind]
  const [q, setQ] = useState("")
  const stills = models.map(m => cardStill(cards, `${kind}:${m.name}`)).filter((u): u is string => !!u).slice(0, 6)
  const makers = new Set(models.map(m => m.group)).size
  const needle = q.trim().toLowerCase()
  const hits = needle
    ? models.filter(m => m.name.toLowerCase().includes(needle) || m.group.toLowerCase().includes(needle))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)))
    : []
  return (
    <div
      onClick={onOpen}
      className="group relative isolate flex flex-col md:max-lg:flex-row cursor-pointer overflow-hidden rounded-3xl border border-white/10 bg-[#070b14] silver-edge transition-all duration-300 hover:border-white/25 hover:shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)]"
    >
      <div className="relative shrink-0 overflow-hidden md:max-lg:w-[50%] md:max-lg:self-center">
        <div className="grid grid-cols-3 gap-px bg-black transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03]">
          {stills.length >= 3
            ? Array.from({ length: 6 }, (_, i) => stills[i % stills.length]).map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={u} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover" />
              ))
            : models.slice(0, 6).map(m => (
                <div key={m.name} className="relative aspect-[4/3] overflow-hidden"><AudioCardArt seed={m.name} tint={m.accent} /></div>
              ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#070b14]/90 via-transparent to-transparent md:max-lg:bg-gradient-to-l md:max-lg:from-[#070b14]/70" />
        <span className="absolute top-3 left-3 flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-black/60 text-slate-200">{meta.icon}</span>
      </div>

      <div className="relative flex flex-1 flex-col gap-2 p-4 sm:p-5">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400">{models.length} models · {makers} makers</div>
        <h3 className="text-xl sm:text-2xl font-black tracking-tight silver-shimmer-text">{meta.title}</h3>

        {/* Search: a model opens straight in its feed. Clicks here stay off the card. */}
        <div onClick={e => e.stopPropagation()} className="cursor-default">
          <label className="relative flex items-center">
            <Search size={13} className="absolute left-2.5 text-slate-500 pointer-events-none" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && hits[0]) onPick(hits[0].name); if (e.key === "Escape") setQ("") }}
              placeholder={`Search ${models.length} ${kind} models`}
              aria-label={`Search ${kind} models`}
              className="w-full pl-8 pr-8 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-white/35 text-[12.5px] text-white placeholder:text-slate-600 focus:outline-none"
            />
            {q && <button onClick={() => setQ("")} className="absolute right-2.5 text-slate-500 hover:text-white" aria-label="Clear search"><X size={13} /></button>}
          </label>
          {needle && (
            <div className="mt-1.5 rounded-xl border border-white/10 bg-black/50 overflow-hidden">
              {hits.length === 0 ? (
                <p className="px-3 py-2.5 text-[12px] text-slate-500">No {kind} model matches &ldquo;{q.trim()}&rdquo;</p>
              ) : (
                <>
                  {hits.slice(0, 6).map(m => {
                    const still = cardStill(cards, `${kind}:${m.name}`)
                    return (
                      <button
                        key={m.name}
                        onClick={() => onPick(m.name)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-white/[0.07] transition-colors"
                      >
                        {still
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={still} alt="" className="w-10 h-[30px] rounded-md object-cover shrink-0" />
                          : <span className="w-10 h-[30px] rounded-md bg-white/[0.05] shrink-0" />}
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-[12.5px] font-semibold text-slate-100">{m.name}</span>
                          <span className={`block truncate text-[10.5px] ${m.accent}`}>{m.group}</span>
                        </span>
                        {costByName[m.name] && <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-black/60 border border-white/15 text-[10px] font-mono text-slate-300">{costByName[m.name]}</span>}
                        <ArrowRight size={12} className="shrink-0 text-slate-500" />
                      </button>
                    )
                  })}
                  {hits.length > 6 && (
                    <button onClick={onOpen} className="w-full px-3 py-2 text-left text-[11.5px] font-semibold text-slate-400 hover:text-white border-t border-white/[0.06]">
                      {hits.length - 6} more on the {meta.title} page →
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {!needle && <p className="text-[12.5px] leading-relaxed text-slate-400 line-clamp-2">{meta.blurb}</p>}
        <div className="mt-auto pt-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/[0.10] px-3.5 py-2 text-[12px] font-bold text-white group-hover:bg-white/[0.16]">
            Browse models <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
          </span>
          {onFeed && (
            <button
              onClick={e => { e.stopPropagation(); onFeed() }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] font-semibold text-slate-300 hover:text-white hover:border-white/30"
            >
              <LayoutGrid size={12} /> Open the {meta.feed}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** One models page: by maker, a maker filter and a search, the generators then the tools. */
function ModelsPage({ kind, main, tools, cards, isAdmin, costByName, onSelect, onCardMediaChange, onBack, onFeed }: {
  kind: ModelsPageKind
  main: HomeModel[]
  tools: HomeModel[]
  cards: Record<string, CardMedia>
  isAdmin: boolean
  costByName: Record<string, string>
  onSelect: (name: string) => void
  onCardMediaChange: (key: string, media: CardMedia | null) => void
  onBack: () => void
  onFeed?: () => void
}) {
  const meta = MODELS_PAGES[kind]
  const [maker, setMaker] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const all = [...main, ...tools]
  const makers = byMaker(all).map(g => ({ label: g.label, count: g.models.length }))
  const needle = q.trim().toLowerCase()
  const keep = (m: HomeModel) => (!maker || m.group === maker) && (!needle || m.name.toLowerCase().includes(needle) || m.group.toLowerCase().includes(needle))
  const mainGroups = byMaker(main.filter(keep))
  const toolModels = tools.filter(keep)
  const shown = mainGroups.reduce((n, g) => n + g.models.length, 0) + toolModels.length
  const grid = (models: HomeModel[]) => (
    <ModelGrid models={models} kind={kind} cards={cards} isAdmin={isAdmin} costByName={costByName} onSelect={onSelect} onCardMediaChange={onCardMediaChange} />
  )
  return (
    <div className="w-full max-w-[2560px] mx-auto py-5 pb-32 px-[var(--home-gutter)] [--home-gutter:1rem] sm:[--home-gutter:1.5rem] lg:[--home-gutter:2rem] 2xl:[--home-gutter:3rem]">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 mb-5">
        <div className="min-w-0 mr-auto">
          <button onClick={onBack} className="mb-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-[12px] font-semibold text-slate-400 hover:text-white hover:bg-white/5">
            <ArrowLeft size={13} /> Home
          </button>
          <h1 className="text-3xl sm:text-4xl xl:text-5xl font-black tracking-tight leading-none silver-shimmer-text">{meta.title}</h1>
          <p className="mt-2 max-w-2xl text-[13px] sm:text-sm leading-relaxed text-slate-400">{meta.blurb}</p>
        </div>
        {onFeed && (
          <button
            onClick={onFeed}
            className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/[0.10] px-4 py-2.5 text-[13px] font-bold text-white hover:bg-white/[0.16] hover:border-white/40"
          >
            <LayoutGrid size={14} /> Open the {meta.feed} <ArrowRight size={14} />
          </button>
        )}
      </div>

      {/* Filter: maker chips and a search, pinned while scrolling */}
      <div className="sticky top-0 z-20 -mx-[var(--home-gutter)] px-[var(--home-gutter)] py-2.5 mb-5 bg-[#05080f]/90 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex items-center">
            <Search size={13} className="absolute left-2.5 text-slate-500 pointer-events-none" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={`Search ${all.length} models`}
              className="w-44 sm:w-56 pl-8 pr-7 py-1.5 rounded-lg bg-black/40 border border-white/10 focus:border-white/30 text-[12.5px] text-white placeholder:text-slate-600 focus:outline-none"
            />
            {q && <button onClick={() => setQ("")} className="absolute right-2 text-slate-500 hover:text-white" aria-label="Clear search"><X size={12} /></button>}
          </label>
          <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setMaker(null)}
              className={`shrink-0 px-2.5 py-1 rounded-full border text-[11.5px] font-semibold transition-colors ${maker === null ? "border-white/40 bg-white/[0.14] text-white" : "border-white/10 text-slate-400 hover:text-white hover:border-white/25"}`}
            >
              All <span className="font-mono text-slate-400">{all.length}</span>
            </button>
            {makers.map(m => (
              <button
                key={m.label}
                onClick={() => setMaker(maker === m.label ? null : m.label)}
                className={`shrink-0 px-2.5 py-1 rounded-full border text-[11.5px] font-semibold transition-colors ${maker === m.label ? "border-white/40 bg-white/[0.14] text-white" : "border-white/10 text-slate-400 hover:text-white hover:border-white/25"}`}
              >
                {m.label} <span className="font-mono text-slate-500">{m.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown === 0 ? (
        <p className="py-20 text-center text-sm text-slate-500">No models match{needle ? ` "${q.trim()}"` : ""}{maker ? ` in ${maker}` : ""}.</p>
      ) : (
        <>
          {mainGroups.map(g => (
            <section key={g.label} className="mb-7">
              <div className="flex items-center gap-2 mb-2.5">
                <h2 className={`text-[13px] font-black tracking-tight ${g.accent}`}>{g.label}</h2>
                <span className="text-[10px] font-mono text-slate-600">{g.models.length}</span>
                <span className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent" />
              </div>
              {grid(g.models)}
            </section>
          ))}
          {toolModels.length > 0 && (
            <section className="mb-7">
              <div className="flex items-center gap-2 mb-2.5">
                <h2 className="text-[13px] font-black tracking-tight text-slate-200">{meta.toolsLabel ?? "Tools"}</h2>
                {meta.toolsNote && <span className="text-[10px] text-slate-600">· {meta.toolsNote}</span>}
                <span className="text-[10px] font-mono text-slate-600">{toolModels.length}</span>
                <span className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent" />
              </div>
              {grid(toolModels)}
            </section>
          )}
        </>
      )}
    </div>
  )
}

export function HomeView({
  isAdmin,
  signedIn,
  imageGroups,
  imageSections = [],
  adminImageGroups = [],
  imageUpscaleNames = [],
  videoGroups,
  videoToolNames = [],
  adminVideoGroups = [],
  imageCostByName = {},
  videoCostByName = {},
  audioGroups = [],
  audioCostByName = {},
  onSelectAudioModel,
  cards,
  onSelectImageModel,
  onSelectVideoModel,
  onGoChat,
  onGoEmployee,
  onGoThreeD,
  onOpenFrames,
  onCardMediaChange,
  onGoFeed,
}: {
  isAdmin: boolean
  signedIn: boolean
  imageGroups: ModelGroup[]
  imageSections?: ModelSection[]
  adminImageGroups?: ModelGroup[]
  /**
   * Models that belong in the Upscale / Tools sub-sections whatever company
   * group the picker files them under. The picker stopped keeping tools in
   * their own groups (2026-10-02: each sits with its maker), so the home page
   * can no longer tell a tool by its group's label alone.
   */
  imageUpscaleNames?: string[]
  videoToolNames?: string[]
  videoGroups: ModelGroup[]
  adminVideoGroups?: ModelGroup[]
  imageCostByName?: Record<string, string>
  videoCostByName?: Record<string, string>
  /** Audio Studio models (public since 2026-10-02). */
  audioGroups?: (ModelGroup & { note?: string })[]
  audioCostByName?: Record<string, string>
  onSelectAudioModel?: (name: string) => void
  cards: Record<string, CardMedia>
  onSelectImageModel: (name: string) => void
  onSelectVideoModel: (name: string) => void
  onGoChat: () => void
  onGoEmployee: (id: import("@/lib/employees").EmployeeId) => void
  onGoThreeD: () => void
  onOpenFrames: () => void
  onCardMediaChange: (key: string, media: CardMedia | null) => void
  /** Straight to a kind's feed (the portal's image / video / audio view). */
  onGoFeed?: (kind: ModelsPageKind) => void
}) {
  // Which page of the home view: the home page itself, or a models page.
  // Its own history entry (Back returns home) and remembered for a reload.
  const [page, setPageState] = useState<"home" | ModelsPageKind>("home")
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(HOME_PAGE_KEY)
      if (saved === "image" || saved === "video" || saved === "audio") setPageState(saved)
    } catch {}
    const onPop = (e: PopStateEvent) => {
      const p = e.state?.homePage
      setPageState(p === "image" || p === "video" || p === "audio" ? p : "home")
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  const openPage = (p: "home" | ModelsPageKind) => {
    try {
      if (p === "home") sessionStorage.removeItem(HOME_PAGE_KEY)
      else sessionStorage.setItem(HOME_PAGE_KEY, p)
    } catch {}
    if (p === "home" && window.history.state?.homePage) {
      window.history.back() // the models page's own entry - Back and this agree
      return
    }
    if (p !== "home") {
      try { window.history.pushState({ ...window.history.state, homePage: p }, "") } catch {}
    }
    setPageState(p)
    window.scrollTo({ top: 0 })
  }
  // A feed opened from a models page should not come back to it on the next visit home
  const goFeed = onGoFeed ? (kind: ModelsPageKind) => {
    try { sessionStorage.removeItem(HOME_PAGE_KEY) } catch {}
    onGoFeed(kind)
  } : undefined

  const flatten = (groups: ModelGroup[], admin: boolean): HomeModel[] =>
    groups.flatMap(g => g.items.map(name => ({ name, accent: g.accent, group: g.label, admin })))

  /*
   * Admin models sit in the sub-section they belong to, badged, instead of a
   * separate Admin block at the bottom. Non-admins never receive them.
   */
  const adminImage = isAdmin ? adminImageGroups : []
  const adminVideo = isAdmin ? adminVideoGroups : []
  const isUpscaleGroup = (g: ModelGroup) => UPSCALE_GROUP_LABELS.has(g.label)
  const upscaleNames = new Set(imageUpscaleNames)
  const toolNames = new Set(videoToolNames)
  const imageGenerate = [
    ...reorder(flatten(imageGroups, false), HOME_IMAGE_ORDER).filter(m => !upscaleNames.has(m.name)),
    ...flatten(adminImage.filter(g => !isUpscaleGroup(g)), true).filter(m => !UPSCALE_ITEMS.has(m.name)),
  ]
  const imageUpscale = [
    ...flatten(imageGroups, false).filter(m => upscaleNames.has(m.name)),
    ...imageSections.flatMap(sec => flatten(sec.groups, false)),
    ...flatten(adminImage.filter(isUpscaleGroup), true),
    ...flatten(adminImage.filter(g => !isUpscaleGroup(g)), true).filter(m => UPSCALE_ITEMS.has(m.name)),
  ]
  const isTool = (m: HomeModel) => VIDEO_TOOL_GROUP_LABELS.has(m.group) || toolNames.has(m.name)
  const videoGenerate = [
    ...reorder(flatten(videoGroups, false), HOME_VIDEO_ORDER).filter(m => !isTool(m)),
    ...flatten(adminVideo, true).filter(m => !isTool(m)),
  ]
  const videoTools = [
    ...flatten(videoGroups, false).filter(isTool),
    ...flatten(adminVideo, true).filter(isTool),
  ]

  // Featured: only what this account can open, in the order listed.
  const allImage = [...imageGenerate, ...imageUpscale]
  const allVideo = [...videoGenerate, ...videoTools]
  const featured = FEATURED_MODELS
    .map(f => {
      const m = (f.kind === "image" ? allImage : allVideo).find(x => x.name === f.name)
      return m ? { ...m, kind: f.kind } : null
    })
    .filter((m): m is HomeModel & { kind: "image" | "video" } => !!m)

  /*
   * Studios: Storyboard Studio is the one being released, so it gets the
   * section to itself as a feature panel; the rest wait in Admin Tools until
   * their turn (they are admin-only either way).
   */
  const featuredStudio = SITE_EMPLOYEES.find(e => e.id === "storyboard" && employeeVisibleTo(e.id, isAdmin))
  // The Frame Extractor is public (2026-10-07): it has its own panel in the
  // Studios section, for everyone
  const frameTool = SITE_EMPLOYEES.find(e => e.id === "frames" && employeeVisibleTo(e.id, isAdmin))
  // The Lab's studios (Movie Studio, Face Swap, Character Design) are not listed here
  const otherStudios = SITE_EMPLOYEES.filter(e => e.id !== "storyboard" && e.id !== "frames" && !isLabStudio(e.id) && employeeVisibleTo(e.id, isAdmin))

  const audioModels = audioGroups.flatMap(g => g.items.map(name => ({ name, accent: g.accent, group: g.label, admin: false })))

  /*
   * Featured layout: each card's spot at every breakpoint, worked out once
   * (packFeatured) and handed to CSS as variables - --c4/--r4 for the phone's
   * 4-unit grid, --c6/--r6 for sm, --c8/--r8 for md, --c12/--r12 for lg+ (see
   * .feat-grid in globals.css). The "All models" tiles that close the grid get
   * --dN: none at the widths that don't need them. A width that fails to pack
   * falls back to each card's span under dense auto-placement.
   */
  const featuredKinds: ModelsPageKind[] = ["image", "video", ...(onSelectAudioModel && audioModels.length > 0 ? ["audio" as const] : [])]
  const featuredSig = featured.map(m => `${m.kind}:${m.name}`).join("|") + `#${featuredKinds.length}`
  const featuredLayout = useMemo(() => {
    const sizes = featuredSig.split("#")[0].split("|").filter(Boolean).map(featuredSize)
    const cardVars: Record<string, string>[] = sizes.map(() => ({}))
    const tileVars: Record<string, string>[] = featuredKinds.map(() => ({}))
    const put = (v: Record<string, string>, n: number, cell: FeaturedCell) => {
      v[`--c${n}`] = `${cell.col} / span ${cell.w}`
      v[`--r${n}`] = `${cell.row} / span ${cell.h}`
    }
    for (const n of FEATURED_COLUMNS) {
      const res = packFeatured(sizes, featuredKinds.length, n)
      if (res) {
        res.cards.forEach((cell, i) => put(cardVars[i], n, cell))
        res.tiles.forEach((cell, i) => { if (cell) put(tileVars[i], n, cell); else tileVars[i][`--d${n}`] = "none" })
      } else {
        // Auto-placement: spans only (a small card's 2x2 by default)
        sizes.forEach((sz, i) => {
          const [w, h] = sz === "big" ? [4, 4] : sz === "tall" ? [2, 4] : sz === "medium" ? (n <= 4 ? [4, 4] : [3, 3]) : [2, 2]
          cardVars[i][`--c${n}`] = `span ${w}`
          cardVars[i][`--r${n}`] = `span ${h}`
        })
        tileVars.forEach((v, i) => { if (i < 2) { v[`--c${n}`] = "span 2"; v[`--r${n}`] = "span 2" } else v[`--d${n}`] = "none" })
      }
    }
    return { cardVars, tileVars }
    // featuredKinds is folded into featuredSig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredSig])
  // Picking a model leaves the models page behind: Home next time is the home page
  const leaving = (fn: (name: string) => void) => (name: string) => {
    try { sessionStorage.removeItem(HOME_PAGE_KEY) } catch {}
    fn(name)
  }
  if (page === "image") {
    return <ModelsPage kind="image" main={imageGenerate} tools={imageUpscale} cards={cards} isAdmin={isAdmin} costByName={imageCostByName}
      onSelect={leaving(onSelectImageModel)} onCardMediaChange={onCardMediaChange} onBack={() => openPage("home")} onFeed={goFeed ? () => goFeed("image") : undefined} />
  }
  if (page === "video") {
    return <ModelsPage kind="video" main={videoGenerate} tools={videoTools} cards={cards} isAdmin={isAdmin} costByName={videoCostByName}
      onSelect={leaving(onSelectVideoModel)} onCardMediaChange={onCardMediaChange} onBack={() => openPage("home")} onFeed={goFeed ? () => goFeed("video") : undefined} />
  }
  if (page === "audio" && onSelectAudioModel) {
    return <ModelsPage kind="audio" main={audioModels} tools={[]} cards={cards} isAdmin={isAdmin} costByName={audioCostByName}
      onSelect={leaving(onSelectAudioModel)} onCardMediaChange={onCardMediaChange} onBack={() => openPage("home")} onFeed={goFeed ? () => goFeed("audio") : undefined} />
  }

  return (
    /*
     * Full width, to a 2560px cap for ultrawides, with a gutter that grows
     * with the screen.
     */
    <div className="w-full max-w-[2560px] mx-auto py-6 pb-32 px-[var(--home-gutter)] [--home-gutter:1rem] sm:[--home-gutter:1.5rem] lg:[--home-gutter:2rem] 2xl:[--home-gutter:3rem]">
      {/*
        TOP ROW - the shop and the library, side by side. The library was a
        full-width banner that stretched 600px thumbnails across the whole
        screen, which is why it looked soft; as a third of the row it shows
        them near their real size and gives the space back to the models.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 2xl:gap-6 mb-8 sm:mb-10">
        <HomeMediaCard
          cardKey="shop:tickets"
          title="Buy Tickets"
          subtitle="Top up your balance"
          accent="text-cyan-300"
          media={cards["shop:tickets"]}
          altMedia={cards["shop:tickets::alt"]}
          isAdmin={isAdmin}
          href="/buy-tickets"
          onMediaChange={onCardMediaChange}
          aspect="aspect-video"
          frameAspect={16 / 9}
        />
        <HomeMediaCard
          cardKey="shop:subscriptions"
          title="Subscriptions"
          subtitle="Save with a monthly plan"
          accent="text-fuchsia-300"
          media={cards["shop:subscriptions"]}
          altMedia={cards["shop:subscriptions::alt"]}
          isAdmin={isAdmin}
          href="/prompting-studio/subscribe"
          onMediaChange={onCardMediaChange}
          aspect="aspect-video"
          frameAspect={16 / 9}
        />
        {/* Spans the row on a tablet, where the shop cards take two columns. */}
        <GenerationsCarousel signedIn={signedIn} className="sm:col-span-2 lg:col-span-1" aspect="aspect-video sm:aspect-[21/9] lg:aspect-video" />
      </div>

      {/*
        FEATURED - shortcuts to the top models, so nobody has to open a models
        page for them. Four sizes on a grid of half-card units (featured.ts):
        the headline models big, the next tier medium, the portrait cards tall
        and the rest small, closed off by tiles into the Image / Video / Audio
        Models pages. Where each lands at each width is packed in code
        (featuredLayout above), so no width shows a hole.
      */}
      {featured.length > 0 && (
        <Section icon={<Star size={17} />} title="Featured Models" subtitle="Shortcuts · tap one to start">
          <div className="feat-grid">
            <div className="feat-inner">
              {featured.map((m, i) => {
                const key = `${m.kind}:${m.name}`
                return (
                  <div key={`featured:${key}`} className="feat-cell" style={featuredLayout.cardVars[i] as CSSProperties}>
                    <HomeMediaCard
                      cardKey={key}
                      title={m.name}
                      subtitle={`${m.group} · ${m.kind === "image" ? "image" : "video"}`}
                      accent={m.accent}
                      cost={(m.kind === "image" ? imageCostByName : videoCostByName)[m.name]}
                      media={cards[key]}
                      altMedia={cards[`${key}::alt`]}
                      isAdmin={isAdmin}
                      badge={m.admin ? <AdminModelBadge /> : undefined}
                      onClick={() => (m.kind === "image" ? onSelectImageModel : onSelectVideoModel)(m.name)}
                      onMediaChange={onCardMediaChange}
                      // The cell sets the size: big, medium and small are 4:3,
                      // tall about 2:3 (its 3:4 art loses a sliver at each side)
                      aspect="h-full w-full"
                      frameAspect={TALL_CARDS.has(key) ? 3 / 4 : 4 / 3}
                      nameInArt
                    />
                  </div>
                )
              })}
              {/* The tiles that close the grid: the way into each models page */}
              {featuredKinds.map((k, i) => (
                <div key={`all-${k}`} className="feat-cell" style={featuredLayout.tileVars[i] as CSSProperties}>
                <button
                  onClick={() => openPage(k)}
                  className="h-full w-full group relative isolate overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-black/40 silver-edge flex flex-col items-start justify-end gap-1 p-3 sm:p-4 text-left transition-all hover:border-white/30"
                >
                  <span className="absolute top-3 left-3 flex h-8 w-8 items-center justify-center rounded-xl border border-white/15 bg-black/40 text-slate-200">
                    {k === "image" ? <ImageIcon size={15} /> : k === "video" ? <Video size={15} /> : <Music size={15} />}
                  </span>
                  <span className="text-[9.5px] font-mono uppercase tracking-[0.18em] text-slate-500">
                    {k === "image" ? imageGenerate.length + imageUpscale.length : k === "video" ? videoGenerate.length + videoTools.length : audioModels.length} models
                  </span>
                  <span className="flex items-center gap-1.5 text-sm sm:text-base font-black tracking-tight text-white">
                    All {k} models <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      {/*
        STUDIOS - Storyboard Studio on its own, as a feature panel: the big
        card (its title art, then the explainer video in its turn of the
        page-wide cycle) beside what it does in three steps. Shows for
        everyone once released; admins only (badged) until then.
      */}
      {(featuredStudio || frameTool) && (
        <Section icon={<Wand2 size={17} />} title="Studios" subtitle="Guided workspaces">
          {featuredStudio && (
          <div className="relative isolate overflow-hidden rounded-3xl border border-sky-400/20 bg-gradient-to-br from-sky-500/[0.07] via-white/[0.02] to-amber-400/[0.05] p-3 sm:p-4 lg:p-5">
            <div className="grid gap-4 lg:gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] items-center">
              <HomeMediaCard
                cardKey={`studio:${featuredStudio.id}`}
                title={featuredStudio.name}
                subtitle={featuredStudio.tagline}
                media={cards[`studio:${featuredStudio.id}`]}
                altMedia={cards[`studio:${featuredStudio.id}::alt`]}
                isAdmin={isAdmin}
                badge={EMPLOYEE_ADMIN_ONLY[featuredStudio.id] ? <AdminModelBadge /> : undefined}
                onClick={() => onGoEmployee(featuredStudio.id)}
                onMediaChange={onCardMediaChange}
                className="w-full max-w-[1100px] justify-self-center"
              />
              <div className="flex flex-col gap-4 2xl:gap-5 px-1 sm:px-2 lg:py-2 max-w-[720px]">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-sky-300/90">Plan · Shoot · Final Cut</p>
                  <h3 className="mt-1.5 text-2xl sm:text-3xl xl:text-4xl 2xl:text-5xl font-black tracking-tight text-white">{featuredStudio.name}</h3>
                  <p className="mt-2 text-sm xl:text-base 2xl:text-lg leading-relaxed text-slate-300">
                    Turn one idea into a finished film. Describe it once - the studio plans every shot, makes each still with the right model, brings it to life and cuts the movie for you.
                  </p>
                </div>
                <ol className="flex flex-col gap-2.5">
                  {[
                    { icon: <Sparkles size={15} />, title: "Plan", text: "The AI writes the story, the shots and a still for each one, choosing the best image model for every frame." },
                    { icon: <Clapperboard size={15} />, title: "Shoot", text: "Every still is animated by the video model that suits it - Veo, Kling, SeeDance, Hailuo and more." },
                    { icon: <Film size={15} />, title: "Final Cut", text: "One click trims the shots, scores the music and narrates the finished film." },
                  ].map((s, i) => (
                    <li key={s.title} className="flex gap-3 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-400/15 text-sky-200">{s.icon}</span>
                      <span className="min-w-0">
                        <span className="block text-[13px] 2xl:text-[15px] font-bold text-white"><span className="text-sky-300/80 font-mono mr-1.5">{i + 1}</span>{s.title}</span>
                        <span className="block text-[12px] 2xl:text-[13.5px] leading-snug text-slate-400">{s.text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-1.5">
                  {[`${STORYBOARD_IMAGE_MODELS.length} image models`, `${STORYBOARD_VIDEO_MODELS.length} video models`, `${BOARD_MODES.length} kinds of film`, "Music & narration"].map(t => (
                    <span key={t} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-300">{t}</span>
                  ))}
                </div>
                <button
                  onClick={() => onGoEmployee(featuredStudio.id)}
                  className="self-start inline-flex items-center gap-2 rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-[0_0_24px_-6px_rgba(56,189,248,0.7)] transition-colors hover:bg-sky-300"
                >
                  Open {featuredStudio.name} <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </div>
          )}

          {/*
            FRAME EXTRACTOR - public. A tool rather than a studio, so a
            slimmer panel: its card beside the three steps and one button.
            Mirrored (words left, card right) so it doesn't echo the panel above.
          */}
          {frameTool && (
            <div className={`relative isolate overflow-hidden rounded-3xl border border-amber-300/20 bg-gradient-to-br from-amber-400/[0.06] via-white/[0.02] to-slate-400/[0.05] p-3 sm:p-4 lg:p-5 ${featuredStudio ? "mt-4 sm:mt-5" : ""}`}>
              <div className="grid gap-4 lg:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center">
                <div className="order-2 lg:order-1 flex flex-col gap-4 2xl:gap-5 px-1 sm:px-2 lg:py-2 max-w-[720px]">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-amber-200/90">Upload · Rank · Keep the best</p>
                    <h3 className="mt-1.5 text-2xl sm:text-3xl xl:text-4xl font-black tracking-tight text-white">{frameTool.name}</h3>
                    <p className="mt-2 text-sm xl:text-base leading-relaxed text-slate-300">{frameTool.blurb}</p>
                  </div>
                  <ol className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3">
                    {[
                      { icon: <Film size={15} />, title: "Drop in a video", text: "MP4, MOV, WebM or a GIF - up to two minutes in total." },
                      { icon: <ScanSearch size={15} />, title: "Every frame, ranked", text: "Sharpest first, with motion blur flagged - or cut it into clips and GIFs." },
                      { icon: <Images size={15} />, title: "Keep the best", text: "Send picks to your references, edit them, or download a ZIP." },
                    ].map((st, i) => (
                      <li key={st.title} className="flex gap-3 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-300/15 text-amber-100">{st.icon}</span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-bold text-white"><span className="text-amber-200/80 font-mono mr-1.5">{i + 1}</span>{st.title}</span>
                          <span className="block text-[12px] leading-snug text-slate-400">{st.text}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <button
                    onClick={onOpenFrames}
                    className="self-start inline-flex items-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-[0_0_24px_-6px_rgba(252,211,77,0.6)] transition-colors hover:bg-amber-200"
                  >
                    {frameTool.cta ?? `Open ${frameTool.name}`} <ArrowRight size={15} />
                  </button>
                </div>
                <HomeMediaCard
                  cardKey={`studio:${frameTool.id}`}
                  title={frameTool.name}
                  subtitle={frameTool.tagline}
                  media={cards[`studio:${frameTool.id}`]}
                  altMedia={cards[`studio:${frameTool.id}::alt`]}
                  isAdmin={isAdmin}
                  badge={EMPLOYEE_ADMIN_ONLY[frameTool.id] ? <AdminModelBadge /> : undefined}
                  onClick={onOpenFrames}
                  onMediaChange={onCardMediaChange}
                  className="order-1 lg:order-2 w-full max-w-[1000px] justify-self-center"
                />
              </div>
            </div>
          )}
        </Section>
      )}

      {/*
        MODELS - one card per kind, each opening its own page (by maker, with
        a filter and a search). The full lists used to be here, one long scroll.
      */}
      <Section icon={<LayoutGrid size={17} />} title="Models" subtitle="Image · video · audio">
        <div className="grid gap-3 sm:gap-4 2xl:gap-6 lg:grid-cols-3">
          <ModelsHubCard kind="image" models={[...imageGenerate, ...imageUpscale]} cards={cards} costByName={imageCostByName}
            onOpen={() => openPage("image")} onFeed={goFeed ? () => goFeed("image") : undefined} onPick={leaving(onSelectImageModel)} />
          <ModelsHubCard kind="video" models={[...videoGenerate, ...videoTools]} cards={cards} costByName={videoCostByName}
            onOpen={() => openPage("video")} onFeed={goFeed ? () => goFeed("video") : undefined} onPick={leaving(onSelectVideoModel)} />
          {onSelectAudioModel && audioModels.length > 0 && (
            <ModelsHubCard kind="audio" models={audioModels} cards={cards} costByName={audioCostByName}
              onOpen={() => openPage("audio")} onFeed={goFeed ? () => goFeed("audio") : undefined} onPick={leaving(onSelectAudioModel)} />
          )}
        </div>
      </Section>

      {/* Content policy notice (CCBill) - shared with the dashboard. */}
      <ProhibitedContentNotice className="mb-8" />

      {/* ADMIN TOOLS - the studios not released yet, and the tools that are
          not models. */}
      {isAdmin && (
        <Section icon={<Shield size={17} />} title="Admin Tools" subtitle="Admin only">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 2xl:gap-4">
            {/* The studios that are not released yet wait here for their turn */}
            {otherStudios.map(emp => (
              <HomeMediaCard
                key={emp.id}
                cardKey={`studio:${emp.id}`}
                title={emp.name}
                subtitle={emp.tagline}
                media={cards[`studio:${emp.id}`]}
                altMedia={cards[`studio:${emp.id}::alt`]}
                isAdmin={isAdmin}
                badge={<AdminModelBadge />}
                onClick={() => emp.opensOverlay ? onOpenFrames()
                  : emp.id === "3d-studio" ? onGoThreeD()
                  : onGoEmployee(emp.id)}
                onMediaChange={onCardMediaChange}
              />
            ))}
            <HomeMediaCard
              cardKey="admin:chat"
              title="AI Chat Hub"
              subtitle="Multi-provider chat"
              accent="text-violet-300"
              media={cards["admin:chat"]}
              isAdmin={isAdmin}
              badge={<AdminModelBadge />}
              onClick={onGoChat}
              onMediaChange={onCardMediaChange}
            />
          </div>
        </Section>
      )}
    </div>
  )
}
