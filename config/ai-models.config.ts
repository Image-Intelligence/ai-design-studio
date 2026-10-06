import { gptImage25TicketCost } from '@/lib/ticket-pricing'
// AI Model Configuration - FAL.ai models (NanoBanana + SeeDream)
// Imagen models require different setup (commented out for now)

export interface AIModel {
  id: string
  name: string
  displayName: string
  description: string
  ticketCost: number
  category: 'standard' | 'premium' | 'ultra'
  rateLimit: {
    rpm: number
    rpd: number
  }
  quality: 'fast' | 'balanced' | 'high' | 'ultra'
  isAvailable: boolean
  provider?: 'gemini' | 'fal'
}

/**
 * Hunyuan Image 3 Instruct bills $0.09 per megapixel and picks its own size
 * ('auto'); set from the size measured in testing, for >=50% at $0.08.
 */
const HUNYUAN_INSTRUCT_TICKETS = 3

export const AI_MODELS: AIModel[] = [
  // NANOBANANA - FAL.ai (Gemini 2.5 Flash Image) - Fast & Cheap - 2 IMAGES!
  {
    id: 'nano-banana',
    name: 'fal-ai/nano-banana',
    displayName: 'NanoBanana Cluster',
    description: 'Fast, artistic generation - 2 tickets for 2 images!',
    ticketCost: 2,
    category: 'standard',
    rateLimit: {
      rpm: 0, // No rate limit on FAL.ai
      rpd: 0  // Unlimited with credits
    },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },

  // NANOBANANA PRO - FAL.ai (Gemini 3 Pro Image) - High Quality
  {
    id: 'nano-banana-pro',
    name: 'fal-ai/nano-banana-pro',
    displayName: 'NanoBanana Pro',
    description: 'Premium quality - 7 tickets (2K) or 14 tickets (4K)',
    ticketCost: 7,
    category: 'premium',
    rateLimit: {
      rpm: 0, // No rate limit on FAL.ai
      rpd: 0  // Unlimited with credits
    },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // NANOBANANA PRO 2 - FAL.ai (Gemini 3 Pro Image 2) - Flagship
  // Was portal-only: the admin scanner drove it through its own
  // /api/admin/nano-banana-2-live route, so it existed nowhere in AI_MODELS.
  // Anything validating against this config — the chat hub included —
  // answered "Model nano-banana-pro-2 is not available".
  {
    id: 'nano-banana-pro-2',
    name: 'fal-ai/nano-banana-2',
    displayName: 'NanoBanana Pro 2',
    description: 'Newest Gemini image model - 7 tickets (2K) or 12 tickets (4K)',
    ticketCost: 7,
    category: 'premium',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // SEEDREAM 4.5 - FAL.ai (ByteDance)
  {
    id: 'seedream-4.5',
    name: 'fal-ai/bytedance/seedream/v4.5/text-to-image',
    displayName: 'SeeDream 4.5',
    description: 'Premium quality with excellent text rendering',
    ticketCost: 2,  // 2 tickets (2K), 4 tickets (4K)
    category: 'standard',
    rateLimit: {
      rpm: 0, // No rate limit on FAL.ai
      rpd: 0  // Unlimited with credits
    },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // FLUX 2 - FAL.ai (Black Forest Labs)
  // FLUX 1 Dev - FAL.ai text-to-image and image-to-image
  {
    id: 'flux-1-dev',
    name: 'fal-ai/flux-1/dev',
    displayName: 'FLUX 1 Dev',
    description: 'FLUX.1 Dev — 2 tickets (1k), 5 tickets (2k), 6 tickets (4k)',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  {
    id: 'flux-2',
    name: 'fal-ai/flux-2',
    displayName: 'FLUX 2',
    description: 'Enhanced realism, crisp text, native editing - 1 ticket',
    ticketCost: 1,
    category: 'standard',
    rateLimit: {
      rpm: 0, // No rate limit on FAL.ai
      rpd: 0  // Unlimited with credits
    },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // DIRECT GEMINI API MODELS (No FAL.ai filtering!)
  
  // PRO SCANNER V3 - Direct Gemini API (Gemini 3 Pro Image Preview)
  {
    id: 'gemini-3-pro-image',
    name: 'gemini-3-pro-image-preview',  // Correct model from Google AI Studio
    displayName: 'Pro Scanner v3',
    description: 'Direct Gemini API - No filtering! 7 tickets (2K) or 15 tickets (4K)',
    ticketCost: 7,
    category: 'premium',
    rateLimit: {
      rpm: 10,
      rpd: 250  // Was 250/day based on Tier 2
    },
    quality: 'high',
    isAvailable: true,
    provider: 'gemini'
  },

  // FLASH SCANNER V2.5 - Direct Gemini API (Gemini 2.5 Flash Image)
  {
    id: 'gemini-2.5-flash-image',
    name: 'gemini-2.5-flash-image',
    displayName: 'Flash Scanner v2.5',
    description: 'Direct Gemini API - Fast generation, no filtering!',
    ticketCost: 1,
    category: 'standard',
    rateLimit: {
      rpm: 100,
      rpd: 2000  // Was 2000/day based on Tier 2
    },
    quality: 'balanced',
    isAvailable: true,
    provider: 'gemini'
  },

  // Z-IMAGE BASE - FAL.ai text-to-image with optional LoRA support
  {
    id: 'z-image-base',
    name: 'fal-ai/z-image/base',
    displayName: 'Z-Image Base',
    description: 'High quality text-to-image with optional LoRA. 1/4/15 tickets (1k/2k/4k)',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // Z-IMAGE TURBO - FAL.ai fast text-to-image with optional LoRA support
  {
    id: 'z-image-turbo',
    name: 'fal-ai/z-image/turbo',
    displayName: 'Z-Image Turbo',
    description: 'Lightning fast text-to-image with optional LoRA. 1/2/8 tickets (1k/2k/4k)',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },

  // CLARITY UPSCALER - fal-ai/clarity-upscaler
  {
    id: 'clarity-upscaler',
    name: 'fal-ai/clarity-upscaler',
    displayName: 'Clarity Upscaler',
    description: 'AI-powered upscaler — 7 tickets (2x) or 26 tickets (4x)',
    ticketCost: 7,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },

  // DRCT Super-Resolution - fal-ai/drct-super-resolution
  {
    id: 'drct',
    name: 'fal-ai/drct-super-resolution',
    displayName: 'DRCT Super-Resolution',
    description: 'Transformer upscaler — 1 ticket per 2 MP of output',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },

  // ESRGAN - fal-ai/esrgan
  {
    id: 'esrgan',
    name: 'fal-ai/esrgan',
    displayName: 'ESRGAN',
    description: 'Real-ESRGAN upscaler — 6 model variants, 1 ticket flat',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },

  // SUPIR - Replicate zust-ai/supir
  {
    id: 'supir',
    name: 'zust-ai/supir',
    displayName: 'SUPIR',
    description: 'LLaVA-guided diffusion upscaler — 8 tickets flat',
    ticketCost: 8,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
  },

  // AURASR - fal-ai/aura-sr
  {
    id: 'aura-sr',
    name: 'fal-ai/aura-sr',
    displayName: 'AuraSR',
    description: 'Fast GAN upscaler optimized for FLUX outputs — 1 ticket flat',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },

  // CHATGPT IMAGES 2.0 - fal-ai/gpt-image-2
  {
    id: 'gpt-image-2',
    name: 'fal-ai/gpt-image-2',
    displayName: 'ChatGPT Images 2.0',
    description: 'OpenAI GPT Image 2 via FAL — text-to-image and image editing',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // CHATGPT IMAGES 2.5 — openai/gpt-image-2.5/{sunburst,flare}/{text-to-image,edit}
  // One entry, two renderers. The renderer is a switch in the prompt bar and
  // the edit endpoint is picked automatically when references are attached.
  // ADMIN ONLY while under test (FAL_IMAGE_MODEL_IDS feeds that gate).
  {
    id: 'gpt-image-2.5',
    name: 'openai/gpt-image-2.5',
    displayName: 'ChatGPT Images 2.5',
    description: 'OpenAI GPT Image 2.5 via FAL — sunburst or flare renderer, text-to-image and editing',
    ticketCost: 3,
    category: 'premium',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'gpt-image-2.5-edit',
    name: 'openai/gpt-image-2.5/edit',
    displayName: 'ChatGPT Images 2.5 Edit',
    description: 'GPT Image 2.5 multi-reference editing — resolved automatically, not shown in the picker',
    ticketCost: 3,
    category: 'premium',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2026-08 FAL IMAGE BATCH — ADMIN ONLY while under test.
  // Gate lives in app/api/generate/route.ts (ADMIN_ONLY_IMAGE_MODELS).
  // Input shapes: lib/fal-image-models.ts (verified against live fal OpenAPI).
  // ═══════════════════════════════════════════════════════════════════════════

  // Qwen Image 3 (Alibaba) - fal $0.04 at 1K (1 ticket), $0.075 at 2K (2); no 4K.
  // The edit costs ~$0.006 more (+1 ticket). /api/generate and the portal
  // price per quality and refs; these are the 2K text-to-image defaults.
  {
    id: 'qwen-image-3',
    name: 'alibaba/qwen-image-3/text-to-image',
    displayName: 'Qwen Image 3',
    description: 'Alibaba Qwen Image 3 text-to-image — strong text rendering',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'qwen-image-3-edit',
    name: 'alibaba/qwen-image-3/edit',
    displayName: 'Qwen Image 3 Edit',
    description: 'Qwen Image 3 multi-reference image editing',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // Reve 2.1
  {
    id: 'reve-2.1',
    name: 'reve/2.1/text-to-image',
    displayName: 'Reve 2.1',
    description: 'Reve 2.1 text-to-image — wide aspect-ratio range (4:1 to 1:4)',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'reve-2.1-edit',
    name: 'reve/2.1/edit',
    displayName: 'Reve 2.1 Edit',
    description: 'Reve 2.1 single-image editing',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // Luma Photon / Photon Flash / Uni-1 / Uni-1 Max (ADMIN ONLY while under
  // test). Priced for a >=50% gross margin at the cheapest ticket anyone can
  // buy ($0.08, a subscription ticket), from fal's rates on 2026-09-28:
  //   Photon      $0.019/MP x ~2.36MP = $0.045  -> 2 tickets ($0.16)
  //   Photon Flash $0.005/MP x ~2.36MP = $0.012 -> 1 ticket  ($0.08)
  //   Uni-1       $0.042 (+$0.003/ref, <=4)     -> 2 tickets
  //   Uni-1 Max   $0.102 (+$0.003/ref, <=4)     -> 3 tickets ($0.24)
  // Modify / reframe / edit bill like their base model.
  ...([
    ['luma-photon', 'fal-ai/luma-photon', 'Luma Photon', 'Luma Photon text-to-image', 2],
    ['luma-photon-modify', 'fal-ai/luma-photon/modify', 'Luma Photon Modify', 'Luma Photon image restyle by instruction', 2],
    ['luma-photon-reframe', 'fal-ai/luma-photon/reframe', 'Luma Photon Reframe', 'Luma Photon outpaint to a new aspect ratio', 2],
    ['luma-photon-flash', 'fal-ai/luma-photon/flash', 'Luma Photon Flash', 'Luma Photon Flash text-to-image (fast)', 1],
    ['luma-photon-flash-modify', 'fal-ai/luma-photon/flash/modify', 'Luma Photon Flash Modify', 'Luma Photon Flash image restyle by instruction', 1],
    ['luma-photon-flash-reframe', 'fal-ai/luma-photon/flash/reframe', 'Luma Photon Flash Reframe', 'Luma Photon Flash outpaint to a new aspect ratio', 1],
    ['luma-uni-1', 'luma/agent/uni-1/v1/text-to-image', 'Luma Uni-1', 'Luma Uni-1 text-to-image with optional references', 2],
    ['luma-uni-1-edit', 'luma/agent/uni-1/v1/edit', 'Luma Uni-1 Edit', 'Luma Uni-1 instruction editing', 2],
    ['luma-uni-1-max', 'luma/agent/uni-1/v1/max', 'Luma Uni-1 Max', 'Luma Uni-1 Max text-to-image', 3],
    ['luma-uni-1-max-edit', 'luma/agent/uni-1/v1/max/edit', 'Luma Uni-1 Max Edit', 'Luma Uni-1 Max instruction editing', 3],
  ] as const).map(([id, name, displayName, description, ticketCost]) => ({
    id, name, displayName, description, ticketCost,
    category: 'standard' as const,
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high' as const,
    isAvailable: true,
    provider: 'fal' as const,
  })),

  // 2026-09-28 batch (ADMIN ONLY while under test), same >=50%-at-$0.08 rule:
  //   Krea 2 Large  $0.060 ($0.065 with style refs) -> 2 tickets
  //   Krea 2 Medium $0.030 ($0.035)                 -> 1
  //   Krea 2 Medium Turbo $0.015 ($0.0175)          -> 1
  //   Hunyuan Image 3  $0.10/MP, presets <= 1.05MP  -> 3
  //   Hunyuan Image 3 Instruct (+edit) $0.09/MP     -> priced from the measured size (below)
  //   Seedream 5.0 Flash (+edit) $0.027             -> 1
  //   Recraft V4.1 Flash $0.007                      -> 1
  ...([
    ['krea-2-large', 'krea/v2/large/text-to-image', 'Krea 2 Large', 'Krea 2 Large text-to-image (images = style references)', 2],
    ['krea-2-medium', 'krea/v2/medium/text-to-image', 'Krea 2 Medium', 'Krea 2 Medium text-to-image', 1],
    ['krea-2-medium-turbo', 'krea/v2/medium/turbo/text-to-image', 'Krea 2 Medium Turbo', 'Krea 2 Medium Turbo text-to-image', 1],
    ['hunyuan-image-3', 'fal-ai/hunyuan-image/v3/text-to-image', 'Hunyuan Image 3', 'Tencent Hunyuan Image 3 text-to-image', 3],
    ['hunyuan-image-3-instruct', 'fal-ai/hunyuan-image/v3/instruct/text-to-image', 'Hunyuan Image 3 Instruct', 'Hunyuan Image 3 Instruct text-to-image', HUNYUAN_INSTRUCT_TICKETS],
    ['hunyuan-image-3-instruct-edit', 'fal-ai/hunyuan-image/v3/instruct/edit', 'Hunyuan Image 3 Instruct Edit', 'Hunyuan Image 3 Instruct editing (up to 3 images)', HUNYUAN_INSTRUCT_TICKETS],
    ['seedream-5-flash', 'bytedance/seedream/v5/flash/text-to-image', 'SeeDream 5.0 Flash', 'SeeDream 5.0 Flash text-to-image', 1],
    ['seedream-5-flash-edit', 'bytedance/seedream/v5/flash/edit', 'SeeDream 5.0 Flash Edit', 'SeeDream 5.0 Flash editing (up to 10 images)', 1],
    ['recraft-v4.1-flash', 'recraft/v4.1/flash/text-to-image', 'Recraft V4.1 Flash', 'Recraft V4.1 Flash text-to-image', 1],
  ] as const).map(([id, name, displayName, description, ticketCost]) => ({
    id, name, displayName, description, ticketCost,
    category: 'standard' as const,
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high' as const,
    isAvailable: true,
    provider: 'fal' as const,
  })),

  // Microsoft MAI Image 2.5 Pro. fal bills tokens: ~$0.17 a text-to-image,
  // $0.18-0.27 an edit with one input image (2026-10-01). 5 tickets ($0.40 at
  // the $0.08 ticket) is ~57%; the edit is 7 so the dearest case still clears 50%.
  {
    id: 'mai-image-2.5-pro',
    name: 'microsoft/mai-image-2.5-pro',
    displayName: 'MAI Image 2.5 Pro',
    description: 'Microsoft MAI Image 2.5 Pro text-to-image',
    ticketCost: 5,
    category: 'premium',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'mai-image-2.5-pro-edit',
    name: 'microsoft/mai-image-2.5-pro/edit',
    displayName: 'MAI Image 2.5 Pro Edit',
    description: 'Microsoft MAI Image 2.5 Pro single-image editing',
    ticketCost: 7,
    category: 'premium',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // xAI Grok Imagine 2
  {
    id: 'grok-imagine-2',
    name: 'xai/grok-imagine-image/v2.0/text-to-image',
    displayName: 'Grok Imagine 2',
    description: 'xAI Grok Imagine 2 text-to-image — 1k/2k resolution',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  // fal 2026-10-01: $0.04/$0.06 (low/medium) at 1K, $0.06/$0.08 at 2K, and the
  // edit adds $0.01 per input image (up to 4). Text-to-image at 2 tickets is a
  // 50%+ margin at the $0.08 subscription ticket even at 2K medium; an edit is
  // 3 tickets so four references at 2K ($0.12) still clear 50%.
  {
    id: 'grok-imagine-2-edit',
    name: 'xai/grok-imagine-image/v2.0/edit',
    displayName: 'Grok Imagine 2 Edit',
    description: 'xAI Grok Imagine 2 multi-reference editing',
    ticketCost: 3,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // Meta Muse - fal $0.01 an image, t2i and edit alike (measured by balance
  // delta 2026-10-02) -> 1 ticket
  {
    id: 'meta-muse',
    name: 'meta/muse-image/text-to-image',
    displayName: 'Meta Muse',
    description: 'Meta Muse Image text-to-image',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'meta-muse-edit',
    name: 'meta/muse-image/edit',
    displayName: 'Meta Muse Edit',
    description: 'Meta Muse Image editing — up to 10 reference images',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // Bria FIBO 1.5
  {
    id: 'bria-fibo',
    name: 'bria/fibo-gen-1.5/text-to-image',
    displayName: 'Bria FIBO 1.5',
    description: 'Bria FIBO 1.5 text-to-image — licensed-data model, 1MP/4MP',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'bria-fibo-edit',
    name: 'bria/fibo-edit-1.5/edit',
    displayName: 'Bria FIBO 1.5 Edit',
    description: 'Bria FIBO 1.5 instruction editing (optional mask)',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },

  // Ideogram v4
  {
    id: 'ideogram-v4-instant',
    name: 'ideogram/v4/instant',
    displayName: 'Ideogram v4 Instant',
    description: 'Ideogram v4 Instant — fastest tier, great typography',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'ideogram-v4-fast',
    name: 'ideogram/v4/fast',
    displayName: 'Ideogram v4 Fast',
    description: 'Ideogram v4 Fast — TURBO/BALANCED/QUALITY rendering speeds',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'balanced',
    isAvailable: true,
    provider: 'fal'
  },

  // FLUX 3 Image (2026-10-02) - priced per request by flux3ImageTicketCost;
  // these are the 1k defaults
  {
    id: 'flux-3-image',
    name: 'blackforestlabs/flux-3/text-to-image',
    displayName: 'FLUX 3',
    description: 'FLUX 3 Image text-to-image; edits with up to 10 references',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'flux-3-image-edit',
    name: 'blackforestlabs/flux-3/edit-image',
    displayName: 'FLUX 3 Edit',
    description: 'FLUX 3 Image editing - up to 10 reference images',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  // Ideogram 4.5 (2026-10-02) - fal per image by quality tier, any size:
  // low $0.03 / medium $0.06 / high $0.22 -> 1 / 2 / 6 tickets (getTicketCost
  // prices by quality; these are the medium defaults)
  {
    id: 'ideogram-4.5',
    name: 'ideogram/v4.5',
    displayName: 'Ideogram v4.5',
    description: 'Ideogram 4.5 text-to-image; edits with references',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'ideogram-4.5-edit',
    name: 'ideogram/v4.5/edit',
    displayName: 'Ideogram v4.5 Edit',
    description: 'Ideogram 4.5 editing - a source image plus up to 4 references',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'ideogram-v4',
    name: 'ideogram/v4',
    displayName: 'Ideogram v4',
    description: 'Ideogram v4 base tier — TURBO/BALANCED/QUALITY, highest fidelity of the three',
    ticketCost: 3,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'ideogram-v4-tiling',
    name: 'ideogram/v4/tiling',
    displayName: 'Ideogram v4 Tiling',
    description: 'Ideogram v4 Tiling — seamless repeating textures (edges wrap)',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'balanced',
    isAvailable: true,
    provider: 'fal'
  },

  // Google NanoBanana 2.1 (2026-10-06, public) - text, and the
  // edit endpoint with references; same price for both (getTicketCost)
  {
    id: 'nano-banana-2.1',
    name: 'google/nano-banana-2.1',
    displayName: 'NanoBanana 2.1',
    description: 'Gemini NanoBanana 2.1 - text to image and edits with up to 14 references',
    ticketCost: 3,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'nano-banana-2.1-edit',
    name: 'google/nano-banana-2.1/edit',
    displayName: 'NanoBanana 2.1 Edit',
    description: 'NanoBanana 2.1 with reference images',
    ticketCost: 3,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },

  // Google NanoBanana 2 Lite
  {
    id: 'nano-banana-2-lite',
    name: 'google/nano-banana-2-lite',
    displayName: 'NanoBanana 2 Lite',
    description: 'Gemini NanoBanana 2 Lite — extreme aspect ratios up to 8:1',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'balanced',
    isAvailable: true,
    provider: 'fal'
  },

  // Recraft v4 — style + vector. fal per image (2026-10-02): $0.035 / $0.10 /
  // $0.05 / $0.12, + $0.005 to build the style from the references (always - there
  // is no style_id input) -> fal cost / $0.04 a ticket: 1 / 3 / 2 / 4
  {
    id: 'recraft-v4-style',
    name: 'recraft/v4/style/text-to-image',
    displayName: 'Recraft v4 Style',
    description: 'Recraft v4 styled text-to-image (style_id + style refs)',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'recraft-v4-style-pro',
    name: 'recraft/v4/style/pro/text-to-image',
    displayName: 'Recraft v4 Style Pro',
    description: 'Recraft v4 Pro styled text-to-image',
    ticketCost: 3,
    category: 'premium',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'recraft-v4-vector',
    name: 'recraft/v4/style/text-to-vector',
    displayName: 'Recraft v4 Vector',
    description: 'Recraft v4 text-to-vector (SVG output)',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'recraft-v4-vector-pro',
    name: 'recraft/v4/style/pro/text-to-vector',
    displayName: 'Recraft v4 Vector Pro',
    description: 'Recraft v4 Pro text-to-vector (SVG output)',
    ticketCost: 4,
    category: 'premium',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },

  // Pixelcut product photo
  {
    id: 'pixelcut-product-photo',
    name: 'pixelcut/product-photo',
    displayName: 'Pixelcut Product Photo',
    description: 'Product cutout + studio background — no prompt needed',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'balanced',
    isAvailable: true,
    provider: 'fal'
  },

  // Google Virtual Try-On
  {
    id: 'google-virtual-try-on',
    name: 'google/virtual-try-on',
    displayName: 'Virtual Try-On',
    description: 'Dress a person photo in a garment photo — needs 2 images',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'balanced',
    isAvailable: true,
    provider: 'fal'
  },

  // 2026-10-03 image tools (admin), fal cost / $0.04 a ticket:
  //   background removal $0.016 -> 1; vectorize $0.01 -> 1; product in hand
  //   $0.04 -> 1; multi-angle $0.035/MP with the source held to 1536 px
  //   (<= 2.36 MP, $0.083) -> 3; layerize $0.03375 PER LAYER at 1K (base + up
  //   to 16 layers). Raised 8 -> 10 tickets on going public (2026-10-04): the
  //   Flash test came back as 11 images, and 10 keeps 50% up to 11 layers
  //   ($0.37) and stays profitable at the 17-layer maximum ($0.57)
  { id: 'pixelcut-bg-removal', name: 'pixelcut/background-removal', displayName: 'Background Removal', description: 'Cut the subject out with a transparent background', ticketCost: 1, category: 'standard', rateLimit: { rpm: 0, rpd: 0 }, quality: 'high', isAvailable: true, provider: 'fal' },
  { id: 'recraft-vectorize', name: 'fal-ai/recraft/vectorize', displayName: 'Recraft Vectorize', description: 'Turn a logo or image into a scalable SVG', ticketCost: 1, category: 'standard', rateLimit: { rpm: 0, rpd: 0 }, quality: 'high', isAvailable: true, provider: 'fal' },
  { id: 'seedream-5-pro-layerize', name: 'bytedance/seedream/v5/pro/layerize', displayName: 'SeeDream 5 Layerize', description: 'Split an image into editable transparent layers', ticketCost: 10, category: 'standard', rateLimit: { rpm: 0, rpd: 0 }, quality: 'high', isAvailable: true, provider: 'fal' },
  { id: 'qwen-multi-angle', name: 'fal-ai/qwen-image-edit-2511-multiple-angles', displayName: 'Multi-Angle Reshoot', description: 'Re-shoot the scene from another camera angle', ticketCost: 3, category: 'standard', rateLimit: { rpm: 0, rpd: 0 }, quality: 'high', isAvailable: true, provider: 'fal' },
  { id: 'bria-product-holding', name: 'bria/fibo-edit-1.5/product-holding', displayName: 'Bria Product in Hand', description: 'Put a product in someone\'s hands for an ad shot', ticketCost: 1, category: 'standard', rateLimit: { rpm: 0, rpd: 0 }, quality: 'high', isAvailable: true, provider: 'fal' },
  // Second round (admin): SAM 3.1 $0.01 -> 1; Bria replace background / embed
  // product $0.04 -> 1; Flash Layerize $0.027 per output image, flat any size:
  // the test still came back as 11 images ($0.30) and the most it can return is
  // 17 ($0.46) -> 8 tickets keeps 50% up to 11 images, still profitable at 17
  { id: 'sam-3.1-image', name: 'fal-ai/sam-3-1/image', displayName: 'SAM 3.1 Select', description: 'Cut out whatever you name - "the fox", "the red car"', ticketCost: 1, category: 'standard', rateLimit: { rpm: 0, rpd: 0 }, quality: 'high', isAvailable: true, provider: 'fal' },
  { id: 'bria-replace-background', name: 'bria/replace-background', displayName: 'Bria Replace Background', description: 'Keep the subject, paint a new background from a prompt', ticketCost: 1, category: 'standard', rateLimit: { rpm: 0, rpd: 0 }, quality: 'high', isAvailable: true, provider: 'fal' },
  { id: 'bria-embed-product', name: 'bria/embed-product', displayName: 'Bria Embed Product', description: 'Place a product photo into a scene', ticketCost: 1, category: 'standard', rateLimit: { rpm: 0, rpd: 0 }, quality: 'high', isAvailable: true, provider: 'fal' },
  { id: 'seedream-5-flash-layerize', name: 'bytedance/seedream/v5/flash/layerize', displayName: 'SeeDream 5 Flash Layerize', description: 'Faster Layerize', ticketCost: 8, category: 'standard', rateLimit: { rpm: 0, rpd: 0 }, quality: 'high', isAvailable: true, provider: 'fal' },
  // Marigold V2 Depth (admin, 2026-10-03): a colourised depth map from one
  // image. fal $0.03 an image at any size -> 1 ticket (62% at the $0.08 ticket)
  {
    id: 'marigold-v2',
    name: 'fal-ai/marigold-v2',
    displayName: 'Marigold V2 Depth',
    description: 'Depth map from a single image - near is warm, far is cool',
    ticketCost: 1,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'high',
    isAvailable: true,
    provider: 'fal'
  },
  // SeedVR2 upscaler
  {
    id: 'seedvr2-upscale',
    name: 'fal-ai/seedvr/upscale/image',
    displayName: 'SeedVR2 Upscale',
    description: 'SeedVR2 image upscaler — 1-10× or a target resolution',
    // fal bills $0.001 per OUTPUT megapixel: a 4× pass over a 4 MP source is
    // 64 MP, about $0.064. Two tickets covers the worst realistic run.
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },

  // Topaz image suite
  {
    id: 'topaz-img-upscale-precision',
    name: 'topaz/upscale/image/precision',
    displayName: 'Topaz Precision Upscale',
    description: 'Topaz precision upscale 1-4x — faithful detail recovery',
    ticketCost: 4,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'topaz-img-upscale-creative',
    name: 'topaz/upscale/image/creative',
    displayName: 'Topaz Creative Upscale',
    description: 'Topaz Bloom creative upscale 1-4x',
    ticketCost: 4,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'topaz-img-upscale-generative',
    name: 'topaz/upscale/image/generative',
    displayName: 'Topaz Generative Upscale',
    description: 'Topaz Wonder/Recover generative upscale 1-4x (optional prompt)',
    ticketCost: 5,
    category: 'premium',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'topaz-img-upscale-transparent',
    name: 'topaz/upscale/image/transparent',
    displayName: 'Topaz Transparent Upscale',
    description: 'Topaz alpha-preserving upscale — always PNG',
    ticketCost: 4,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'ultra',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'topaz-adjust',
    name: 'topaz/adjust/image',
    displayName: 'Topaz Adjust',
    description: 'Topaz Adjust V2 / White Balance / Colorize',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'topaz-sharpen',
    name: 'topaz/sharpen/image',
    displayName: 'Topaz Sharpen',
    description: 'Topaz sharpen — 11 model variants (lens blur, motion, portrait…)',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'topaz-denoise',
    name: 'topaz/denoise/image',
    displayName: 'Topaz Denoise',
    description: 'Topaz denoise — Normal / Strong / Extreme / Denoise Max',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },
  {
    id: 'topaz-restore',
    name: 'topaz/restore/image',
    displayName: 'Topaz Restore',
    description: 'Topaz restore — Recover 3 / Dust-Scratch V2',
    ticketCost: 2,
    category: 'standard',
    rateLimit: { rpm: 0, rpd: 0 },
    quality: 'fast',
    isAvailable: true,
    provider: 'fal'
  },

  // IMAGEN MODELS - Require Vertex AI (different setup)
  // Uncomment these when you set up Vertex AI
  /*
  {
    id: 'imagen-4.0-generate-001',
    name: 'imagen-4.0-generate-001',
    displayName: 'Imagen 4 Standard',
    description: 'Latest image generation with better text rendering',
    ticketCost: 1,
    category: 'standard',
    rateLimit: {
      rpm: 10,
      rpd: 100
    },
    quality: 'high',
    isAvailable: true
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    name: 'imagen-4.0-ultra-generate-001',
    displayName: 'Imagen 4 ULTRA',
    description: 'Maximum fidelity image generation',
    ticketCost: 1,
    category: 'standard',
    rateLimit: {
      rpm: 5,
      rpd: 50
    },
    quality: 'ultra',
    isAvailable: true
  },
  */

  // PREMIUM TIER - 2 tickets (COMING SOON - Requires Imagen setup)
  // Uncomment these when you set up Imagen API
  /*
  {
    id: 'imagen-4.0-fast-generate',
    name: 'imagen-4.0-fast-generate',
    displayName: 'Imagen Fast v4.0',
    description: 'Premium image generation with enhanced details',
    ticketCost: 2,
    category: 'premium',
    rateLimit: {
      rpm: 0,
      rpd: 10
    },
    quality: 'high',
    isAvailable: true
  },
  {
    id: 'imagen-4.0-generate',
    name: 'imagen-4.0-generate',
    displayName: 'Imagen Standard v4.0',
    description: 'High-quality multiverse imagery with refined output',
    ticketCost: 2,
    category: 'premium',
    rateLimit: {
      rpm: 0,
      rpd: 10
    },
    quality: 'high',
    isAvailable: true
  },

  // ULTRA TIER - 5 tickets (COMING SOON - Requires Imagen setup)
  {
    id: 'imagen-4.0-ultra-generate',
    name: 'imagen-4.0-ultra-generate',
    displayName: 'Imagen ULTRA v4.0 ⚡',
    description: 'Maximum fidelity - The pinnacle of multiverse scanning technology',
    ticketCost: 5,
    category: 'ultra',
    rateLimit: {
      rpm: 0,
      rpd: 5
    },
    quality: 'ultra',
    isAvailable: true
  },
  */
]

// Helper functions
export function getModelById(id: string): AIModel | undefined {
  return AI_MODELS.find(m => m.id === id)
}

export function getAvailableModels(): AIModel[] {
  return AI_MODELS.filter(m => m.isAvailable)
}

export function getModelsByCategory(category: 'standard' | 'premium' | 'ultra'): AIModel[] {
  return AI_MODELS.filter(m => m.category === category && m.isAvailable)
}

export function getTicketCost(modelId: string, quality?: '2k' | '4k' | string): number {
  const model = getModelById(modelId)
  if (!model) return 1

  // Clarity Upscaler: 7 tickets (2x), 26 tickets (4x)
  if (modelId === 'clarity-upscaler') {
    return quality === '4x' ? 26 : 7
  }

  // NanoBanana Pro: 7 tickets for 2K, 14 tickets for 4K
  if (modelId === 'nano-banana-pro') {
    return quality === '4k' ? 14 : 7
  }

  // NanoBanana Pro 2: 7 tickets for 2K, 12 tickets for 4K
  // Ideogram 4.5: fal bills per image by tier (low $0.03 / medium $0.06 / high $0.22)
  if (modelId === 'ideogram-4.5' || modelId === 'ideogram-4.5-edit') {
    return quality === 'high' ? 6 : quality === 'low' ? 1 : 2
  }

  if (modelId === 'nano-banana-pro-2') {
    return quality === '4k' ? 12 : 7
  }

  // NanoBanana 2.1 (+ edit): fal $0.08 an image at 1K, x1.5 at 2K, x2 at 4K
  // -> fal cost / $0.04 a ticket: 2 / 3 / 4
  if (modelId === 'nano-banana-2.1' || modelId === 'nano-banana-2.1-edit') {
    return quality === '4k' ? 4 : quality === '1k' ? 2 : 3
  }

  // Pro Scanner v3: 7 tickets for 2K, 15 tickets for 4K
  if (modelId === 'gemini-3-pro-image') {
    return quality === '4k' ? 15 : 7
  }

  // ChatGPT Images 2.5: priced per request from measured fal costs (shape,
  // effort, references - lib/ticket-pricing). Callers that only know the tier
  // get the dearest shape (square) with no references; /api/generate and the
  // portal price the real request.
  if (modelId === 'gpt-image-2.5' || modelId === 'gpt-image-2.5-edit') {
    return gptImage25TicketCost({ quality: quality ?? '1k' })
  }

  // SeeDream 4.5: 2 tickets for 2K, 4 tickets for 4K
  if (modelId === 'seedream-4.5') {
    return quality === '4k' ? 4 : 2
  }

  return model.ticketCost
}

// Category colors for UI
export const CATEGORY_COLORS = {
  standard: {
    border: 'border-cyan-400',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    glow: 'shadow-cyan-500/50'
  },
  premium: {
    border: 'border-fuchsia-400',
    bg: 'bg-fuchsia-500/10',
    text: 'text-fuchsia-400',
    glow: 'shadow-fuchsia-500/50'
  },
  ultra: {
    border: 'border-yellow-400',
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    glow: 'shadow-yellow-500/50'
  }
}

// NOTE: To enable Imagen models:
// 1. Verify model availability in Google AI Studio
// 2. Check if models require Vertex AI instead of Gemini API
// 3. Update API endpoint in generate route if needed
// 4. Uncomment models above and set isAvailable: true
// 5. Test each model individually before going live
