/**
 * Caption overlays for the Storyboard Stills cut: a full-frame transparent PNG
 * holding one caption box - an optional gold tag line, the caption in big
 * white capitals, an optional smaller line - placed in one of six spots.
 *
 * Drawn with next/og (Satori + resvg), not sharp's SVG text: a Vercel function
 * has no system fonts, so sharp/librsvg text comes out blank there. next/og
 * carries its own (Noto Sans); the heavy weight the captions want (Inter 800)
 * is fetched from Google Fonts once per instance, falling back to Noto.
 */
import { ImageResponse } from 'next/og'

export type CaptionPos = 'tl' | 'tr' | 'tc' | 'bl' | 'br' | 'bc'
export const CAPTION_POSITIONS: CaptionPos[] = ['tl', 'tr', 'tc', 'bl', 'br', 'bc']
export const isCaptionPos = (v: unknown): v is CaptionPos => CAPTION_POSITIONS.includes(v as CaptionPos)

/**
 * The frame's no-go margins as fractions of its size: a phone app's own
 * buttons and caption sit over the bottom and right of a 9:16 video, and a
 * home card prints its name and price along its bottom edge.
 */
export type SafeArea = { top: number; bottom: number; left: number; right: number }
export const SAFE_AREAS: Record<'social' | 'card' | 'plain', SafeArea> = {
  social: { top: 0.11, bottom: 0.24, left: 0.05, right: 0.14 },
  card: { top: 0.05, bottom: 0.17, left: 0.045, right: 0.045 },
  plain: { top: 0.05, bottom: 0.07, left: 0.045, right: 0.045 },
}

let heavy: Promise<ArrayBuffer | null> | null = null
/** Inter ExtraBold (an old Safari user agent gets a TTF / WOFF link from the CSS API, not WOFF2). */
function heavyFont(): Promise<ArrayBuffer | null> {
  heavy ??= (async () => {
    try {
      const css = await (await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@800', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Version/5.1 Safari/534.30' },
        signal: AbortSignal.timeout(8000),
      })).text()
      // TTF, OTF or WOFF - Satori reads those (not WOFF2); this user agent gets WOFF
      const url = /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype|woff)'\)/.exec(css)?.[1]
      if (!url) return null
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      return res.ok ? await res.arrayBuffer() : null
    } catch { return null }
  })()
  return heavy
}

export async function renderCaption(o: {
  width: number; height: number; text: string; sub?: string; tag?: string; pos: CaptionPos; safe: SafeArea
}): Promise<Buffer> {
  const { width: W, height: H } = o
  const unit = Math.min(W, H)
  const font = await heavyFont()
  // Sizes from the frame's short side, so a 9:16 phone frame and a 4:3 card read alike
  const big = Math.round(unit * (o.text.length > 16 ? 0.052 : 0.062))
  const small = Math.round(unit * 0.026)
  const tagSize = Math.round(unit * 0.019)
  const pad = Math.round(unit * 0.026)
  const top = o.pos[0] === 't', h = o.pos[1]
  const box = (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: h === 'c' ? 'center' : 'flex-start',
        padding: `${Math.round(pad * 0.8)}px ${pad}px`, borderRadius: Math.round(unit * 0.022),
        background: 'rgba(5,7,13,0.62)', border: `${Math.max(2, Math.round(unit * 0.002))}px solid rgba(226,232,240,0.55)`,
        maxWidth: Math.round(W * (1 - o.safe.left - o.safe.right)),
      }}
    >
      {o.tag ? <div style={{ fontSize: tagSize, letterSpacing: tagSize * 0.28, color: '#fbbf24', fontWeight: 800, marginBottom: Math.round(pad * 0.25) }}>{o.tag.toUpperCase()}</div> : null}
      <div style={{ fontSize: big, lineHeight: 1.05, color: '#ffffff', fontWeight: 800, textAlign: h === 'c' ? 'center' : 'left' }}>{o.text.toUpperCase()}</div>
      {o.sub ? <div style={{ fontSize: small, color: '#cbd5e1', marginTop: Math.round(pad * 0.3), textAlign: h === 'c' ? 'center' : 'left' }}>{o.sub}</div> : null}
    </div>
  )
  const res = new ImageResponse(
    (
      <div
        style={{
          width: W, height: H, display: 'flex', background: 'transparent',
          flexDirection: 'column', justifyContent: top ? 'flex-start' : 'flex-end',
          alignItems: h === 'l' ? 'flex-start' : h === 'r' ? 'flex-end' : 'center',
          paddingTop: Math.round(H * o.safe.top), paddingBottom: Math.round(H * o.safe.bottom),
          paddingLeft: Math.round(W * o.safe.left), paddingRight: Math.round(W * o.safe.right),
          // Satori reads every style value: an undefined one throws
          ...(font ? { fontFamily: 'Inter' } : {}),
        }}
      >
        {box}
      </div>
    ),
    { width: W, height: H, ...(font ? { fonts: [{ name: 'Inter', data: font, weight: 800 as const, style: 'normal' as const }] } : {}) },
  )
  return Buffer.from(await res.arrayBuffer())
}
