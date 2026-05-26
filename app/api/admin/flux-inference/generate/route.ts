import { NextResponse } from 'next/server'
import { getUserFromSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { isAdminEmail } from '@/lib/ticket-gate'

const RUNPOD_API   = 'https://api.runpod.ai/v2'
const COMFYUI_URL  = 'http://localhost:8188'
const POLL_TIMEOUT = 120_000 // 2 min max for ComfyUI poll

// Build a ComfyUI API-format workflow for Flux + optional LoRAs
function buildFluxWorkflow(opts: {
  checkpoint: string
  loras: Array<{ name: string; strength: number }>
  prompt: string
  width: number
  height: number
  steps: number
  guidance: number
  seed: number
}): Record<string, unknown> {
  const { checkpoint, loras, prompt, width, height, steps, guidance, seed } = opts
  const nodes: Record<string, unknown> = {}
  let nextId = 1

  // Checkpoint loader
  const ckptId = String(nextId++)
  nodes[ckptId] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: checkpoint },
  }

  // Chain LoRA loaders
  let modelRef: [string, number] = [ckptId, 0]
  let clipRef:  [string, number] = [ckptId, 1]
  for (const lora of loras) {
    const lid = String(nextId++)
    nodes[lid] = {
      class_type: 'LoraLoader',
      inputs: {
        model:          modelRef,
        clip:           clipRef,
        lora_name:      lora.name,
        strength_model: lora.strength,
        strength_clip:  lora.strength,
      },
    }
    modelRef = [lid, 0]
    clipRef  = [lid, 1]
  }

  // Positive CLIP encode
  const posId = String(nextId++)
  nodes[posId] = {
    class_type: 'CLIPTextEncode',
    inputs: { clip: clipRef, text: prompt },
  }

  // Negative CLIP encode (empty for Flux)
  const negId = String(nextId++)
  nodes[negId] = {
    class_type: 'CLIPTextEncode',
    inputs: { clip: clipRef, text: '' },
  }

  // Guidance conditioning (FluxGuidance wraps the positive)
  const guidanceId = String(nextId++)
  nodes[guidanceId] = {
    class_type: 'FluxGuidance',
    inputs: { conditioning: [posId, 0], guidance },
  }

  // Empty latent
  const latentId = String(nextId++)
  nodes[latentId] = {
    class_type: 'EmptyLatentImage',
    inputs: { width, height, batch_size: 1 },
  }

  // KSampler
  const sampId = String(nextId++)
  nodes[sampId] = {
    class_type: 'KSampler',
    inputs: {
      model:        modelRef,
      positive:     [guidanceId, 0],
      negative:     [negId, 0],
      latent_image: [latentId, 0],
      seed,
      steps,
      cfg:          1.0,
      sampler_name: 'euler',
      scheduler:    'simple',
      denoise:      1.0,
    },
  }

  // VAE decode
  const vaeId = String(nextId++)
  nodes[vaeId] = {
    class_type: 'VAEDecode',
    inputs: { samples: [sampId, 0], vae: [ckptId, 2] },
  }

  // Save image — unique prefix keeps filenames distinct
  const saveId = String(nextId++)
  nodes[saveId] = {
    class_type: 'SaveImage',
    inputs: { images: [vaeId, 0], filename_prefix: `flux_custom_${Date.now()}` },
  }

  return nodes
}

// Poll ComfyUI history until the prompt completes or times out
async function pollComfyHistory(promptId: string): Promise<{ filename: string; subfolder: string } | null> {
  const deadline = Date.now() + POLL_TIMEOUT
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500))
    try {
      const res = await fetch(`${COMFYUI_URL}/history/${promptId}`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const data = await res.json() as Record<string, unknown>
      const entry = data[promptId] as Record<string, unknown> | undefined
      if (!entry) continue
      // outputs are present when done
      const outputs = entry.outputs as Record<string, { images?: Array<{ filename: string; subfolder: string }> }> | undefined
      if (!outputs) continue
      for (const nodeOut of Object.values(outputs)) {
        if (nodeOut.images?.length) return nodeOut.images[0]
      }
    } catch { /* keep polling */ }
  }
  return null
}

export async function POST(req: Request) {
  // Require admin password header OR a session belonging to an admin email
  const adminPass = process.env.ADMIN_PASSWORD
  const hasAdminPass = adminPass && req.headers.get('x-admin-password') === adminPass
  if (!hasAdminPass) {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value
    const sessionUser = token ? await getUserFromSession(token) : null
    if (!sessionUser || !isAdminEmail(sessionUser.email ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: {
    mode: 'local' | 'runpod'
    prompt: string
    checkpoint: string
    loras: Array<{ name?: string; r2_key?: string; strength: number }>
    width?: number
    height?: number
    steps?: number
    guidance?: number
    seed?: number | null
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { mode, prompt, checkpoint, loras = [], width = 1024, height = 1024, steps = 20, guidance = 3.5 } = body
  const seed = (body.seed == null || body.seed === -1) ? Math.floor(Math.random() * 2 ** 32) : body.seed

  // ── RunPod mode ─────────────────────────────────────────────────────────────
  if (mode === 'runpod') {
    const endpointId = process.env.RUNPOD_ENDPOINT_ID
    const apiKey     = process.env.RUNPOD_API_KEY
    if (!endpointId || !apiKey)
      return NextResponse.json({ error: 'RunPod not configured' }, { status: 500 })

    const payload = {
      action:            'inference',
      prompt,
      checkpoint_r2_key: checkpoint,
      loras: loras.map(l => ({ r2_key: l.r2_key ?? l.name, strength: l.strength })),
      width, height, steps, guidance, seed,
    }

    const res = await fetch(`${RUNPOD_API}/${endpointId}/run`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ input: payload }),
    })
    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `RunPod error: ${err}` }, { status: res.status })
    }
    const data = await res.json() as { id: string }
    return NextResponse.json({ mode: 'runpod', job_id: data.id })
  }

  // ── Local (ComfyUI) mode ────────────────────────────────────────────────────
  const workflow = buildFluxWorkflow({
    checkpoint,
    loras: loras.map(l => ({ name: l.name ?? '', strength: l.strength })),
    prompt, width, height, steps, guidance, seed,
  })

  let promptRes: Response
  try {
    promptRes = await fetch(`${COMFYUI_URL}/prompt`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ prompt: workflow }),
      signal:  AbortSignal.timeout(10_000),
    })
  } catch {
    return NextResponse.json({ error: 'ComfyUI is not running (localhost:8188 unreachable)' }, { status: 503 })
  }

  if (!promptRes.ok) {
    const txt = await promptRes.text()
    return NextResponse.json({ error: `ComfyUI rejected workflow: ${txt}` }, { status: 502 })
  }

  const { prompt_id: promptId } = await promptRes.json() as { prompt_id: string }

  // Poll for completion
  const imgInfo = await pollComfyHistory(promptId)
  if (!imgInfo) return NextResponse.json({ error: 'ComfyUI timed out — generation took too long' }, { status: 504 })

  // Fetch the image bytes from ComfyUI
  const viewUrl = `${COMFYUI_URL}/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder)}&type=output`
  const imgRes  = await fetch(viewUrl, { signal: AbortSignal.timeout(30_000) })
  if (!imgRes.ok) return NextResponse.json({ error: 'Failed to fetch image from ComfyUI' }, { status: 502 })

  const buf     = Buffer.from(await imgRes.arrayBuffer())
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`

  return NextResponse.json({ mode: 'local', image_data_url: dataUrl, seed })
}
