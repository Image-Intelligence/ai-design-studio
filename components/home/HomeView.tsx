"use client"

import type { ReactNode } from "react"
import { Image as ImageIcon, Video, FolderOpen, Shield } from "lucide-react"
import { HomeMediaCard, type CardMedia } from "./HomeMediaCard"
import { NewsStreamCard } from "./NewsStreamCard"
import { GenerationsCarousel } from "./GenerationsCarousel"

// Model group shape (matches IMAGE_MODEL_GROUPS / VIDEO_MODEL_GROUPS in portal-v2).
export type ModelGroup = { label: string; type: string; accent: string; dot: string; items: string[] }

// Home-page card order (overrides the group order). Listed models come first in this
// exact order; any model not listed follows in its original order.
const HOME_IMAGE_ORDER = ["NanoBanana Pro 2", "ChatGPT Images 2.0", "Kling O3", "SeeDream 5.0 Pro", "Recraft v4.1", "SeeDream 4.5", "Wan 2.7 Pro", "SeeDream 5.0 Lite"]
const HOME_VIDEO_ORDER = ["SeeDance 2.0", "Kling 3.0", "Wan 2.5", "Happy Horse", "Kling V3 Motion", "SeeDance 1.5", "SeeDance 2.0 Fast", "Lipsync v3"]

function reorder<T extends { name: string }>(models: T[], order: string[]): T[] {
  const front = order.map(n => models.find(m => m.name === n)).filter((m): m is T => !!m)
  const rest = models.filter(m => !order.includes(m.name))
  return [...front, ...rest]
}

function Section({ icon, title, subtitle, children }: { icon?: ReactNode; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-cyan-400">{icon}</span>}
        <h2 className="text-base font-black tracking-tight text-white">{title}</h2>
        {subtitle && <span className="text-[11px] text-slate-600">{subtitle}</span>}
      </div>
      {children}
    </section>
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
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
      {models.map(m => (
        <div key={`${kind}:${m.name}`} className="w-44 sm:w-52 shrink-0 snap-start">
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
  adminImageGroups = [],
  videoGroups,
  adminVideoGroups = [],
  imageCostByName = {},
  videoCostByName = {},
  cards,
  onSelectImageModel,
  onSelectVideoModel,
  onGoChat,
  onCardMediaChange,
}: {
  isAdmin: boolean
  signedIn: boolean
  imageGroups: ModelGroup[]
  adminImageGroups?: ModelGroup[]
  videoGroups: ModelGroup[]
  adminVideoGroups?: ModelGroup[]
  imageCostByName?: Record<string, string>
  videoCostByName?: Record<string, string>
  cards: Record<string, CardMedia>
  onSelectImageModel: (name: string) => void
  onSelectVideoModel: (name: string) => void
  onGoChat: () => void
  onCardMediaChange: (key: string, media: CardMedia | null) => void
}) {
  const flatten = (groups: ModelGroup[]) =>
    groups.flatMap(g => g.items.map(name => ({ name, accent: g.accent, group: g.label })))

  // Public sections show only the non-admin models; admin-only models live in the
  // Admin section at the bottom (visible/interactable to admins only).
  const imageModels = reorder(flatten(imageGroups), HOME_IMAGE_ORDER)
  const videoModels = reorder(flatten(videoGroups), HOME_VIDEO_ORDER)
  const adminImageModels = flatten(adminImageGroups)
  const adminVideoModels = flatten(adminVideoGroups)

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-32">
      {/* SHOP — top of the page, no header, just the two cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
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

      {/* IMAGE — one continuous horizontal-scroll row */}
      <Section icon={<ImageIcon size={17} />} title="Image Models" subtitle="Scroll · tap a model to start">
        <ModelRow models={imageModels} kind="image" cards={cards} isAdmin={isAdmin} costByName={imageCostByName} onSelect={onSelectImageModel} onCardMediaChange={onCardMediaChange} />
      </Section>

      {/* VIDEO — one continuous horizontal-scroll row */}
      <Section icon={<Video size={17} />} title="Video Models" subtitle="Scroll · tap a model to start">
        <ModelRow models={videoModels} kind="video" cards={cards} isAdmin={isAdmin} costByName={videoCostByName} onSelect={onSelectVideoModel} onCardMediaChange={onCardMediaChange} />
      </Section>

      {/* LIBRARY + NEWS */}
      <Section icon={<FolderOpen size={17} />} title="Your Library &amp; News">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <GenerationsCarousel signedIn={signedIn} className="lg:col-span-1" />
          <NewsStreamCard className="lg:col-span-2" />
        </div>
      </Section>

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
