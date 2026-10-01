"use client"

import { useMemo } from "react"

/*
 * The artwork an audio model card shows until an admin uploads its own:
 * a waveform tinted with the model's group colour, over the same dark
 * gradient the other cards use. The bars come from the model's name, so each
 * card has its own shape and it never changes between visits.
 */
export function AudioCardArt({ seed, tint }: { seed: string; tint: string }) {
  const bars = useMemo(() => {
    let h = 0
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return Array.from({ length: 40 }, (_, i) => {
      h = (h * 1103515245 + 12345) >>> 0
      const env = Math.sin((i / 39) * Math.PI) * 0.7 + 0.3
      return 0.12 + ((h % 1000) / 1000) * 0.88 * env
    })
  }, [seed])
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.07] via-slate-900 to-black overflow-hidden">
      {/* soft glow in the group colour */}
      <div className={`absolute -inset-1/4 ${tint} opacity-[0.12] blur-3xl`} style={{ background: "radial-gradient(circle at 50% 45%, currentColor, transparent 60%)" }} />
      <div className={`absolute inset-x-[12%] top-[22%] bottom-[38%] flex items-center gap-[3px] ${tint}`}>
        {bars.map((v, i) => (
          <span key={i} className="flex-1 rounded-full bg-current opacity-80" style={{ height: `${Math.round(v * 100)}%` }} />
        ))}
      </div>
      {/* the centre line */}
      <div className={`absolute inset-x-[8%] top-[41%] h-px ${tint} bg-current opacity-20`} />
    </div>
  )
}
