"use client"

import { useState } from "react"
import { Check, ChevronDown, ChevronRight, Clapperboard } from "lucide-react"
import { useThumb } from "@/components/employees/still-thumbs"
import { sceneRefName, sceneRefShots, shotCaption, type StoryScene, type StoryboardShot } from "@/lib/storyboard"

/*
 * Scenes as assets (2026-10-08). Every scene of the board shows up in the
 * Assets section as a set of its own stills; switch a whole scene on, or pick
 * single shots of it, and the AI draft may hand those stills to the shots it
 * writes ("Scene 2 #3") - so a scene drafted later keeps the faces, set,
 * outfits and light of the ones before it. Nothing is copied: the state is
 * StoryScene.asRef / refOff, and the draft builds the lists from the board's
 * current stills (lib/storyboard sceneRefAssets), so a remade still is the
 * one that goes.
 */

/** A scene with the shot switched on/off. Turning the last one off switches the scene off. */
function toggleShot(c: StoryScene, withStill: string[], shotId: string): StoryScene {
  if (!c.asRef) return { ...c, asRef: true, refOff: withStill.filter(id => id !== shotId) }
  const off = c.refOff ?? []
  const next = off.includes(shotId) ? off.filter(id => id !== shotId) : [...off, shotId]
  if (withStill.every(id => next.includes(id))) return { ...c, asRef: undefined, refOff: undefined }
  return { ...c, refOff: next.length ? next : undefined }
}

export function SceneRefs({ scenes, shots, onChange }: {
  scenes: StoryScene[]
  shots: StoryboardShot[]
  onChange: (fn: (scenes: StoryScene[]) => StoryScene[]) => void
}) {
  const thumb = useThumb()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!scenes.length) return null
  const patch = (id: string, fn: (c: StoryScene) => StoryScene) => onChange(list => list.map(c => (c.id === id ? fn(c) : c)))
  const onCount = scenes.filter(c => sceneRefShots(shots, c).length).length

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Scenes</h4>
        <span className="font-mono text-[9.5px] text-slate-600">{onCount ? `${onCount} referenced` : "none referenced"}</span>
      </div>
      <p className="text-[10px] leading-snug text-slate-600">
        Switch a scene on - or pick single shots of it - and the AI draft can use those stills as references for the shots it writes next,
        so later scenes keep the same faces, places and outfits.
      </p>
      {scenes.map((c, k) => {
        const own = shots.filter(s => s.sceneId === c.id)
        const withStill = own.filter(s => s.stillUrl)
        const chosen = sceneRefShots(shots, c)
        const on = chosen.length > 0
        const isOpen = open[c.id] ?? on
        const empty = withStill.length === 0
        return (
          <div key={c.id} className={`rounded-xl border bg-black/20 ${on ? "border-white/25" : "border-white/10"}`}>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <button onClick={() => setOpen(o => ({ ...o, [c.id]: !isOpen }))} disabled={empty} className="text-slate-500 hover:text-white disabled:opacity-30">
                {isOpen && !empty ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <Clapperboard size={13} className="shrink-0 text-slate-200" />
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-slate-100" title={[c.title, c.setting].filter(Boolean).join(" - ")}>
                {sceneRefName(k)}{c.title ? <span className="font-normal text-slate-400"> · {c.title}</span> : null}
              </span>
              <span className="shrink-0 font-mono text-[9.5px] text-slate-500">
                {empty ? "no stills yet" : `${chosen.length}/${withStill.length}`}
              </span>
              <button
                role="switch"
                aria-checked={on}
                disabled={empty}
                onClick={() => {
                  patch(c.id, x => (on ? { ...x, asRef: undefined, refOff: undefined } : { ...x, asRef: true, refOff: undefined }))
                  if (!on) setOpen(o => ({ ...o, [c.id]: true }))
                }}
                title={on ? "Stop using this scene as a reference" : "Use every still of this scene as a reference for the AI draft"}
                className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors disabled:opacity-30 ${on ? "border-white bg-white" : "border-white/25 bg-white/[0.06]"}`}
              >
                <span className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-all ${on ? "left-[14px] bg-black" : "left-[2px] bg-slate-400"}`} />
              </button>
            </div>
            {isOpen && !empty && (
              <div className="grid grid-cols-4 gap-1 px-2 pb-2">
                {withStill.map(s => {
                  const picked = chosen.some(x => x.id === s.id)
                  const n = own.indexOf(s) + 1
                  return (
                    <button
                      key={s.id}
                      onClick={() => patch(c.id, x => toggleShot(x, withStill.map(w => w.id), s.id))}
                      title={`${picked ? "Referenced" : "Not referenced"} - shot ${n}: ${shotCaption(s)}`}
                      className={`relative aspect-square overflow-hidden rounded-md border-2 transition ${picked ? "border-white" : "border-transparent opacity-35 hover:opacity-70"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb(s.stillUrl) || s.stillUrl!} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                      <span className="absolute bottom-0 left-0 bg-black/70 px-1 font-mono text-[8.5px] text-slate-200">{n}</span>
                      {picked && (
                        <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-black">
                          <Check size={9} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
