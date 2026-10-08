"use client"

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { ArrowUpRight, Box, ImageOff, Loader2, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"

/*
 * My Generations > Library - the account's reference library (the Refs panel
 * on the portal), shown next to the generations and Assets (2026-10-08).
 *
 * Read from /api/user/references, the same rows the Refs panel uses, so the
 * two always agree. Viewing and removing live here; uploading and switching
 * references on stay in the Refs panel, where they're used (the link opens it).
 * Folders inside the library were retired the same day, so it's one flat grid.
 */

type Ref = { id: number; url: string; createdAt: string }

const isVideo = (u: string) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u)
const is3D = (u: string) => /\.(glb|gltf|obj|stl|fbx|ply|usdz|3mf)(\?|$)/i.test(u)

export function RefLibraryGrid({ signedIn, onCount }: { signedIn: boolean; onCount?: (n: number) => void }) {
  const [refs, setRefs] = useState<Ref[] | null>(null)
  const [limit, setLimit] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Ref | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const r = await fetch("/api/user/references", { cache: "no-store" }).catch(() => null)
    const j = r?.ok ? await r.json().catch(() => null) : null
    if (!j) { setError("Couldn't load your library"); setRefs([]); return }
    // Newest first here (the Refs panel keeps upload order)
    const list = (j.references as Ref[]).slice().reverse()
    setRefs(list)
    setLimit(typeof j.limit === "number" ? j.limit : null)
    onCount?.(list.length)
  }, [onCount])

  useEffect(() => { if (signedIn) void load() }, [signedIn, load])

  const remove = async (id: number) => {
    setConfirmId(null)
    setRefs(prev => {
      const next = prev?.filter(r => r.id !== id) ?? null
      if (next) onCount?.(next.length)
      return next
    })
    if (open?.id === id) setOpen(null)
    const r = await fetch(`/api/user/references?ids=${id}`, { method: "DELETE" }).catch(() => null)
    if (!r?.ok) { setError("Couldn't remove it - try again"); void load() }
  }

  if (refs === null) {
    return <div className="flex items-center justify-center py-24 text-slate-500"><Loader2 size={18} className="animate-spin" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Reference library</h2>
          <p className="text-[12px] text-slate-500">
            The pictures and clips you&apos;ve uploaded to use as references{limit ? ` - ${refs.length} of ${limit} slots` : ""}.
          </p>
        </div>
        <Link href="/admin/portal-v2" className="flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[12px] text-slate-200 transition-colors hover:bg-white/[0.09] hover:text-white">
          Upload or use them in Refs <ArrowUpRight size={12} className="text-slate-500" />
        </Link>
      </div>

      {error && <p className="text-[12px] text-red-400">{error}</p>}

      {refs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] py-20 text-center">
          <ImageOff size={22} className="text-slate-600" />
          <p className="text-[14px] text-slate-300">Your reference library is empty</p>
          <p className="text-[12px] text-slate-500">Upload pictures in the Refs section, or add them there from My Generations.</p>
        </div>
      ) : (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(clamp(110px, 14vw, 220px), 1fr))" }}>
          {refs.map(r => (
            <div key={r.id} className="group relative aspect-square overflow-hidden rounded-xl border border-white/[0.07] bg-black/40">
              <button onClick={() => !is3D(r.url) && setOpen(r)} className="block h-full w-full" title={is3D(r.url) ? "3D file" : "View"}>
                {is3D(r.url) ? (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1">
                    <Box size={22} className="text-red-400/70" />
                    <span className="font-mono text-[10px] uppercase text-slate-500">{(r.url.split(".").pop() ?? "3d").split("?")[0]}</span>
                  </span>
                ) : isVideo(r.url) ? (
                  <video src={r.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/user/references/thumb/${r.id}`} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                )}
              </button>
              {isVideo(r.url) && <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-fuchsia-300">Clip</span>}
              {/* Remove: one tap arms it, the second removes it */}
              <button
                onClick={() => (confirmId === r.id ? remove(r.id) : (setConfirmId(r.id), setTimeout(() => setConfirmId(c => (c === r.id ? null : c)), 3500)))}
                title={confirmId === r.id ? "Tap again to remove it from your library" : "Remove from the library"}
                className={cn(
                  "absolute right-2 top-2 flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] transition-all",
                  confirmId === r.id
                    ? "bg-rose-500/90 text-white opacity-100"
                    : "bg-black/70 text-slate-200 opacity-0 hover:text-white group-hover:opacity-100 max-sm:opacity-100",
                )}
              >
                <Trash2 size={12} />{confirmId === r.id && "Remove?"}
              </button>
            </div>
          ))}
        </div>
      )}

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4" onClick={() => setOpen(null)}>
          <button onClick={() => setOpen(null)} className="absolute right-4 top-4 rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Close"><X size={20} /></button>
          {isVideo(open.url) ? (
            <video src={open.url} controls autoPlay playsInline className="max-h-[88vh] max-w-[92vw] rounded-xl" onClick={e => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={open.url} alt="" className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain" onClick={e => e.stopPropagation()} />
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
