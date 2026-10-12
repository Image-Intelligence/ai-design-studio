/**
 * Lighting studio (2026-10-11) - the lit-sphere picture H3 Max Relight is
 * re-lit from, built from lights instead of an uploaded photo (fal's own
 * playground has the same tool).
 *
 * One scene, shared by the page and the server so what the user previews is
 * exactly what is sent: a grey sphere (radius 1, centred) standing on a floor
 * (y = -1), seen by a fixed camera from the front, a little above. Each light
 * sits on a sphere around it - azimuth (0 = from the camera, + = to the
 * right), elevation (0 = level, + = above), distance - and always points at
 * it; colour, intensity and softness (a soft light wraps further round the
 * sphere, gives a broader highlight and a softer shadow). Ambient fill lifts
 * everything a little, like light bounced off the room.
 *
 * renderLighting draws it into an RGBA buffer, pixel by pixel (a sphere and a
 * plane - no WebGL needed): the page at preview size while sliders move, the
 * server at full size for the picture fal gets (/api/video/lighting-reference).
 */

export type StudioLight = {
  id: string
  /** #rrggbb */
  color: string
  /** degrees, -180..180; 0 = from the camera, + = to the right */
  azimuth: number
  /** degrees, -10..90; 0 = level with the sphere */
  elevation: number
  /** 1..6 sphere radii out (3 = the reference distance) */
  distance: number
  /** 0..3 */
  intensity: number
  /** 0..1 */
  softness: number
}
export type LightingScene = { lights: StudioLight[]; ambient: number }

export const MAX_STUDIO_LIGHTS = 4
export const LIGHT_LIMITS = {
  azimuth: [-180, 180], elevation: [-10, 90], distance: [1, 6], intensity: [0, 3], softness: [0, 1], ambient: [0, 0.6],
} as const
export const LIGHT_COLORS = ['#FFD6A3', '#9B66FF', '#7EC8FF', '#FF7A7A']

export const DEFAULT_LIGHTING: LightingScene = {
  lights: [
    { id: 'l1', color: '#FFD6A3', azimuth: 65, elevation: 25, distance: 3, intensity: 1.5, softness: 0.3 },
    { id: 'l2', color: '#9B66FF', azimuth: -45, elevation: 20, distance: 3, intensity: 1.5, softness: 0.3 },
  ],
  ambient: 0.08,
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def)

/** A scene from anywhere (the request body, local state), kept to what the studio allows. */
export function sanitizeLighting(raw: unknown): LightingScene {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const lights = (Array.isArray(r.lights) ? r.lights : []).slice(0, MAX_STUDIO_LIGHTS).map((l: any, i: number) => ({
    id: typeof l?.id === 'string' ? l.id.slice(0, 24) : `l${i + 1}`,
    color: typeof l?.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color.toUpperCase() : LIGHT_COLORS[i % LIGHT_COLORS.length],
    azimuth: num(l?.azimuth, -180, 180, 0),
    elevation: num(l?.elevation, -10, 90, 20),
    distance: num(l?.distance, 1, 6, 3),
    intensity: num(l?.intensity, 0, 3, 1.5),
    softness: num(l?.softness, 0, 1, 0.3),
  }))
  return { lights, ambient: num(r.ambient, 0, 0.6, 0.08) }
}

type V3 = [number, number, number]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const rad = (d: number) => (d * Math.PI) / 180
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t) }
const hexRgb = (h: string): V3 => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

/** Where a light is, in the scene (the sphere's centre is the origin, radius 1). */
export function lightPosition(l: Pick<StudioLight, 'azimuth' | 'elevation' | 'distance'>): V3 {
  const a = rad(l.azimuth), e = rad(l.elevation), d = 1 + l.distance * 1.2
  return [Math.sin(a) * Math.cos(e) * d, Math.sin(e) * d, Math.cos(a) * Math.cos(e) * d]
}

// The camera: orthographic, from the front and 14 degrees up, framing the sphere and some floor
const TILT = rad(14)
const VIEW: V3 = [0, Math.sin(TILT), Math.cos(TILT)]
const UP: V3 = [0, Math.cos(TILT), -Math.sin(TILT)]
const SPAN = 3.7
const V_OFFSET = -0.32
// Exposure: two 1.5 lights at distance 3 light the sphere like a studio, not a flash
const EXPOSURE = 0.42

/** The scene into an RGBA buffer (w x h). */
export function renderLighting(scene: LightingScene, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4))
  const L = scene.lights.filter(l => l.intensity > 0).map(l => {
    const p = lightPosition(l)
    return { p, rgb: hexRgb(l.color), i: l.intensity * EXPOSURE, s: l.softness, ref: len(p) }
  })
  const amb = scene.ambient
  const sky: V3 = [0.55, 0.58, 0.66]
  const aspect = w / h
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const su = ((i + 0.5) / w - 0.5) * SPAN * Math.max(1, aspect)
      const sv = (0.5 - (j + 0.5) / h) * SPAN * Math.max(1, 1 / aspect) + V_OFFSET
      let c: V3
      const r2 = su * su + sv * sv
      if (r2 < 1) {
        // The sphere: its normal is the point itself
        const wv = Math.sqrt(1 - r2)
        const n: V3 = [su, sv * UP[1] + wv * VIEW[1], sv * UP[2] + wv * VIEW[2]]
        const albedo = 0.78
        // Ambient: more from above (the room), a little bounce from the floor
        const skyK = amb * (0.65 + 0.35 * n[1]) + amb * 0.25 * Math.max(0, -n[1])
        c = [albedo * sky[0] * skyK, albedo * sky[1] * skyK, albedo * sky[2] * skyK]
        for (const l of L) {
          const toL = sub(l.p, n)
          const d = len(toL)
          const ld: V3 = [toL[0] / d, toL[1] / d, toL[2] / d]
          const fall = l.i * (l.ref / d) * (l.ref / d)
          // Wrap: a soft light reaches past the terminator
          const wrap = 0.15 + l.s * 0.75
          const diff = Math.max(0, (dot(n, ld) + wrap) / (1 + wrap))
          const hv = norm([ld[0] + VIEW[0], ld[1] + VIEW[1], ld[2] + VIEW[2]])
          const shin = 140 - l.s * 125
          const spec = Math.pow(Math.max(0, dot(n, hv)), shin) * (0.55 - l.s * 0.35)
          const k = fall * (albedo * diff * diff)
          c[0] += l.rgb[0] * (k + fall * spec); c[1] += l.rgb[1] * (k + fall * spec); c[2] += l.rgb[2] * (k + fall * spec)
        }
      } else {
        // The floor (y = -1) where the view ray meets it; the backdrop beyond
        const o: V3 = [su, sv * UP[1] + 20 * VIEW[1], sv * UP[2] + 20 * VIEW[2]]
        const t = (o[1] + 1) / VIEW[1]
        const p: V3 = [o[0], o[1] - t * VIEW[1], o[2] - t * VIEW[2]]
        // A dark studio backdrop, tinted by the lights in the room
        const back: V3 = [0.018 + amb * 0.12, 0.018 + amb * 0.12, 0.024 + amb * 0.15]
        for (const l of L) { back[0] += l.rgb[0] * l.i * 0.03; back[1] += l.rgb[1] * l.i * 0.03; back[2] += l.rgb[2] * l.i * 0.03 }
        if (t <= 0) {
          c = back
        } else {
          const albedo = 0.38
          const rr = Math.hypot(p[0], p[2])
          // Contact shadow under the sphere
          const ao = 0.3 + 0.7 * smooth(0, 1.5, rr)
          const fk = amb * ao
          let f: V3 = [albedo * sky[0] * fk, albedo * sky[1] * fk, albedo * sky[2] * fk]
          for (const l of L) {
            const toL = sub(l.p, p)
            const d = len(toL)
            const ld: V3 = [toL[0] / d, toL[1] / d, toL[2] / d]
            const ndl = Math.max(0, ld[1])
            const fall = l.i * (l.ref / d) * (l.ref / d)
            // The sphere's shadow: how close the path to the light passes the sphere,
            // softened by the light's softness and how far the floor is from the sphere
            const tt = clamp(-dot(p, toL) / dot(toL, toL), 0, 1)
            const cl: V3 = [p[0] + toL[0] * tt, p[1] + toL[1] * tt, p[2] + toL[2] * tt]
            const pen = (0.06 + l.s * 0.55) * (0.5 + tt * d * 0.35)
            const lit = smooth(1 - pen, 1 + pen, len(cl))
            const k = albedo * fall * ndl * lit
            f[0] += l.rgb[0] * k; f[1] += l.rgb[1] * k; f[2] += l.rgb[2] * k
          }
          // The floor fades into the backdrop with distance
          const fade = smooth(2.6, 6.5, Math.hypot(p[0], p[2] + 0.4))
          f = [f[0] * (1 - fade) + back[0] * fade, f[1] * (1 - fade) + back[1] * fade, f[2] * (1 - fade) + back[2] * fade]
          c = f
        }
      }
      // Filmic-ish tone curve, then gamma
      const k = (i + j * w) * 4
      out[k] = 255 * Math.pow(1 - Math.exp(-c[0] * 1.6), 1 / 2.2)
      out[k + 1] = 255 * Math.pow(1 - Math.exp(-c[1] * 1.6), 1 / 2.2)
      out[k + 2] = 255 * Math.pow(1 - Math.exp(-c[2] * 1.6), 1 / 2.2)
      out[k + 3] = 255
    }
  }
  return out
}

/** The picture fal gets: 1024 x 1024. */
export const LIGHTING_PICTURE_SIZE = 1024
