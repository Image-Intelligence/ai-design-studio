/**
 * The 3D Production Studio's tools - every fal model it runs, read off fal's
 * live OpenAPI schemas on 2026-10-07 (scratchpad 3d/schemas.txt), with:
 *
 *   - `build`: the exact fal input, from what the bench gathered. Explicit per
 *     tool: the families name everything differently (Hunyuan input_image_url,
 *     Tripo mesh_url, Meshy model_url...) and a wrong name fails late - fal
 *     accepts the job and 422s when the result is read.
 *   - `usd`: what one run costs at fal for THESE options (texture, PBR, rig,
 *     clips...), from fal's published prices; where fal bills in units/credits
 *     with no published total the figure is the measured one (see VERIFIED).
 *   - tickets: ceil(usd / $0.04) - the house rule (lib/ticket-pricing): a 50%
 *     margin on the cheapest ticket anyone can buy ($0.08 subscription).
 *
 * Client-safe: the bench prices and validates with it, the route charges with it.
 */

export type ThreeDStage = 'concept' | 'model' | 'refine' | 'rig' | 'world'
export type Purpose = 'print' | 'game' | 'animation' | 'hero' | 'fast' | 'ar' | 'web'

export type Control = {
  key: string
  label: string
  kind: 'select' | 'toggle' | 'number' | 'text'
  options?: { value: string | number; label: string }[]
  /** What is sent when the user leaves it alone (always sent - no hidden fal defaults). */
  def?: string | number | boolean
  min?: number
  max?: number
  placeholder?: string
  help?: string
  required?: boolean
  /** Shown only when another control has this value. */
  when?: { key: string; is: unknown }
}

/** What the bench hands a tool. Media are URLs the account owns. */
export type ToolInput = {
  prompt?: string
  images?: string[]
  mesh?: string
  options: Record<string, unknown>
}

export type ThreeDTool = {
  id: string
  label: string
  family: string
  endpoint: string
  stage: ThreeDStage
  /** What it needs from the bench. */
  needs: { prompt?: 'required' | 'optional'; images?: { min: number; max: number }; mesh?: boolean; meshExt?: string[] }
  /** What comes back, in a line. */
  output: string
  /** The formats it hands back (the Export step offers the rest by conversion in the browser). */
  formats: string[]
  purposes: Purpose[]
  bestFor: string
  caveat?: string
  /** Typical minutes, so the bench can say how long to expect. */
  minutes: number
  controls: Control[]
  build: (i: ToolInput) => Record<string, unknown>
  /** fal's price for these options; `n.images` = how many pictures go with it. */
  usd: (o: Record<string, unknown>, n: { images: number }) => number
  /** A different endpoint for some options (a Fast variant). */
  endpointFor?: (o: Record<string, unknown>) => string
  /** Admin-only while untested or very expensive. */
  admin?: boolean
}

/** fal's cost of one run with these options (defaults filled in). */
export const toolUsd = (tool: ThreeDTool, options: Record<string, unknown>, images = 0) => tool.usd(withDefaults(tool, options), { images })
/** The house margin rule: ceil(usd / $0.04), never under 1. */
export const toolTickets = (tool: ThreeDTool, options: Record<string, unknown>, images = 0) => Math.max(1, Math.ceil(toolUsd(tool, options, images) / 0.04 - 1e-9))
/** The endpoint one run goes to. */
export const toolEndpoint = (tool: ThreeDTool, options: Record<string, unknown>) => tool.endpointFor?.(withDefaults(tool, options)) ?? tool.endpoint

/** The options as they will be sent: every control's value, defaults filled in. */
export function withDefaults(tool: ThreeDTool, options: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of tool.controls) {
    const v = options[c.key]
    out[c.key] = v === undefined || v === '' || v === null ? c.def : v
  }
  return out
}

const sel = (key: string, label: string, opts: (string | number | [string | number, string])[], def: string | number, help?: string): Control =>
  ({ key, label, kind: 'select', options: opts.map(o => Array.isArray(o) ? { value: o[0], label: o[1] } : { value: o, label: String(o) }), def, help })
const tog = (key: string, label: string, def: boolean, help?: string): Control => ({ key, label, kind: 'toggle', def, help })
const num = (key: string, label: string, def: number | undefined, min: number, max: number, help?: string): Control => ({ key, label, kind: 'number', def, min, max, help })
const on = (v: unknown) => v === true || v === 'true'
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(k => o[k] !== undefined && o[k] !== '' && o[k] !== null).map(k => [k, o[k]]))

// ── Meshy 7.1 ────────────────────────────────────────────────────────────────
const MESHY_CONTROLS: Control[] = [
  sel('topology', 'Topology', [['triangle', 'Triangles'], ['quad', 'Quads']], 'triangle', 'Quads for modelling packages and subdivision'),
  num('target_polycount', 'Target polycount', 30000, 100, 300000),
  sel('model_type', 'Detail', [['standard', 'Standard'], ['lowpoly', 'Low poly (games)'], ['smart-topology', 'Smart topology']], 'standard'),
  sel('symmetry_mode', 'Symmetry', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], 'auto'),
  tog('enable_pbr', 'PBR maps', true, 'Metallic, roughness and normal maps'),
  sel('pose_mode', 'Pose', [['', 'As drawn'], ['a-pose', 'A-pose'], ['t-pose', 'T-pose']], '', 'A or T-pose for a character you will rig'),
  tog('enable_rigging', 'Auto-rig (humanoid)', false, '+$0.20 at fal - a skinned GLB/FBX with walk and run clips'),
]
const meshyUsd = (o: Record<string, unknown>, textured: boolean) => (textured ? 1.2 : 0.8) + (on(o.enable_rigging) ? 0.2 : 0)
const meshyCommon = (o: Record<string, unknown>) => ({
  ...pick(o, ['topology', 'target_polycount', 'model_type', 'symmetry_mode', 'enable_pbr', 'enable_rigging']),
  ...(o.pose_mode ? { pose_mode: o.pose_mode } : {}),
  should_remesh: true,
})

// ── Tripo ────────────────────────────────────────────────────────────────────
const TRIPO_H31_CONTROLS: Control[] = [
  tog('texture', 'Texture', true),
  sel('texture_quality', 'Texture quality', [['standard', 'Standard'], ['detailed', 'Detailed (+$0.10)']], 'standard'),
  sel('geometry_quality', 'Geometry', [['standard', 'Standard'], ['detailed', 'Detailed (+$0.20)']], 'standard'),
  tog('pbr', 'PBR maps', true),
  tog('quad', 'Quad mesh (+$0.05)', false, 'Clean quads for editing - comes back as FBX'),
  num('face_limit', 'Face limit', undefined, 500, 500000, 'Blank = automatic'),
]
const tripoH31Usd = (o: Record<string, unknown>) =>
  (on(o.texture) ? (o.texture_quality === 'detailed' ? 0.4 : 0.3) : 0.2) + (o.geometry_quality === 'detailed' ? 0.2 : 0) + (on(o.quad) ? 0.05 : 0)
const TRIPO_P2_CONTROLS: Control[] = [
  tog('texture', 'Texture', true),
  sel('texture_quality', 'Texture quality', [['fast', 'Fast'], ['standard', 'Standard'], ['detailed', 'Detailed'], ['extreme', 'Extreme']], 'standard'),
  tog('pbr', 'PBR maps', true),
  tog('quad', 'Quad mesh', false),
  num('face_limit', 'Face limit', undefined, 500, 500000, 'Blank = automatic'),
]
const tripoP2Usd = (o: Record<string, unknown>) => (on(o.texture) ? ({ fast: 1.1, standard: 1.1, detailed: 1.2, extreme: 1.3 } as Record<string, number>)[String(o.texture_quality)] ?? 1.1 : 1.0) + (on(o.quad) ? 0.05 : 0)

// ── Hunyuan 3D 3.1 ───────────────────────────────────────────────────────────
const HUNYUAN_PRO_CONTROLS: Control[] = [
  sel('generate_type', 'Output', [['Normal', 'Geometry + texture'], ['Geometry', 'Geometry only']], 'Normal'),
  tog('enable_pbr', 'PBR maps (+$0.15)', false),
  num('face_count', 'Face count', 500000, 40000, 1500000, 'Changing it from 500,000 adds $0.15'),
]
const hunyuanProUsd = (o: Record<string, unknown>, extraViews: boolean) =>
  0.375 + (on(o.enable_pbr) ? 0.15 : 0) + (extraViews ? 0.15 : 0) + (Number(o.face_count ?? 500000) !== 500000 ? 0.15 : 0)

export const THREED_TOOLS: ThreeDTool[] = [
  // ══ CONCEPT: pictures that make better models ═════════════════════════════
  {
    id: 'qwen-angles', label: 'Turnaround views', family: 'Qwen', stage: 'concept',
    endpoint: 'fal-ai/qwen-image-edit-2511-multiple-angles',
    needs: { images: { min: 1, max: 1 }, prompt: 'optional' },
    output: 'The same subject from another angle - front, side, back, above',
    formats: ['png'], purposes: ['hero', 'game', 'print'], minutes: 0.5,
    bestFor: 'One concept picture into the side and back views multi-view models (Hunyuan Pro, Tripo, Meshy) use to get the hidden sides right.',
    controls: [
      sel('horizontal_angle', 'Turn', [[0, 'Front'], [45, '45°'], [90, 'Right side'], [135, '135°'], [180, 'Back'], [270, 'Left side']], 90),
      sel('vertical_angle', 'Height', [[0, 'Eye level'], [30, 'From above'], [-20, 'From below']], 0),
      sel('num_images', 'Pictures', [1, 2, 3, 4], 1),
    ],
    build: i => ({ image_urls: i.images!.slice(0, 1), horizontal_angle: Number(i.options.horizontal_angle), vertical_angle: Number(i.options.vertical_angle), num_images: Number(i.options.num_images), output_format: 'png', ...(i.prompt ? { additional_prompt: i.prompt } : {}) }),
    usd: o => 0.04 * Number(o.num_images ?? 1),
  },
  {
    id: 'patina', label: 'PBR maps from a picture', family: 'Patina', stage: 'concept',
    endpoint: 'fal-ai/patina',
    needs: { images: { min: 1, max: 1 } },
    output: 'Base colour, normal, roughness, metalness and height maps',
    formats: ['png'], purposes: ['game', 'hero'], minutes: 0.5,
    bestFor: 'A photo of a surface into a full PBR material set for a game engine or Blender.',
    controls: [],
    build: i => ({ image_url: i.images![0], output_format: 'png' }),
    usd: () => 0.06,
  },
  {
    id: 'patina-material', label: 'Tileable material', family: 'Patina', stage: 'concept',
    endpoint: 'fal-ai/patina/material',
    needs: { prompt: 'required' },
    output: 'A seamless, tileable PBR material set from a description',
    formats: ['png'], purposes: ['game', 'hero'], minutes: 0.5,
    bestFor: '"Mossy cobblestone", "brushed steel" - a tiling texture with all its PBR maps.',
    controls: [sel('image_size', 'Size', [['square_hd', '1024 square'], ['square', '512 square']], 'square_hd')],
    build: i => ({ prompt: i.prompt, image_size: i.options.image_size, output_format: 'png' }),
    usd: () => 0.06,
  },

  // ══ MODEL: pictures or words into meshes ══════════════════════════════════
  {
    id: 'meshy-7.1-image', label: 'Meshy 7.1', family: 'Meshy', stage: 'model',
    endpoint: 'meshy/v7.1/image-to-3d',
    needs: { images: { min: 1, max: 1 }, prompt: 'optional' },
    output: 'Textured mesh - GLB, FBX, OBJ, USDZ, STL - with PBR maps',
    formats: ['glb', 'fbx', 'obj', 'usdz', 'stl'], purposes: ['game', 'print', 'animation', 'ar'], minutes: 3,
    bestFor: 'The all-rounder: clean topology controls, every export format including STL, and it can rig a humanoid in the same run.',
    controls: [tog('should_texture', 'Texture', true, 'Off = bare geometry ($0.80 instead of $1.20)'), ...MESHY_CONTROLS],
    build: i => ({ image_url: i.images![0], should_texture: on(i.options.should_texture), ...meshyCommon(i.options), ...(i.prompt ? { texture_prompt: i.prompt } : {}) }),
    usd: o => meshyUsd(o, on(o.should_texture)),
  },
  {
    id: 'meshy-7.1-text', label: 'Meshy 7.1 (text)', family: 'Meshy', stage: 'model',
    endpoint: 'meshy/v7.1/text-to-3d',
    needs: { prompt: 'required' },
    output: 'Textured mesh from a description - GLB, FBX, OBJ, USDZ, STL',
    formats: ['glb', 'fbx', 'obj', 'usdz', 'stl'], purposes: ['game', 'print', 'animation', 'ar'], minutes: 3,
    bestFor: 'Straight from words to a model when you have no picture yet.',
    controls: [sel('mode', 'Pass', [['full', 'Full (textured)'], ['preview', 'Preview (geometry, $0.80)']], 'full'), ...MESHY_CONTROLS],
    build: i => ({ prompt: i.prompt, mode: i.options.mode, ...meshyCommon(i.options) }),
    usd: o => meshyUsd(o, o.mode !== 'preview'),
  },
  {
    id: 'meshy-7.1-multi', label: 'Meshy 7.1 (multi-view)', family: 'Meshy', stage: 'model',
    endpoint: 'meshy/v7.1/multi-image-to-3d',
    needs: { images: { min: 2, max: 4 } },
    output: 'Textured mesh from 2-4 views of one subject',
    formats: ['glb', 'fbx', 'obj', 'usdz', 'stl'], purposes: ['game', 'print', 'animation'], minutes: 3,
    bestFor: 'A subject you have from several angles (or made with Turnaround views) - the hidden sides come out right.',
    controls: [tog('should_texture', 'Texture', true), ...MESHY_CONTROLS.filter(c => c.key !== 'model_type')],
    build: i => ({ image_urls: i.images!.slice(0, 4), should_texture: on(i.options.should_texture), ...meshyCommon(i.options) }),
    usd: o => meshyUsd(o, on(o.should_texture)),
  },
  {
    id: 'tripo-h3.1-image', label: 'Tripo H3.1', family: 'Tripo', stage: 'model',
    endpoint: 'tripo3d/h3.1/image-to-3d',
    needs: { images: { min: 1, max: 1 } },
    output: 'Mesh with PBR texture - GLB (FBX with quads)',
    formats: ['glb', 'fbx'], purposes: ['fast', 'game', 'web'], minutes: 1.5,
    bestFor: 'Fast and cheap with good texture alignment to the picture - the quick first pass.',
    controls: TRIPO_H31_CONTROLS,
    build: i => ({ image_url: i.images![0], ...pick(i.options, ['texture', 'texture_quality', 'geometry_quality', 'pbr', 'quad', 'face_limit']) }),
    usd: tripoH31Usd,
  },
  {
    id: 'tripo-h3.1-text', label: 'Tripo H3.1 (text)', family: 'Tripo', stage: 'model',
    endpoint: 'tripo3d/h3.1/text-to-3d',
    needs: { prompt: 'required' },
    output: 'Mesh with PBR texture from a description',
    formats: ['glb', 'fbx'], purposes: ['fast', 'game', 'web'], minutes: 1.5,
    bestFor: 'The cheapest words-to-model run - good for blocking out props.',
    controls: TRIPO_H31_CONTROLS,
    build: i => ({ prompt: i.prompt, ...pick(i.options, ['texture', 'texture_quality', 'geometry_quality', 'pbr', 'quad', 'face_limit']) }),
    usd: tripoH31Usd,
  },
  {
    id: 'tripo-h3.1-multi', label: 'Tripo H3.1 (multi-view)', family: 'Tripo', stage: 'model',
    endpoint: 'tripo3d/h3.1/multiview-to-3d',
    needs: { images: { min: 2, max: 4 } },
    output: 'Mesh with PBR texture from several views',
    formats: ['glb', 'fbx'], purposes: ['fast', 'game'], minutes: 1.5,
    bestFor: 'Multi-view at Tripo prices - front, left, back, right.',
    controls: TRIPO_H31_CONTROLS,
    build: i => ({ image_urls: i.images!.slice(0, 4), ...pick(i.options, ['texture', 'texture_quality', 'geometry_quality', 'pbr', 'quad', 'face_limit']) }),
    usd: tripoH31Usd,
  },
  {
    id: 'tripo-p2-image', label: 'Tripo P2', family: 'Tripo', stage: 'model',
    endpoint: 'tripo3d/p2/image-to-3d',
    needs: { images: { min: 1, max: 1 } },
    output: 'High-fidelity mesh with UVs and de-lit texture',
    formats: ['glb', 'fbx'], purposes: ['hero', 'game'], minutes: 2.5,
    bestFor: 'Tripo\'s top tier: extreme texture quality and lighting removed from the texture, so it relights properly in an engine.',
    controls: TRIPO_P2_CONTROLS,
    build: i => ({ image_url: i.images![0], delight: true, export_uv: true, ...pick(i.options, ['texture', 'texture_quality', 'pbr', 'quad', 'face_limit']) }),
    usd: tripoP2Usd,
  },
  {
    id: 'hunyuan-3.1-pro', label: 'Hunyuan 3D 3.1 Pro', family: 'Hunyuan', stage: 'model',
    endpoint: 'fal-ai/hunyuan-3d/v3.1/pro/image-to-3d',
    needs: { images: { min: 1, max: 6 } },
    output: 'Dense, detailed mesh - GLB, OBJ, FBX, USDZ',
    formats: ['glb', 'obj', 'fbx', 'usdz'], purposes: ['hero', 'print'], minutes: 4,
    bestFor: 'Maximum detail (up to 1.5M faces) for hero assets and figurines. Extra views (back, sides) sharpen the hidden sides.',
    caveat: 'Heavy meshes - retopologise before rigging or game use.',
    controls: HUNYUAN_PRO_CONTROLS,
    build: i => {
      const [front, ...rest] = i.images!
      const slots = ['back_image_url', 'left_image_url', 'right_image_url', 'top_image_url', 'bottom_image_url']
      return { input_image_url: front, ...Object.fromEntries(rest.slice(0, 5).map((u, k) => [slots[k], u])), ...pick(i.options, ['generate_type', 'enable_pbr', 'face_count']) }
    },
    usd: (o, n) => hunyuanProUsd(o, n.images > 1),
  },
  {
    id: 'hunyuan-3.1-pro-text', label: 'Hunyuan 3D 3.1 Pro (text)', family: 'Hunyuan', stage: 'model',
    endpoint: 'fal-ai/hunyuan-3d/v3.1/pro/text-to-3d',
    needs: { prompt: 'required' },
    output: 'Dense, detailed mesh from a description',
    formats: ['glb', 'obj', 'fbx', 'usdz'], purposes: ['hero', 'print'], minutes: 4,
    bestFor: 'Detailed sculpt-like results from words.',
    controls: HUNYUAN_PRO_CONTROLS,
    build: i => ({ prompt: i.prompt, ...pick(i.options, ['generate_type', 'enable_pbr', 'face_count']) }),
    usd: o => hunyuanProUsd(o, false),
  },
  {
    id: 'hunyuan-3.1-rapid', label: 'Hunyuan 3D 3.1 Rapid', family: 'Hunyuan', stage: 'model',
    endpoint: 'fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d',
    needs: { images: { min: 1, max: 1 } },
    output: 'Quick textured mesh - GLB / OBJ',
    formats: ['glb', 'obj'], purposes: ['fast', 'web'], minutes: 1,
    bestFor: 'The fastest Hunyuan - for trying an idea before paying for Pro.',
    controls: [tog('enable_pbr', 'PBR maps (+$0.15)', false), tog('enable_geometry', 'Geometry only', false)],
    build: i => ({ input_image_url: i.images![0], ...pick(i.options, ['enable_pbr', 'enable_geometry']) }),
    usd: o => 0.225 + (on(o.enable_pbr) ? 0.15 : 0),
  },
  {
    id: 'rodin-2.5', label: 'Rodin 2.5', family: 'Hyper3D', stage: 'model',
    endpoint: 'fal-ai/hyper3d/rodin/v2.5',
    needs: { images: { min: 0, max: 5 }, prompt: 'optional' },
    output: 'Production mesh - GLB, FBX, OBJ, USDZ or STL, quad or triangle budget',
    formats: ['glb', 'fbx', 'obj', 'usdz', 'stl'], purposes: ['game', 'print', 'animation', 'hero'], minutes: 3,
    bestFor: 'Exact control of the polygon budget (4K quads for games up to 2M triangles for print) and a T/A-pose for rigging.',
    controls: [
      sel('tier', 'Tier', [['Gen-2.5-Low', 'Low'], ['Gen-2.5-Medium', 'Medium'], ['Gen-2.5-High', 'High'], ['Gen-2.5-Extreme-High', 'Extreme high']], 'Gen-2.5-High'),
      sel('quality_mesh_option', 'Mesh budget', ['Auto', '4K Quad', '18K Quad', '50K Quad', '200K Quad', '50K Triangle', '500K Triangle', '2M Triangle'], 'Auto'),
      sel('material', 'Material', [['All', 'All'], ['PBR', 'PBR'], ['Shaded', 'Shaded'], ['None', 'None']], 'PBR'),
      sel('geometry_file_format', 'File', [['glb', 'GLB'], ['fbx', 'FBX'], ['obj', 'OBJ'], ['stl', 'STL'], ['usdz', 'USDZ']], 'glb'),
      tog('TAPose', 'T/A-pose', false, 'Pose a character for rigging'),
      tog('hd_texture', 'HD texture', false),
    ],
    build: i => ({ ...(i.images?.length ? { image_urls: i.images.slice(0, 5) } : {}), prompt: i.prompt ?? '', ...pick(i.options, ['tier', 'quality_mesh_option', 'material', 'geometry_file_format', 'TAPose', 'hd_texture']) }),
    usd: () => 0.4,
  },
  {
    id: 'rodin-2.5-fast', label: 'Rodin 2.5 Fast', family: 'Hyper3D', stage: 'model',
    endpoint: 'fal-ai/hyper3d/rodin/v2.5/fast',
    needs: { images: { min: 0, max: 5 }, prompt: 'optional' },
    output: 'Light mesh for games and the web',
    formats: ['glb', 'fbx', 'obj', 'usdz', 'stl'], purposes: ['fast', 'game', 'web'], minutes: 1,
    bestFor: 'Ten cents, low-poly quads - background props, mobile games, quick looks.',
    controls: [
      sel('quality_mesh_option', 'Mesh budget', ['Auto', '1K Quad', '4K Quad', '8K Quad', '20K Quad', '10K Triangle', '20K Triangle'], 'Auto'),
      sel('geometry_file_format', 'File', [['glb', 'GLB'], ['fbx', 'FBX'], ['obj', 'OBJ'], ['stl', 'STL'], ['usdz', 'USDZ']], 'glb'),
    ],
    build: i => ({ ...(i.images?.length ? { image_urls: i.images.slice(0, 5) } : {}), prompt: i.prompt ?? '', ...pick(i.options, ['quality_mesh_option', 'geometry_file_format']) }),
    usd: () => 0.1,
  },
  {
    id: 'trellis-2', label: 'TRELLIS 2', family: 'TRELLIS', stage: 'model',
    endpoint: 'fal-ai/trellis-2',
    needs: { images: { min: 1, max: 1 } },
    output: 'Native-3D mesh with UV-unwrapped texture - GLB',
    formats: ['glb'], purposes: ['hero', 'game'], minutes: 2,
    bestFor: 'Open-weights native 3D - strong on organic shapes, with a vertex target for the budget.',
    controls: [
      sel('resolution', 'Resolution', [[512, '512 ($0.25)'], [1024, '1024 ($0.30)'], [1536, '1536 ($0.35)']], 1024),
      sel('texture_size', 'Texture', [[1024, '1K'], [2048, '2K'], [4096, '4K']], 2048),
      num('decimation_target', 'Vertex target', 300000, 5000, 2000000),
    ],
    build: i => ({ image_url: i.images![0], remesh: true, ...pick(i.options, ['resolution', 'texture_size', 'decimation_target']) }),
    usd: o => ({ 512: 0.25, 1024: 0.3, 1536: 0.35 } as Record<number, number>)[Number(o.resolution)] ?? 0.3,
  },
  {
    id: 'hi3d-3.0', label: 'Hi3D 3.0', family: 'Hi3D', stage: 'model',
    endpoint: 'hitem3d/hi3d/v3.0/image-to-3d',
    needs: { images: { min: 1, max: 1 } },
    output: 'Studio-grade mesh - GLB, OBJ, STL, FBX, USDZ',
    formats: ['glb', 'obj', 'stl', 'fbx', 'usdz'], purposes: ['hero', 'print'], minutes: 9,
    bestFor: 'Collectible-grade detail for figurines and print; opens the Hi3D follow-ups (split with joints, multicolour).',
    caveat: 'Slow (about nine minutes) and expensive - $2.10 at fal ($9.10 Master).',
    controls: [
      sel('resolution', 'Grade', [['2048quality', 'Quality ($2.10)'], ['2048master', 'Master ($9.10)']], '2048quality'),
      sel('export_format', 'File', [['glb', 'GLB'], ['stl', 'STL'], ['obj', 'OBJ'], ['fbx', 'FBX'], ['usdz', 'USDZ']], 'glb'),
      tog('enable_texture', 'Texture', true), tog('enable_pbr', 'PBR maps', true),
    ],
    build: i => ({ image_url: i.images![0], ...pick(i.options, ['resolution', 'export_format', 'enable_texture', 'enable_pbr']) }),
    usd: o => (o.resolution === '2048master' ? 9.1 : 2.1),
  },

  // ══ REFINE: a mesh, made usable ═══════════════════════════════════════════
  {
    id: 'meshy-6-lite-retexture', label: 'Retexture (Meshy)', family: 'Meshy', stage: 'refine',
    endpoint: 'meshy/v6-lite/retexture',
    needs: { mesh: true, prompt: 'optional', images: { min: 0, max: 1 } },
    output: 'Same geometry, new material - GLB, FBX, OBJ, USDZ, STL + PBR maps',
    formats: ['glb', 'fbx', 'obj', 'usdz', 'stl'], purposes: ['game', 'hero', 'print'], minutes: 2,
    bestFor: 'Keep the shape, change what it is made of - describe it ("weathered bronze") or show a style picture.',
    controls: [tog('enable_pbr', 'PBR maps', true), tog('enable_original_uv', 'Keep original UVs', true)],
    build: i => ({ model_url: i.mesh, ...(i.prompt ? { text_style_prompt: i.prompt.slice(0, 600) } : {}), ...(i.images?.[0] ? { image_style_url: i.images[0] } : {}), ...pick(i.options, ['enable_pbr', 'enable_original_uv']) }),
    usd: () => 0.3,
  },
  {
    id: 'trellis-2-retexture', label: 'Retexture from a picture', family: 'TRELLIS', stage: 'refine',
    endpoint: 'fal-ai/trellis-2/retexture',
    needs: { mesh: true, images: { min: 1, max: 1 } },
    output: 'The mesh painted to match a reference picture - GLB',
    formats: ['glb'], purposes: ['game', 'hero'], minutes: 2,
    bestFor: 'Painting bare or badly textured geometry from a concept picture.',
    controls: [sel('resolution', 'Resolution', [[512, '512'], [1024, '1024']], 1024), sel('texture_size', 'Texture', [[1024, '1K'], [2048, '2K'], [4096, '4K']], 2048)],
    build: i => ({ mesh_url: i.mesh, image_url: i.images![0], ...pick(i.options, ['resolution', 'texture_size']) }),
    usd: o => (Number(o.resolution) === 512 ? 0.2 : 0.24),
  },
  {
    id: 'tripo-remesh', label: 'Clean topology (Tripo)', family: 'Tripo', stage: 'refine',
    endpoint: 'tripo3d/tripo/remesh',
    needs: { mesh: true },
    output: 'Retopologised mesh at a face budget, texture baked',
    formats: ['glb', 'fbx'], purposes: ['game', 'animation'], minutes: 2,
    bestFor: 'THE step from a generated blob to a game-ready asset: a face budget, quads for rigging, texture baked across.',
    controls: [num('face_limit', 'Face budget', 10000, 500, 20000, 'Quads max 10,000'), tog('quad', 'Quads', true, 'Comes back as FBX'), tog('bake', 'Bake texture', true)],
    build: i => ({ mesh_url: i.mesh, ...pick(i.options, ['face_limit', 'quad', 'bake']) }),
    // Measured by fal balance delta 2026-10-07 (quads + bake): $0.35 - fal lists only "$0.01/unit"
    usd: () => 0.35,
  },
  {
    id: 'hunyuan-smart-topology', label: 'Smart topology (Hunyuan)', family: 'Hunyuan', stage: 'refine',
    endpoint: 'fal-ai/hunyuan-3d/v3.1/smart-topology',
    needs: { mesh: true },
    output: 'Artist-style retopology - triangles or quads at three densities',
    formats: ['glb'], purposes: ['game', 'animation'], minutes: 3,
    bestFor: 'The alternative retopologiser - try it when Tripo mangles a shape.',
    controls: [sel('polygon_type', 'Polygons', [['quadrilateral', 'Quads'], ['triangle', 'Triangles']], 'quadrilateral'), sel('face_level', 'Density', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], 'medium')],
    build: i => ({ input_file_url: i.mesh, input_file_type: /\.obj(\?|$)/i.test(i.mesh!) ? 'obj' : 'glb', ...pick(i.options, ['polygon_type', 'face_level']) }),
    usd: () => 0.75,
  },
  {
    id: 'tripo-segment', label: 'Name the parts (Tripo)', family: 'Tripo', stage: 'refine',
    endpoint: 'tripo3d/tripo/segment',
    needs: { mesh: true },
    output: 'The mesh split into named semantic parts',
    formats: ['glb'], purposes: ['game', 'print'], minutes: 2,
    bestFor: 'A model into parts that know what they are - handle, lid, wheel - to recolour, swap or print apart.',
    controls: [],
    build: i => ({ mesh_url: i.mesh }),
    // Measured by fal balance delta 2026-10-07: $0.40 ("$0.01/unit" on fal)
    usd: () => 0.4,
  },
  {
    id: 'hunyuan-part', label: 'Split into parts (Hunyuan)', family: 'Hunyuan', stage: 'refine',
    endpoint: 'fal-ai/hunyuan-3d/v3.1/part',
    // fal takes FBX only here - the quad output of Clean topology (Tripo) is one
    needs: { mesh: true, meshExt: ['fbx'] },
    output: 'One file per part',
    formats: ['fbx'], purposes: ['print', 'game'], minutes: 3,
    bestFor: 'Geometric part split - each piece as its own file.',
    controls: [],
    build: i => ({ input_file_url: i.mesh }),
    usd: () => 0.45,
  },
  {
    id: 'hi3d-split', label: 'Split with joints (print)', family: 'Hi3D', stage: 'refine',
    endpoint: 'hitem3d/hi3d/split',
    needs: { mesh: true },
    output: 'Character split into printable parts with ball or dovetail joints',
    formats: ['glb', 'stl', 'obj', 'fbx', 'usdz'], purposes: ['print'], minutes: 4,
    bestFor: 'Articulated action figures and figurines that print in pieces and snap together.',
    controls: [
      sel('model', 'Kind', [['character', 'Character'], ['general', 'Object']], 'character'),
      sel('joint', 'Joints', [['ball', 'Ball'], ['dovetail', 'Dovetail'], ['none', 'None']], 'ball'),
      sel('level', 'Pieces', [['low', 'Few'], ['medium', 'Some'], ['high', 'Many']], 'medium'),
      sel('export_format', 'File', [['glb', 'GLB'], ['stl', 'STL'], ['obj', 'OBJ']], 'glb', 'Characters always come back as GLB'),
    ],
    // Character splits come back as GLB only (fal refuses any other export_format for them)
    build: i => ({ mesh_url: i.mesh, ...pick(i.options, ['model', 'joint', 'level', 'export_format']), ...(i.options.model === 'character' ? { export_format: 'glb' } : {}) }),
    usd: () => 0.4,
  },
  {
    id: 'hi3d-multicolor', label: 'Multicolour print prep', family: 'Hi3D', stage: 'refine',
    endpoint: 'hitem3d/hi3d/multicolor',
    needs: { mesh: true },
    output: 'The model reduced to 1-8 solid colour regions for multi-material printers',
    formats: ['glb', 'obj', 'fbx'], purposes: ['print'], minutes: 3,
    bestFor: 'Bambu AMS / Prusa MMU style printing: colour per region instead of a texture map.',
    controls: [num('number_of_colors', 'Colours', 4, 1, 8), sel('export_format', 'File', [['glb', 'GLB'], ['obj', 'OBJ'], ['fbx', 'FBX']], 'glb')],
    build: i => ({ mesh_url: i.mesh, ...pick(i.options, ['number_of_colors', 'export_format']) }),
    usd: () => 0.4,
  },
  {
    id: 'hi3d-texture', label: 'Paint from a picture (Hi3D)', family: 'Hi3D', stage: 'refine',
    endpoint: 'hitem3d/hi3d/texture',
    needs: { mesh: true, images: { min: 1, max: 1 } },
    output: 'Textured mesh from a reference image',
    formats: ['glb', 'obj', 'stl', 'fbx', 'usdz'], purposes: ['hero'], minutes: 4,
    bestFor: 'Texturing bare geometry from a reference picture.',
    controls: [sel('resolution', 'Resolution', [['1024', '1024'], ['1536', '1536'], ['1536pro', '1536 Pro']], '1024')],
    build: i => ({ mesh_url: i.mesh, image_url: i.images![0], ...pick(i.options, ['resolution']) }),
    // 1024 measured by fal balance delta 2026-10-07: $0.30 ("$0.02/credit"). The
    // larger textures are not measured yet - priced a step up each, to stay safe
    usd: o => (o.resolution === '1536pro' ? 0.5 : o.resolution === '1536' ? 0.4 : 0.3),
  },

  // ══ RIG & ANIMATE ═════════════════════════════════════════════════════════
  {
    id: 'meshy-rig', label: 'Auto-rig', family: 'Meshy', stage: 'rig',
    endpoint: 'fal-ai/meshy/rigging',
    needs: { mesh: true },
    output: 'Skinned character (GLB + FBX) with walk and run clips',
    formats: ['glb', 'fbx'], purposes: ['animation', 'game'], minutes: 2,
    bestFor: 'A humanoid mesh into a skeleton-driven character ready for Unity, Unreal, Blender - and for the clip library and text-to-motion here.',
    caveat: 'Humanoids only. Best from a T or A-pose model.',
    controls: [num('height_meters', 'Height (m)', 1.7, 0.1, 10)],
    build: i => ({ model_url: i.mesh, ...pick(i.options, ['height_meters']) }),
    // Measured by fal balance delta 2026-10-07: $0.20 (fal's pricing API says $0.80; its docs and the bill say $0.20)
    usd: () => 0.2,
  },
  {
    id: 'meshy-animate', label: 'Animation clips', family: 'Meshy', stage: 'rig',
    endpoint: 'fal-ai/meshy/rigging/multi-animation',
    needs: { mesh: true },
    output: 'Rigged character plus up to 10 clips from the motion library',
    formats: ['glb', 'fbx'], purposes: ['animation', 'game'], minutes: 3,
    bestFor: 'Pick moves from the ~700-clip library (idle, walk, dance, fight...) and get them all on one rig.',
    caveat: 'Humanoids only.',
    controls: [num('height_meters', 'Height (m)', 1.7, 0.1, 10), { key: 'animation_action_ids', label: 'Clips', kind: 'text', def: '0', help: 'Chosen in the clip library' }],
    build: i => ({ model_url: i.mesh, height_meters: Number(i.options.height_meters), animation_action_ids: clipIds(i.options.animation_action_ids) }),
    usd: o => 0.2 + 0.12 * clipIds(o.animation_action_ids).length,
  },
  {
    id: 'hunyuan-motion', label: 'Text to motion', family: 'Hunyuan', stage: 'rig',
    endpoint: 'fal-ai/hunyuan-motion',
    needs: { prompt: 'required' },
    output: 'A motion clip (FBX) - played on your rigged character here',
    formats: ['fbx'], purposes: ['animation'], minutes: 1,
    bestFor: 'Describe a move ("draws a sword, spins, bows") and get it - not limited to a preset list. Up to 12 seconds.',
    caveat: 'Comes on a standard skeleton; the studio maps it onto your rigged character for playback and export.',
    controls: [num('duration', 'Seconds', 5, 0.5, 12), sel('quality', 'Model', [['full', 'Full ($0.08)'], ['fast', 'Fast ($0.06)']], 'full')],
    build: i => ({ prompt: i.prompt, duration: Number(i.options.duration), output_format: 'fbx' }),
    usd: o => (o.quality === 'fast' ? 0.06 : 0.08),
    endpointFor: o => (o.quality === 'fast' ? 'fal-ai/hunyuan-motion/fast' : 'fal-ai/hunyuan-motion'),
  },

  // ══ WORLD: scenes, captures, reliefs ══════════════════════════════════════
  {
    id: 'hunyuan-world', label: 'Picture to world', family: 'Hunyuan', stage: 'world',
    endpoint: 'fal-ai/hunyuan_world/image-to-world',
    needs: { images: { min: 1, max: 1 } },
    output: 'A layered 3D environment from one picture',
    formats: ['zip'], purposes: ['game', 'hero'], minutes: 8,
    bestFor: 'One concept painting into a navigable environment.',
    caveat: 'Name the two foreground objects and the kind of place.',
    controls: [
      { key: 'labels_fg1', label: 'Foreground object 1', kind: 'text', required: true, placeholder: 'e.g. rusted car' },
      { key: 'labels_fg2', label: 'Foreground object 2', kind: 'text', required: true, placeholder: 'e.g. street lamp' },
      sel('classes', 'Place', [['outdoor', 'Outdoor'], ['indoor', 'Indoor']], 'outdoor'),
    ],
    build: i => ({ image_url: i.images![0], ...pick(i.options, ['labels_fg1', 'labels_fg2', 'classes']) }),
    usd: () => 0.3,
  },
  {
    id: 'triposplat', label: 'Gaussian splat', family: 'Tripo', stage: 'world',
    endpoint: 'tripo3d/triposplat',
    needs: { images: { min: 1, max: 1 } },
    output: 'A photoreal Gaussian splat (PLY)',
    formats: ['ply'], purposes: ['hero', 'web'], minutes: 1,
    bestFor: 'Photoreal captured-looking objects and scenes for viewing - not for printing or rigging.',
    controls: [],
    build: i => ({ image_url: i.images![0], output_format: 'ply' }),
    usd: () => 0.05,
  },
  {
    id: 'sam3-objects', label: 'Objects from a photo', family: 'SAM 3D', stage: 'world',
    endpoint: 'fal-ai/sam-3/3d-objects',
    needs: { images: { min: 1, max: 1 }, prompt: 'required' },
    output: 'The named objects in a real photo as separate 3D models',
    formats: ['glb', 'ply'], purposes: ['game', 'web'], minutes: 1,
    bestFor: 'Pull a chair, a car, a vase out of a real photograph as 3D models.',
    controls: [],
    build: i => ({ image_url: i.images![0], prompt: i.prompt, export_textured_glb: true }),
    usd: () => 0.05,
  },
  {
    id: 'sam3-body', label: 'Body & pose from a photo', family: 'SAM 3D', stage: 'world',
    endpoint: 'fal-ai/sam-3/3d-body',
    needs: { images: { min: 1, max: 1 } },
    output: 'A person\'s body shape and pose as a mesh',
    formats: ['glb'], purposes: ['animation'], minutes: 1,
    bestFor: 'A pose reference or a body base for a character.',
    controls: [],
    build: i => ({ image_url: i.images![0], export_meshes: true }),
    usd: () => 0.05,
  },
  {
    id: 'hi3d-relief', label: 'Relief / lithophane map', family: 'Hi3D', stage: 'world',
    endpoint: 'hitem3d/hi3d/image-to-relief',
    needs: { images: { min: 1, max: 1 } },
    output: 'A depth map for reliefs, coins, plaques and lithophanes',
    formats: ['png'], purposes: ['print'], minutes: 1,
    bestFor: 'Flat art into a raised relief - the studio turns the map into a printable STL.',
    controls: [tog('remove_background', 'Remove background', true)],
    build: i => ({ image_url: i.images![0], output_format: 'png', ...pick(i.options, ['remove_background']) }),
    usd: () => 0.1,
  },
]

/** The Meshy clip ids an option holds ("12, 40, 92" or an array), at most 10. */
export function clipIds(v: unknown): number[] {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(/[\s,]+/)
  return [...new Set(raw.map(x => Math.round(Number(x))).filter(n => Number.isFinite(n) && n >= 0 && n <= 696))].slice(0, 10)
}

export const getTool = (id: string | undefined) => THREED_TOOLS.find(t => t.id === id)

export const STAGES: { id: ThreeDStage; label: string; blurb: string }[] = [
  { id: 'concept', label: 'Concept', blurb: 'Pictures that make better models - turnarounds, materials' },
  { id: 'model', label: 'Model', blurb: 'Pictures or words into 3D' },
  { id: 'refine', label: 'Refine', blurb: 'Topology, textures, parts, print prep' },
  { id: 'rig', label: 'Rig & animate', blurb: 'Skeletons, clip library, text to motion' },
  { id: 'world', label: 'Worlds & captures', blurb: 'Environments, splats, photo captures, reliefs' },
]

export const PURPOSE_LABEL: Record<Purpose, string> = {
  print: '3D printing', game: 'Games', animation: 'Animation', hero: 'Hero detail', fast: 'Fast & cheap', ar: 'AR', web: 'Web',
}
