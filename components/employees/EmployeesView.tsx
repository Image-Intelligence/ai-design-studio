"use client"

import { useEffect, useRef, useState } from "react"
import { Clapperboard, ScanFace, Lock, ArrowLeft, UsersRound, Box, Film, ShieldAlert, GalleryHorizontalEnd, Layers, ArrowRight, ArrowDown, Images, Sparkles, FolderHeart } from "lucide-react"
import { EMPLOYEE_ADMIN_ONLY, employeeVisibleTo, type EmployeeId } from "@/lib/employees"
import { registerCardVideo, type CardVideoHandle } from "@/components/home/card-video-scheduler"
import { LoopVideo } from "@/components/shop/ShopKit"
import { BrandButton } from "./StudioBrand"

export type { EmployeeId }

/**
 * The Employees section of portal-v2.
 *
 * The chat hub exposes every employee through one conversational surface. This
 * is the opposite: a small, fixed set of employees the site actually ships,
 * each with a purpose-built UI that hides the conversation and asks only for
 * what that job needs. The employee behind it is the same one the hub runs.
 *
 * Released one at a time: each employee's admin-only flag lives in
 * lib/employees.ts. A gated one is shown to admins alone, with a red
 * "Admin model" badge; everyone else never sees it. This component fails
 * closed on top of the taskbar gate.
 */

export type EmployeeDef = {
  id: EmployeeId
  name: string
  tagline: string
  blurb: string
  icon: typeof Clapperboard
  /** Tailwind accent used for the card edge and icon. */
  accent: string
  /**
   * Opens over the picker instead of as a workspace inside it. The frame
   * extractor is a modal already; wrapping it in a second shell would give it
   * two headers and two close buttons.
   */
  opensOverlay?: boolean
  /** Three short "what it does" chips on the Studios page card. */
  highlights: string[]
  /** The card's call to action, when "Open studio" is wrong for it (a tool, not a studio). */
  cta?: string
}

export const SITE_EMPLOYEES: EmployeeDef[] = [
  {
    id: "movie-studio",
    name: "Movie Studio",
    tagline: "Stills in, finished film out",
    blurb:
      "Give it your characters, a setting, a look — up to 16 references — and a line about the story. "
      + "It plans the film with you, shoots it shot by shot across the best video models, then cuts and scores it.",
    icon: Clapperboard,
    accent: "fuchsia",
    highlights: ["Up to 16 references", "Plans the film with you", "Shoots, cuts and scores"],
  },
  {
    id: "face-swap",
    name: "Face Swap Studio",
    tagline: "One face, one body, one result",
    blurb:
      "Upload the face and the body. No prompt, no settings — it handles the matching, the blending and the "
      + "cleanup, and the finished image lands in your feed.",
    icon: ScanFace,
    accent: "cyan",
    highlights: ["Two uploads, no prompt", "Matching and blending handled", "Lands in your feed"],
  },
  {
    id: "character-design",
    name: "Character Design",
    tagline: "One character, fully designed",
    blurb:
      "Bring references of a character — or just describe one — and it locks the design down: a written "
      + "canon description plus turnarounds, expressions, poses, wardrobe and accessories, every sheet checked "
      + "against the same face.",
    icon: UsersRound,
    accent: "violet",
    highlights: ["Written canon description", "Turnarounds and expressions", "Every sheet face-checked"],
  },
  {
    id: "3d-studio",
    name: "3D Studio",
    tagline: "Meshes, scenes and rigs",
    blurb:
      "Turn a reference or a prompt into a 3D model, then texture, rig and animate it across the fal 3D suite. "
      + "Every result opens in the viewer and saves to your library.",
    icon: Box,
    accent: "emerald",
    highlights: ["Image or prompt to mesh", "Texture, rig and animate", "Opens in the 3D viewer"],
  },
  {
    id: "frames",
    name: "Frame Extractor",
    tagline: "The best stills out of any video",
    blurb:
      "Drop in a video and it pulls every frame, ranks them by sharpness and flags motion blur, so the frames "
      + "worth keeping are at the top. Send them to your references or download them as a ZIP.",
    icon: Film,
    accent: "amber",
    highlights: ["Every frame pulled", "Ranked by sharpness", "Send to refs or ZIP"],
    opensOverlay: true,
    cta: "Extract frames",
  },
  {
    id: "storyboard",
    name: "Storyboard Studio",
    tagline: "See the cut before you shoot it",
    blurb:
      "Plan a video as a row of stills in order: the story and how the shots connect, then each slot's image, "
      + "the model that made it and the prompt planned for its video. Edit everything, play it back as an "
      + "animatic, and only then shoot.",
    icon: GalleryHorizontalEnd,
    accent: "sky",
    highlights: ["Ordered stills and story", "Per-shot video prompts", "Animatic playback"],
  },
  {
    id: "image-studio",
    name: "Image Studio",
    tagline: "Photoshop in your browser",
    blurb:
      "Layered canvases you can start blank, from an upload or from your Refs: real layers with blend modes and masks, "
      + "brushes, text and shapes, non-destructive adjustments, crop and resize, and AI selections that cut anything out in one click.",
    icon: Layers,
    accent: "rose",
    highlights: ["Layers, masks, blend modes", "AI select and background removal", "Adjustments you can undo"],
  },
]

/**
 * Studios that live in the admin Lab (/admin/lab -> Studios) rather than on the
 * Studios page (moved 2026-10-07). Their workspaces still run inside the
 * portal - they need its Refs library, uploads and feed - so the Lab's cards
 * open the portal on them (openLabStudio), and their back link returns to the Lab.
 */
export const LAB_STUDIOS: EmployeeId[] = ["movie-studio", "face-swap", "character-design"]
export const isLabStudio = (id: EmployeeId) => LAB_STUDIOS.includes(id)

/** Open one of the Lab's studios in the portal: the portal restores the open studio from this tab's session. */
export function openLabStudio(id: EmployeeId) {
  try {
    sessionStorage.setItem("pv2-view-mode", "employees")
    sessionStorage.setItem("pv2-employee", id)
  } catch {}
  window.location.href = "/"
}

const ACCENTS: Record<string, { ring: string; icon: string; glow: string; rgb?: string }> = {
  fuchsia: {
    rgb: "217,70,239",
    ring: "border-fuchsia-500/30 hover:border-fuchsia-400/60",
    icon: "text-fuchsia-400",
    glow: "from-fuchsia-500/[0.10]",
  },
  cyan: {
    rgb: "34,211,238",
    ring: "border-cyan-500/30 hover:border-cyan-400/60",
    icon: "text-cyan-400",
    glow: "from-cyan-500/[0.10]",
  },
  violet: {
    rgb: "167,139,250",
    ring: "border-violet-500/30 hover:border-violet-400/60",
    icon: "text-violet-400",
    glow: "from-violet-500/[0.10]",
  },
  emerald: {
    rgb: "52,211,153",
    ring: "border-emerald-500/30 hover:border-emerald-400/60",
    icon: "text-emerald-400",
    glow: "from-emerald-500/[0.10]",
  },
  amber: {
    rgb: "251,191,36",
    ring: "border-amber-500/30 hover:border-amber-400/60",
    icon: "text-amber-400",
    glow: "from-amber-500/[0.10]",
  },
  rose: {
    rgb: "251,113,133",
    ring: "border-rose-500/30 hover:border-rose-400/60",
    icon: "text-rose-400",
    glow: "from-rose-500/[0.10]",
  },
  sky: {
    rgb: "56,189,248",
    ring: "border-sky-500/30 hover:border-sky-400/60",
    icon: "text-sky-400",
    glow: "from-sky-500/[0.10]",
  },
}

/** The red marker on anything not yet released. Shared with the home page. */
export function AdminModelBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-red-500/35 bg-red-500/10 text-[9px] font-bold uppercase tracking-wider text-red-300">
      <ShieldAlert size={9} className="text-red-400" />
      Admin model
    </span>
  )
}

export function EmployeesView({
  isAdmin,
  active,
  onSelect,
  logo,
  children,
}: {
  isAdmin: boolean
  /** The employee whose workspace is open, or null for the picker. */
  active: EmployeeId | null
  onSelect: (id: EmployeeId | null) => void
  /** The site's own logo control, so this section carries the same mark. */
  logo?: React.ReactNode
  /** The active employee's workspace, rendered by the page. */
  children?: React.ReactNode
}) {
  // Only what this account may open. Admins see everything, badged. The Lab's
  // studios are listed there, not here (they still open here, from the Lab).
  const visible = SITE_EMPLOYEES.filter(e => employeeVisibleTo(e.id, isAdmin) && !isLabStudio(e.id))

  // Fails closed: nothing released and not an admin means nothing to show.
  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <Lock size={22} className="text-slate-600" />
        <p className="text-sm text-slate-400">Studios are not available on this account yet.</p>
      </div>
    )
  }

  if (active && employeeVisibleTo(active, isAdmin)) {
    const def = SITE_EMPLOYEES.find(e => e.id === active)
    return (
      <div className="flex flex-col min-h-0 flex-1">
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 shrink-0">
          {logo}
          <button
            onClick={() => {
              // Opened from the Lab: back to the Lab
              if (isLabStudio(active)) { onSelect(null); window.location.href = "/admin/lab?tab=studios"; return }
              onSelect(null)
            }}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ArrowLeft size={13} /> {isLabStudio(active) ? "Lab" : "Studios"}
          </button>
          {def && (
            <>
              <span className="text-slate-700">/</span>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
                <def.icon size={13} className={ACCENTS[def.accent]?.icon} />
                {def.name}
              </span>
            </>
          )}
          {EMPLOYEE_ADMIN_ONLY[active] && <span className="ml-auto"><AdminModelBadge /></span>}
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    )
  }

  // The headline studio: Storyboard Studio when this account has it (Movie
  // Studio moved to the Lab), else the first
  const featured = visible.find(e => e.id === "storyboard") ?? visible[0]
  const rest = visible.filter(e => e !== featured)

  return (
    // Its own scroll area: the page holds the Studios section at a fixed
    // height with overflow hidden, so without this the page was clipped at
    // the bottom of the screen on a phone. The bottom padding clears iOS
    // Safari's floating toolbar.
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-12">
      <StudiosHero
        logo={logo}
        count={visible.length}
        featured={featured}
        onOpen={() => onSelect(featured.id)}
      />

      {/*
       * The studios as a bento: one column on a phone, two on a tablet, three
       * from xl with the headline studio as a 2x2 feature. Full width up to
       * 2560px - the page used to sit in a narrow centre column like the rest.
       */}
      <section id="studios-grid" className="scroll-mt-4 max-w-[2560px] mx-auto px-4 sm:px-6 lg:px-10 pt-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
          <StudioCard emp={featured} featured onSelect={onSelect} />
          {rest.map((emp, i) => {
            /*
             * Three columns (xl+): the headline card is 2x2, the first two of
             * the rest sit beside it, then rows of three. A row left with one
             * card makes it the whole row; with two, the last spans two - so
             * a big screen never shows a card alone with empty space beside it.
             */
            const left = (rest.length - 2) % 3
            const lastXl = i === rest.length - 1 && rest.length > 2
            return (
              <StudioCard
                key={emp.id}
                emp={emp}
                onSelect={onSelect}
                // Two columns with an odd one out: the last card takes the
                // whole row (laid out sideways) instead of leaving a hole
                wide={rest.length % 2 === 1 && i === rest.length - 1}
                xlSpan={lastXl && left === 1 ? 3 : lastXl && left === 2 ? 2 : 1}
              />
            )
          })}
        </div>
      </section>

      <StudiosHowItWorks />
    </div>
  )
}

/*
 * The page's art: a still per studio and a seamless loop made from it
 * (SeeDance 2.5, first frame = last frame), generated for this page on
 * 2026-10-04 and kept on promptandprotocol@gmail.com's feed. The web copies
 * live in the public bucket under studios/.
 */
const STUDIO_MEDIA_BASE = "https://pub-738a6d61c61a473595356856a86615a1.r2.dev/studios"
/*
 * 2026-10-07: the loop upscaled 2x with SeedVR2 Video (GeneratedImage on user
 * 312) - the 1926x1076 SeeDance original at 1.3 Mbps looked fuzzy stretched
 * over a 2560px monitor. A big or high-DPI screen gets the 4K copy; anything
 * else a 1080p one downscaled from it (sharper than the original, light enough
 * for a phone).
 */
const STUDIOS_HERO = {
  poster: `${STUDIO_MEDIA_BASE}/hero-6048e3e8-12c3-434e-bcc3-ba155eac2feb.webp`,
  poster4k: "https://pub-738a6d61c61a473595356856a86615a1.r2.dev/studios/hero-4k-f2f80929-dfa9-465a-a844-33c57e145d42.webp",
  video: "https://pub-738a6d61c61a473595356856a86615a1.r2.dev/studios/hero-loop-1080-192da3d6-1d46-4668-91ea-49f11483fc61.mp4" as string | null, // null shows the still alone
  video4k: "https://pub-738a6d61c61a473595356856a86615a1.r2.dev/studios/hero-loop-4k-2541ab68-b612-4ca2-b6dc-0081ce8450e5.mp4",
}

/** True on a screen with more than ~2300 device pixels across (a big or high-DPI monitor). */
function useBigScreen() {
  const [big, setBig] = useState(false)
  useEffect(() => {
    const check = () => setBig(window.innerWidth * (window.devicePixelRatio || 1) >= 2300)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])
  return big
}
const STUDIO_MEDIA: Partial<Record<EmployeeId, { poster: string; video?: string }>> = {
  "movie-studio": { poster: `${STUDIO_MEDIA_BASE}/movie-studio-a4f9f422-c928-4948-ba11-82c7405589ca.webp`, video: `${STUDIO_MEDIA_BASE}/movie-studio-loop-5eefcea9-c562-4a3e-a87f-e1713161d9f7.mp4` },
  "face-swap": { poster: `${STUDIO_MEDIA_BASE}/face-swap-ae37324d-f8a9-482b-99c8-747e52d66e0c.webp`, video: `${STUDIO_MEDIA_BASE}/face-swap-loop-b8e65672-84f8-49b4-9edd-6746a35d9f38.mp4` },
  "character-design": { poster: `${STUDIO_MEDIA_BASE}/character-design-3f089e44-4507-4ded-a592-5d33955f9763.webp`, video: `${STUDIO_MEDIA_BASE}/character-design-loop-0cf98d66-ead7-45c5-bdee-1349b2f34e25.mp4` },
  "3d-studio": { poster: `${STUDIO_MEDIA_BASE}/3d-studio-2d5c8730-4355-4b96-8024-5ac23f6aa77d.webp`, video: `${STUDIO_MEDIA_BASE}/3d-studio-loop-eaab7f08-ebef-47dd-8c40-26be58f3f544.mp4` },
  frames: { poster: `${STUDIO_MEDIA_BASE}/frames-1acc0c90-15f6-4072-8661-eb6703f62d21.webp`, video: `${STUDIO_MEDIA_BASE}/frames-loop-9e1a0281-d591-4a42-8354-99523afb40b4.mp4` },
  storyboard: { poster: `${STUDIO_MEDIA_BASE}/storyboard-e04d364e-8058-4658-9423-23059fe8a9d3.webp`, video: `${STUDIO_MEDIA_BASE}/storyboard-loop-24fc505b-c45d-47b0-a86f-ac6ab4f2c5cb.mp4` },
  // 2026-10-06: still only for now (feed 109208); a loop can follow
  "image-studio": { poster: `${STUDIO_MEDIA_BASE}/image-studio-364f42ef-babc-4606-bca7-5f9b4c7dafb7.webp` },
}

function prefersReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches } catch { return false }
}

/**
 * Full-bleed banner: the soundstage loop behind the title. The still's left
 * third is empty dark space for the words on a wide screen; on a phone the
 * picture shifts right to keep the screens in view and the words sit under it.
 */
function StudiosHero({ logo, count, featured, onOpen }: {
  logo?: React.ReactNode
  count: number
  featured: EmployeeDef
  onOpen: () => void
}) {
  // The 4K loop only where its pixels show (decided after mount - the server cannot know)
  const big = useBigScreen()
  const heroVideo = big ? STUDIOS_HERO.video4k : STUDIOS_HERO.video
  const heroPoster = big ? STUDIOS_HERO.poster4k : STUDIOS_HERO.poster
  return (
    <section className="relative isolate overflow-hidden">
      {/* Taller on wide screens (up to the picture's own 16:9) so the badge
          above the screens stays in frame instead of being cropped away */}
      <div className="relative h-[46svh] min-h-[260px] sm:h-[max(420px,min(56.25vw,78vh))]">
        {heroVideo ? (
          <LoopVideo
            key={heroVideo}
            src={heroVideo}
            poster={heroPoster}
            className="absolute inset-0 w-full h-full object-cover object-[72%_50%] sm:object-[50%_20%]"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroPoster} alt="" className="absolute inset-0 w-full h-full object-cover object-[72%_50%] sm:object-[50%_20%]" />
        )}
        {/* Words over the dark left of the picture, and a fade into the page */}
        <div className="absolute inset-0 hidden sm:block bg-gradient-to-r from-[#05080f] via-[#05080f]/75 via-35% to-transparent to-70%" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#05080f] to-transparent" />
      </div>

      <div className="relative -mt-20 sm:mt-0 sm:absolute sm:inset-0 flex items-end sm:items-center">
        <div className="w-full max-w-[2560px] mx-auto px-4 sm:px-6 lg:px-10 pb-6 sm:pb-0">
          <div className="max-w-xl min-[1800px]:max-w-2xl">
            <div className="flex items-center gap-2.5 mb-3">
              {logo}
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-slate-400">AI Design Studio</span>
            </div>
            <h1 className="text-4xl sm:text-6xl xl:text-7xl min-[1800px]:text-8xl font-black tracking-tight leading-[0.95] silver-shimmer-text silver-shimmer-text-slow">
              Studios
            </h1>
            <p className="mt-3 sm:mt-4 text-sm sm:text-base min-[1800px]:text-lg text-slate-300 leading-relaxed">
              Workspaces built for one job each. Bring your references and the goal - the studio asks only for what
              that job needs, does the work, and saves the result to your account.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <BrandButton primary size="lg" onClick={onOpen}>
                {featured.cta ?? `Open ${featured.name}`} <ArrowRight size={14} />
              </BrandButton>
              {count > 1 && <button
                onClick={() => document.getElementById("studios-grid")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/15 bg-black/30 text-[12.5px] font-semibold text-slate-200 hover:text-white hover:border-white/30 hover:bg-white/[0.06] transition-colors"
              >
                All {count} studios <ArrowDown size={13} />
              </button>}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * A card's picture: the still, and in the card's turn of the page-wide video
 * cycle (components/home/card-video-scheduler - the home page's, so only a
 * few clips decode at once, on screen only) its loop crossfading over it.
 */
const MEDIA_FADE_MS = 600
function StudioMedia({ poster, video, className = "" }: { poster?: string; video?: string; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const vidRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<CardVideoHandle | null>(null)
  const [live, setLive] = useState(false)
  const [shown, setShown] = useState(false)
  const [turn, setTurn] = useState(0)

  useEffect(() => {
    const el = boxRef.current
    if (!el || !video || prefersReducedMotion()) return
    let unmount: ReturnType<typeof setTimeout> | null = null
    const handle = registerCardVideo(el, {
      start: () => { if (unmount) clearTimeout(unmount); setLive(true); setTurn(t => t + 1) },
      stop: () => {
        setShown(false)
        if (unmount) clearTimeout(unmount)
        unmount = setTimeout(() => setLive(false), MEDIA_FADE_MS + 50)
      },
      pause: () => { vidRef.current?.pause() },
      resume: () => { vidRef.current?.play()?.catch(() => handleRef.current?.failed()) },
    })
    handleRef.current = handle
    return () => {
      if (unmount) clearTimeout(unmount)
      handle.unregister()
      handleRef.current = null
      setLive(false)
      setShown(false)
    }
  }, [video])

  // Each turn plays from the top, muted through the DOM property (browsers
  // refuse unmuted autoplay and React's attribute is unreliable)
  useEffect(() => {
    const v = vidRef.current
    if (!live || !v || !turn) return
    v.muted = true
    v.currentTime = 0
    v.play()
      ?.then(() => { setShown(true); handleRef.current?.started() })
      .catch((e: unknown) => handleRef.current?.failed((e as DOMException)?.name === "NotAllowedError"))
  }, [live, turn])

  return (
    <div ref={boxRef} className={`absolute inset-0 overflow-hidden ${className}`}>
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
      )}
      {live && video && (
        <video
          ref={vidRef}
          src={video}
          muted
          playsInline
          preload="auto"
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover transition-opacity ease-out"
          style={{ opacity: shown ? 1 : 0, transitionDuration: `${MEDIA_FADE_MS}ms` }}
          onPlaying={() => { setShown(true); handleRef.current?.started() }}
          onWaiting={() => handleRef.current?.stalled()}
          onEnded={() => {
            const v = vidRef.current
            if (v && handleRef.current?.ended()) { v.currentTime = 0; v.play()?.catch(() => handleRef.current?.failed()) }
          }}
          onError={() => handleRef.current?.failed()}
        />
      )}
    </div>
  )
}

/**
 * One studio. Picture on top, words under it. `featured` is the 2x2 headline
 * card (sideways on a tablet or small laptop, tall from xl); `wide` is a card
 * that fills a two-column row on its own, also laid out sideways there;
 * `xlSpan` 2 or 3 is a card that fills the rest of a three-column row on a big
 * screen - sideways too, picture left and words right.
 */
export function StudioCard({ emp, featured = false, wide = false, xlSpan = 1, onSelect }: {
  emp: EmployeeDef
  featured?: boolean
  wide?: boolean
  xlSpan?: 1 | 2 | 3
  onSelect: (id: EmployeeId) => void
}) {
  const a = ACCENTS[emp.accent] ?? ACCENTS.cyan
  const media = STUDIO_MEDIA[emp.id]
  const xlSide = !featured && xlSpan > 1
  const sideways = featured || wide || xlSide

  // Sideways from lg when it fills a two-column row; from xl when it fills a three-column one
  const layout = featured
    ? "sm:col-span-2 xl:row-span-2 lg:flex-row xl:flex-col"
    : [
        wide ? "sm:col-span-2 lg:flex-row" : "",
        xlSpan === 3 ? "xl:col-span-3 xl:flex-row" : xlSpan === 2 ? "xl:col-span-2 xl:flex-row" : wide ? "xl:col-span-1 xl:flex-col" : "",
      ].join(" ")
  const mediaBox = featured
    ? "aspect-video lg:aspect-auto lg:w-[58%] lg:min-h-[22rem] xl:w-full xl:flex-1 xl:min-h-[24rem]"
    : [
        "aspect-video",
        wide ? "lg:aspect-auto lg:w-1/2 lg:min-h-[16rem]" : "",
        xlSpan === 3 ? "xl:aspect-auto xl:w-[58%] xl:min-h-[24rem] min-[1800px]:min-h-[28rem]"
          : xlSpan === 2 ? "xl:aspect-auto xl:w-1/2 xl:min-h-[18rem]"
          : wide ? "xl:w-full xl:aspect-video xl:min-h-0" : "",
      ].join(" ")
  const body = featured ? "lg:flex-1 lg:justify-center xl:flex-none"
    : [wide ? "lg:flex-1 lg:justify-center" : "", xlSide ? "xl:flex-1 xl:justify-center" : wide ? "xl:flex-none" : ""].join(" ")
  // Which fades show: down into the words when stacked, sideways when side by side
  const downFade = featured ? "lg:hidden xl:block" : [wide ? "lg:hidden" : "", xlSide ? "xl:hidden" : wide ? "xl:block" : ""].join(" ")
  const sideFade = featured ? "hidden lg:block xl:hidden" : [wide || xlSide ? "hidden" : "", wide ? "lg:block" : "", xlSide ? "xl:block" : wide ? "xl:hidden" : ""].join(" ")

  return (
    <button
      onClick={() => onSelect(emp.id)}
      className={`group relative isolate flex flex-col text-left rounded-2xl overflow-hidden border border-white/[0.08] bg-[#070b14] silver-edge transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${layout}`}
    >
      {/* The studio's colour, lit from below on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(120% 60% at 50% 100%, rgba(${a.rgb ?? "148,163,184"},0.16), transparent 70%)` }}
      />

      <div className={`relative overflow-hidden shrink-0 ${mediaBox}`}>
        <div className="absolute inset-0 transition-transform duration-[1200ms] ease-out group-hover:scale-[1.04]">
          <StudioMedia poster={media?.poster} video={media?.video} />
        </div>
        {/* Fade into the card body - downwards, or towards the words when sideways */}
        <div className={`absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#070b14] to-transparent ${downFade}`} />
        {sideways && <div className={`absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-[#070b14] to-transparent ${sideFade}`} />}
        <span className="absolute top-3 left-3 w-9 h-9 rounded-xl border border-white/15 bg-black/55 flex items-center justify-center">
          <emp.icon size={16} className={a.icon} />
        </span>
        {/* Per studio, so they can be released one at a time */}
        {EMPLOYEE_ADMIN_ONLY[emp.id] && <span className="absolute top-3 right-3"><AdminModelBadge /></span>}
      </div>

      <div className={`relative flex flex-col gap-2 p-4 sm:p-5 ${featured ? "xl:p-6" : ""} ${body}`}>
        <div className={`text-[10px] min-[1800px]:text-[11px] font-mono uppercase tracking-[0.18em] ${a.icon}`}>{emp.tagline}</div>
        <div className={`font-black tracking-tight text-slate-50 ${featured ? "text-2xl sm:text-3xl min-[1800px]:text-4xl" : "text-lg sm:text-xl min-[1800px]:text-2xl"}`}>
          {emp.name}
        </div>
        <p className={`text-[12.5px] min-[1800px]:text-sm leading-relaxed text-slate-400 ${featured || wide || xlSide ? "" : "line-clamp-3"}`}>{emp.blurb}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {emp.highlights.map(h => (
            <span key={h} className="px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.04] text-[10.5px] min-[1800px]:text-xs text-slate-300">{h}</span>
          ))}
        </div>
        <div className={`pt-2 flex items-center gap-1.5 text-[12px] min-[1800px]:text-sm font-bold text-slate-200 group-hover:text-white ${featured ? "mt-auto lg:mt-0 xl:mt-auto" : ["mt-auto", wide ? "lg:mt-0" : "", xlSide ? "xl:mt-0" : wide ? "xl:mt-auto" : ""].join(" ")}`}>
          {emp.cta ?? "Open studio"}
          <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
        </div>
      </div>
    </button>
  )
}

const HOW_IT_WORKS = [
  { icon: Sparkles, title: "Pick the job", text: "Each studio does one thing well and asks only for what that job needs - no prompt engineering, no settings pages." },
  { icon: Images, title: "Bring your references", text: "Your Refs library comes with you. Characters, settings and looks you have saved are one tap away in every studio." },
  { icon: FolderHeart, title: "Keep the results", text: "Everything a studio makes is saved to your account - your feed, your library or the 3D viewer - ready to reuse." },
]

function StudiosHowItWorks() {
  return (
    <section className="max-w-[2560px] mx-auto px-4 sm:px-6 lg:px-10 mt-10 sm:mt-14">
      <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-slate-500 mb-3">How the studios work</div>
      <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
        {HOW_IT_WORKS.map((s, i) => (
          <div key={s.title} className="relative rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 sm:p-5 silver-edge">
            <div className="flex items-center gap-3 mb-2">
              <span className="w-9 h-9 rounded-xl border border-white/10 bg-black/40 flex items-center justify-center shrink-0">
                <s.icon size={16} className="text-slate-300" />
              </span>
              <span className="text-[10px] font-mono text-slate-600">0{i + 1}</span>
              <span className="text-sm font-bold text-slate-100">{s.title}</span>
            </div>
            <p className="text-[12px] min-[1800px]:text-sm leading-relaxed text-slate-400">{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
