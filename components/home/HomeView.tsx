"use client"

import type { ReactNode } from "react"
import { Image as ImageIcon, Video, Shield, Wand2, Star, Music, Clapperboard, Film, Sparkles, ArrowRight } from "lucide-react"
import { HomeMediaCard, type CardMedia } from "./HomeMediaCard"
import { AudioCardArt } from "./AudioCardArt"
import { GenerationsCarousel } from "./GenerationsCarousel"
import { FEATURED_MODELS, TALL_CARDS } from "./featured"
import { ProhibitedContentNotice } from "@/components/ProhibitedContentNotice"
import { SITE_EMPLOYEES, AdminModelBadge } from "@/components/employees/EmployeesView"
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
const HOME_IMAGE_ORDER = ["NanoBanana Pro 2", "ChatGPT Images 2.5", "ChatGPT Images 2.0", "Kling O3", "SeeDream 5.0 Pro", "Recraft v4.1", "SeeDream 4.5", "Wan 2.7 Pro", "SeeDream 5.0 Lite"]
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
          sampleUrl={kind === "audio" ? cards[`audio:${m.name}::sample`]?.mediaUrl : undefined}
        />
        )
      })}
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
}) {
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
  const otherStudios = SITE_EMPLOYEES.filter(e => e.id !== "storyboard" && employeeVisibleTo(e.id, isAdmin))

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
        FEATURED - the top models, before the full lists. A lead card and four
        around it on a wide screen; the lead spans the row on a phone.
        Each card shares its thumbnail with the same model's card below, so
        one upload covers both.

        A portrait card (Virtual Try-On) gets its own column spanning both
        rows, between the lead and the 2x2 block. That column is 0.84 of a
        small card's width: two 16:9 rows plus the gap are ~1.13 widths tall,
        so 0.84 of a width across comes out at ~3:4 and its video is barely
        cropped. On a phone it sits beside two of the small cards.
      */}
      {featured.length > 0 && (() => {
        const isTall = (m: { kind: string; name: string }) => TALL_CARDS.has(`${m.kind}:${m.name}`)
        const [lead, ...rest] = featured
        const talls = rest.filter(isTall)
        const regs = rest.filter(m => !isTall(m))
        /*
         * The gallery band (a lead, three portrait cards, four regular ones)
         * is laid out three ways. The row heights always come from the small
         * cards' aspect ratio and everything else fills its cell (h-full,
         * md:min-h-0 on the portraits), so no cell is ever taller than the
         * card in it.
         *   xl     one band two rows tall, portraits and pairs alternating -
         *          lead | tall | pair | tall | pair | tall. A pair is two 16:9
         *          cards stacked, so the band is 1.125 of a pair's width tall
         *          (plus the gap); a 0.84 column at that height is ~3:4, and
         *          the lead's 1.5 column makes it ~4:3.
         *   md-lg  (iPad portrait, small laptops) six columns would make the
         *          small cards ~140px wide, so the band splits in two, each a
         *          full-width grid of its own -
         *            lead | tall | pair          [2 : 1.125 : 1]
         *            tall | pair | tall          [1.125 : 1 : 1.125]
         *          with 4:3 pairs: a pair is 1.5 of its width tall, so a
         *          1.125 column is ~3:4 and the lead's 2 column ~4:3.
         *          On xl the two band wrappers become display:contents and
         *          their cards drop into the one six-column grid.
         *   phone  two columns, five rows, no holes -
         *            tall  | reg          rows 1-2
         *            reg   | tall         rows 3-4 (starts on row 3)
         *            tall  | reg          rows 4-5
         *          The band wrappers are display:contents here too, and the
         *          order-* classes put the second band's cards in that flow.
         * Any other mix of cards falls back to a simple lead-plus-grid.
         */
        const band = talls.length === 3 && regs.length === 4
        type Placed = { m: typeof featured[number]; className: string; aspect?: string; tall: boolean }
        // Literal class strings, so Tailwind sees every one of them
        const PAIR = "aspect-[4/3] xl:aspect-video"
        const bands: Placed[][] = band ? [
          [
            { m: lead, tall: false, aspect: "aspect-[4/3] md:aspect-auto md:h-full",
              className: "col-span-2 md:col-span-1 md:col-start-1 md:row-start-1 md:row-span-2 xl:col-start-1 xl:row-start-1" },
            { m: talls[0], tall: true, className: "row-span-2 md:min-h-0 md:col-start-2 md:row-start-1 xl:col-start-2 xl:row-start-1" },
            { m: regs[0], tall: false, aspect: PAIR, className: "md:col-start-3 md:row-start-1 xl:col-start-3 xl:row-start-1" },
            { m: regs[1], tall: false, aspect: PAIR, className: "md:col-start-3 md:row-start-2 xl:col-start-3 xl:row-start-2" },
          ],
          [
            { m: talls[1], tall: true, className: "row-span-2 order-2 md:order-none md:min-h-0 md:col-start-1 md:row-start-1 xl:col-start-4 xl:row-start-1" },
            { m: regs[2], tall: false, aspect: PAIR, className: "order-1 md:order-none md:col-start-2 md:row-start-1 xl:col-start-5 xl:row-start-1" },
            { m: regs[3], tall: false, aspect: PAIR, className: "order-4 md:order-none md:col-start-2 md:row-start-2 xl:col-start-5 xl:row-start-2" },
            { m: talls[2], tall: true, className: "row-span-2 order-3 md:order-none md:min-h-0 md:col-start-3 md:row-start-1 xl:col-start-6 xl:row-start-1" },
          ],
        ] : [featured.map((m, i): Placed => i === 0
          ? { m, tall: false, aspect: "aspect-[4/3] lg:aspect-auto lg:h-full", className: "col-span-2 lg:row-span-2" }
          : isTall(m) ? { m, tall: true, className: "row-span-2" }
          : { m, tall: false, aspect: "aspect-[4/3] lg:aspect-video", className: "" })]
        const BAND_GRID = ["md:grid-cols-[2fr_1.125fr_1fr]", "md:grid-cols-[1.125fr_1fr_1.125fr]"]
        return (
        <Section icon={<Star size={17} />} title="Featured Models" subtitle="The best place to start">
          <div className={`grid grid-cols-2 ${band ? "md:flex md:flex-col xl:grid xl:grid-cols-[1.5fr_0.84fr_1fr_0.84fr_1fr_0.84fr]" : talls.length ? "lg:grid-cols-[1fr_1fr_0.84fr_1fr_1fr]" : "lg:grid-cols-4"} gap-3 2xl:gap-4`}>
            {bands.map((cardsInBand, b) => (
            <div key={b} className={band ? `contents md:grid ${BAND_GRID[b]} md:gap-3 xl:contents` : "contents"}>
            {cardsInBand.map(({ m, ...pl }) => {
              return (
              <HomeMediaCard
                key={`featured:${m.kind}:${m.name}`}
                cardKey={`${m.kind}:${m.name}`}
                title={m.name}
                subtitle={`${m.group} · ${m.kind === "image" ? "image" : "video"}`}
                accent={m.accent}
                cost={(m.kind === "image" ? imageCostByName : videoCostByName)[m.name]}
                media={cards[`${m.kind}:${m.name}`]}
                altMedia={cards[`${m.kind}:${m.name}::alt`]}
                isAdmin={isAdmin}
                badge={m.admin ? <AdminModelBadge /> : undefined}
                onClick={() => (m.kind === "image" ? onSelectImageModel : onSelectVideoModel)(m.name)}
                onMediaChange={onCardMediaChange}
                tall={pl.tall}
                frameAspect={pl.tall ? 3 / 4 : 4 / 3}
                className={pl.className}
                aspect={pl.aspect}
              />
              )
            })}
            </div>
            ))}
          </div>
        </Section>
        )
      })()}

      {/*
        STUDIOS - Storyboard Studio on its own, as a feature panel: the big
        card (its title art, then the explainer video in its turn of the
        page-wide cycle) beside what it does in three steps. Shows for
        everyone once released; admins only (badged) until then.
      */}
      {featuredStudio && (
        <Section icon={<Wand2 size={17} />} title="Studios" subtitle="Guided workspaces">
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
        </Section>
      )}

      {/* IMAGE - generators and upscalers are different jobs. */}
      <Section icon={<ImageIcon size={17} />} title="Image Models" subtitle="Tap a model to start">
        <SubHead label="Generate" note="text to image · edit" />
        <ModelGrid models={imageGenerate} kind="image" cards={cards} isAdmin={isAdmin} costByName={imageCostByName} onSelect={onSelectImageModel} onCardMediaChange={onCardMediaChange} />
        {imageUpscale.length > 0 && (
          <div className="mt-5">
            <SubHead label="Upscale" note="enhance & enlarge" />
            <ModelGrid models={imageUpscale} kind="image" cards={cards} isAdmin={isAdmin} costByName={imageCostByName} onSelect={onSelectImageModel} onCardMediaChange={onCardMediaChange} />
          </div>
        )}
      </Section>

      {/* VIDEO - generators, then the clip tools. */}
      <Section icon={<Video size={17} />} title="Video Models" subtitle="Tap a model to start">
        <SubHead label="Generate" note="text & image to video" />
        <ModelGrid models={videoGenerate} kind="video" cards={cards} isAdmin={isAdmin} costByName={videoCostByName} onSelect={onSelectVideoModel} onCardMediaChange={onCardMediaChange} />
        {videoTools.length > 0 && (
          <div className="mt-5">
            <SubHead label="Tools" note="lip sync · upscale · restore" />
            <ModelGrid models={videoTools} kind="video" cards={cards} isAdmin={isAdmin} costByName={videoCostByName} onSelect={onSelectVideoModel} onCardMediaChange={onCardMediaChange} />
          </div>
        )}
      </Section>

      {/* AUDIO: one sub-section per kind of audio. */}
      {onSelectAudioModel && audioGroups.some(g => g.items.length) && (
        <Section icon={<Music size={17} />} title="Audio Models" subtitle="Voices, music and sound · tap a card to play a sample">
          {audioGroups.filter(g => g.items.length).map((g, i) => (
            <div key={g.label} className={i ? "mt-5" : ""}>
              <SubHead label={g.label} note={g.note} />
              <ModelGrid models={flatten([g], false)} kind="audio" cards={cards} isAdmin={isAdmin} costByName={audioCostByName} onSelect={onSelectAudioModel} onCardMediaChange={onCardMediaChange} />
            </div>
          ))}
        </Section>
      )}

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
