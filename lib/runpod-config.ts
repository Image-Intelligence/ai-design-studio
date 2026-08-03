// RunPod endpoint config helpers (server-only). The config is stored
// encrypted as JSON {baseUrl, apiKey} in ChatProviderKey provider 'runpod'.

export type RunpodConfig = { baseUrl: string; apiKey?: string }

export function parseRunpodConfig(plain: string | undefined | null): RunpodConfig | null {
  if (!plain) return null
  try {
    const j = JSON.parse(plain)
    return typeof j?.baseUrl === 'string' && j.baseUrl ? { baseUrl: j.baseUrl, apiKey: j.apiKey || undefined } : null
  } catch { return null }
}

// A RunPod pod proxy URL is https://<podId>-<port>.proxy.runpod.net — pull the
// pod id so we can start/stop the pod via the RunPod API. Returns null for
// serverless endpoints or other OpenAI-compatible servers (no pod to control).
export function extractRunpodPodId(baseUrl: string | undefined | null): string | null {
  if (!baseUrl) return null
  const m = baseUrl.match(/^https?:\/\/([a-z0-9]+)-\d+\.proxy\.runpod\.net/i)
  return m ? m[1] : null
}

// Accepts a pod proxy URL (https://<podId>-8000.proxy.runpod.net), a
// serverless endpoint (https://api.runpod.ai/v2/<id>/openai), or any other
// OpenAI-compatible server — normalized to end in /v1.
export function normalizeRunpodBaseUrl(raw: string): string | null {
  let u = raw.trim().replace(/\/+$/, '')
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  try { new URL(u) } catch { return null }
  if (!/\/v1$/i.test(u)) u = `${u}/v1`
  return u
}
