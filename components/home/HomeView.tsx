"use client"

import type { ReactNode } from "react"
import { Image as ImageIcon, Video, FolderOpen, Shield, Wand2 } from "lucide-react"
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

// A horizontally-scrolling row of model cards.
function ModelRow({ models, kind, cards, isAdmin, costByName, onSelect, onCardMediaChange }: {
  models: { name: string; accent: string; group: string }[]
  kind: "image" | "video"
  cards: Record<string, CardMedia>
  isAdmin: boolean
  costByName: Record<string, string>
  onSelect: (name: string) => void
  onCardMediaChange: (key: string, media: CardMedia | null) => void
}) {
  if (models.length === 0) return null
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
      {models.map(m => (
        <div key={`${kind}:${m.name}`} className="w-40 sm:w-52 shrink-0 snap-start">
          <HomeMediaCard
            cardKey={`${kind}:${m.name}`}
            title={m.name}
            subtitle={m.group}
            accent={m.accent}
            cost={costByName[m.name]}
            media={cards[`${kind}:${m.name}`]}
            isAdmin={isAdmin}
            onClick={() => onSelect(m.name)}
            onMediaChange={onCardMediaChange}
          />
        </div>
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
  const flatten = (groups: ModelGroup[]) =>
    groups.flatMap(g => g.items.map(name => ({ name, accent: g.accent, group: g.label })))

  // Public sections show only the non-admin models; admin-only models live in the
  // Admin section at the bottom (visible/interactable to admins only).
  const imageModels = reorder(flatten(imageGroups), HOME_IMAGE_ORDER)
  const upscaleModels = imageSections.flatMap(sec => flatten(sec.groups))
  const videoModels = reorder(flatten(videoGroups), HOME_VIDEO_ORDER)
  const adminImageModels = flatten(adminImageGroups)
  const adminVideoModels = flatten(adminVideoGroups)

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-32">
      {/* SHOP — top of the page, no header, just the two cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-7 sm:mb-8">
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
      </div>

      {/*
        STUDIOS — whole workspaces, not single models.

        Admin-gated to match the app: portal-v2 sends non-admins straight back
        out of the employees and 3D modes, and the frames tool is admin-only,
        so showing these to everyone would be five cards that bounce you.

        The grid is deliberately not just `sm:grid-cols-2 lg:grid-cols-3`: a
        phone held sideways is wide but SHORT, and one-column cards there push
        everything else below the fold. `landscape:grid-cols-2` gives it two
        columns as soon as the phone turns, independent of width.
      */}
      {/*
        STUDIOS - thumbnail cards in the same scrolling row as the models, so
        the section looks like the rest of the page. Driven by SITE_EMPLOYEES:
        a released studio shows for everyone, a gated one for admins only,
        badged. Admins upload each card's thumbnail as for a model.
      */}
      {(() => {
        const studios = SITE_EMPLOYEES.filter(e => employeeVisibleTo(e.id, isAdmin))
        if (studios.length === 0) return null
        return (
          <Section icon={<Wand2 size={17} />} title="Studios" subtitle="Guided workspaces">
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
              {studios.map(emp => (
                <div key={emp.id} className="w-40 sm:w-52 shrink-0 snap-start">
                  <HomeMediaCard
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
                </div>
              ))}
            </div>
          </Section>
        )
      })()}

      {/*
        IMAGE — generating models and upscalers are different jobs, so they get
        their own rows. Upscalers were invisible on this page entirely: they
        live in a tool-first section rather than the company list, and this page
        only ever read the company list.
      */}
      <Section icon={<ImageIcon size={17} />} title="Image Models" subtitle="Scroll · tap a model to start">
        <SubHead label="Generate" note="text to image" />
        <ModelRow models={imageModels} kind="image" cards={cards} isAdmin={isAdmin} costByName={imageCostByName} onSelect={onSelectImageModel} onCardMediaChange={onCardMediaChange} />
        {upscaleModels.length > 0 && (
          <div className="mt-4">
            <SubHead label="Upscale" note="enhance & enlarge" />
            <ModelRow models={upscaleModels} kind="image" cards={cards} isAdmin={isAdmin} costByName={imageCostByName} onSelect={onSelectImageModel} onCardMediaChange={onCardMediaChange} />
          </div>
        )}
      </Section>

      {/* VIDEO — one continuous horizontal-scroll row */}
      <Section icon={<Video size={17} />} title="Video Models" subtitle="Scroll · tap a model to start">
        <ModelRow models={videoModels} kind="video" cards={cards} isAdmin={isAdmin} costByName={videoCostByName} onSelect={onSelectVideoModel} onCardMediaChange={onCardMediaChange} />
      </Section>

      {/* LIBRARY — full width now that the news card is gone */}
      <Section icon={<FolderOpen size={17} />} title="Your Library">
        <GenerationsCarousel signedIn={signedIn} />
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

      {/* ADMIN — visible & interactable to admins only */}
      {isAdmin && (
        <Section icon={<Shield size={17} />} title="Admin" subtitle="Admin-only models & tools">
          {adminImageModels.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Image models</p>
              <ModelRow models={adminImageModels} kind="image" cards={cards} isAdmin={isAdmin} costByName={imageCostByName} onSelect={onSelectImageModel} onCardMediaChange={onCardMediaChange} />
            </div>
          )}
          {adminVideoModels.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Video models</p>
              <ModelRow models={adminVideoModels} kind="video" cards={cards} isAdmin={isAdmin} costByName={videoCostByName} onSelect={onSelectVideoModel} onCardMediaChange={onCardMediaChange} />
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Tools</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <HomeMediaCard
                cardKey="admin:chat"
                title="AI Chat Hub"
                subtitle="Multi-provider chat"
                accent="text-violet-300"
                media={cards["admin:chat"]}
                isAdmin={isAdmin}
                onClick={onGoChat}
                onMediaChange={onCardMediaChange}
              />
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}
