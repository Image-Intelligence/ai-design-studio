"use client"

import type { ReactNode } from "react"
import { Image as ImageIcon, Video, Shield, Wand2, Star } from "lucide-react"
import { HomeMediaCard, type CardMedia } from "./HomeMediaCard"
import { GenerationsCarousel } from "./GenerationsCarousel"
import { SITE_EMPLOYEES, AdminModelBadge } from "@/components/employees/EmployeesView"
import { EMPLOYEE_ADMIN_ONLY, employeeVisibleTo } from "@/lib/employees"

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
const HOME_VIDEO_ORDER = ["SeeDance 2.0", "Kling 3.0", "Wan 2.5", "Happy Horse", "Kling V3 Motion", "SeeDance 1.5", "SeeDance 2.0 Fast", "Lipsync v3"]

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

/** Top models, shown first. Order matters: the first is the lead card. */
const FEATURED_MODELS: { name: string; kind: "image" | "video" }[] = [
  { name: "NanoBanana Pro 2", kind: "image" },
  { name: "ChatGPT Images 2.5", kind: "image" },
  { name: "Ideogram v4", kind: "image" },
  { name: "SeeDance 2.0", kind: "video" },
  { name: "Kling 3.0", kind: "video" },
]

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

/**
 * A wrapping grid of model cards. The long single-file scrolling rows made a
 * wide screen look empty on the right and hid most models off the edge; a
 * grid shows all of them, as many across as the screen takes.
 */
function ModelGrid({ models, kind, cards, isAdmin, costByName, onSelect, onCardMediaChange }: {
  models: HomeModel[]
  kind: "image" | "video"
  cards: Record<string, CardMedia>
  isAdmin: boolean
  costByName: Record<string, string>
  onSelect: (name: string) => void
  onCardMediaChange: (key: string, media: CardMedia | null) => void
}) {
  if (models.length === 0) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 min-[2200px]:grid-cols-8 gap-3 2xl:gap-4">
      {models.map(m => (
        <HomeMediaCard
          key={`${kind}:${m.name}`}
          cardKey={`${kind}:${m.name}`}
          title={m.name}
          subtitle={m.group}
          accent={m.accent}
          cost={costByName[m.name]}
          media={cards[`${kind}:${m.name}`]}
          isAdmin={isAdmin}
          badge={m.admin ? <AdminModelBadge /> : undefined}
          onClick={() => onSelect(m.name)}
          onMediaChange={onCardMediaChange}
        />
      ))}
    </div>
  )
}

export function HomeView({
  isAdmin,
  signedIn,
  imageGroups,
  imageSections = [],
  adminImageGroups = [],
  videoGroups,
  adminVideoGroups = [],
  imageCostByName = {},
  videoCostByName = {},
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
  videoGroups: ModelGroup[]
  adminVideoGroups?: ModelGroup[]
  imageCostByName?: Record<string, string>
  videoCostByName?: Record<string, string>
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
  const imageGenerate = [
    ...reorder(flatten(imageGroups, false), HOME_IMAGE_ORDER),
    ...flatten(adminImage.filter(g => !isUpscaleGroup(g)), true).filter(m => !UPSCALE_ITEMS.has(m.name)),
  ]
  const imageUpscale = [
    ...imageSections.flatMap(sec => flatten(sec.groups, false)),
    ...flatten(adminImage.filter(isUpscaleGroup), true),
    ...flatten(adminImage.filter(g => !isUpscaleGroup(g)), true).filter(m => UPSCALE_ITEMS.has(m.name)),
  ]
  const isToolGroup = (g: ModelGroup) => VIDEO_TOOL_GROUP_LABELS.has(g.label)
  const videoGenerate = [
    ...reorder(flatten(videoGroups.filter(g => !isToolGroup(g)), false), HOME_VIDEO_ORDER),
    ...flatten(adminVideo.filter(g => !isToolGroup(g)), true),
  ]
  const videoTools = [
    ...flatten(videoGroups.filter(isToolGroup), false),
    ...flatten(adminVideo.filter(isToolGroup), true),
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

  const studios = SITE_EMPLOYEES.filter(e => employeeVisibleTo(e.id, isAdmin))

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
      */}
      {featured.length > 0 && (
        <Section icon={<Star size={17} />} title="Featured Models" subtitle="The best place to start">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 2xl:gap-4">
            {featured.map((m, i) => (
              <HomeMediaCard
                key={`featured:${m.kind}:${m.name}`}
                cardKey={`${m.kind}:${m.name}`}
                title={m.name}
                subtitle={`${m.group} · ${m.kind === "image" ? "image" : "video"}`}
                accent={m.accent}
                cost={(m.kind === "image" ? imageCostByName : videoCostByName)[m.name]}
                media={cards[`${m.kind}:${m.name}`]}
                isAdmin={isAdmin}
                badge={m.admin ? <AdminModelBadge /> : undefined}
                onClick={() => (m.kind === "image" ? onSelectImageModel : onSelectVideoModel)(m.name)}
                onMediaChange={onCardMediaChange}
                className={i === 0 ? "col-span-2 lg:row-span-2" : ""}
                aspect={i === 0 ? "aspect-[4/3] lg:aspect-auto lg:h-full" : "aspect-[4/3] lg:aspect-video"}
              />
            ))}
          </div>
        </Section>
      )}

      {/*
        STUDIOS - driven by SITE_EMPLOYEES: a released studio shows for
        everyone, a gated one for admins only, badged.
      */}
      {studios.length > 0 && (
        <Section icon={<Wand2 size={17} />} title="Studios" subtitle="Guided workspaces">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 2xl:gap-4">
            {studios.map(emp => (
              <HomeMediaCard
                key={emp.id}
                cardKey={`studio:${emp.id}`}
                title={emp.name}
                subtitle={emp.tagline}
                media={cards[`studio:${emp.id}`]}
                isAdmin={isAdmin}
                badge={EMPLOYEE_ADMIN_ONLY[emp.id] ? <AdminModelBadge /> : undefined}
                onClick={() => emp.opensOverlay ? onOpenFrames()
                  : emp.id === "3d-studio" ? onGoThreeD()
                  : onGoEmployee(emp.id)}
                onMediaChange={onCardMediaChange}
              />
            ))}
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

      {/* Content policy notice. Compact and always present: the payment
          processor asked for a clearly stated prohibition on deepfakes and
          non-consensual impersonation, visible on the site itself and not
          only inside the Terms. */}
      <div className="mb-8 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3">
        <Shield size={15} className="text-red-300/80 shrink-0 mt-0.5" />
        <p className="text-[12px] text-slate-300 leading-relaxed">
          <span className="font-semibold text-white">Prohibited content.</span>{" "}
          The creation, upload, distribution, or use of deepfake content, non-consensual impersonation
          of any real person, and any illegal or policy-violating AI-generated content is strictly
          prohibited on this site.{" "}
          <a href="/terms#prohibited" className="text-red-200 hover:underline whitespace-nowrap">Read the full policy →</a>
        </p>
      </div>

      {/* ADMIN TOOLS - the models moved into their own sections; only the
          tools that are not models remain here. */}
      {isAdmin && (
        <Section icon={<Shield size={17} />} title="Admin Tools" subtitle="Admin only">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 2xl:gap-4">
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
