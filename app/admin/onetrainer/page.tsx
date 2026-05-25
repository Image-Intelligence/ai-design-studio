"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  ArrowLeft, Play, Square, Loader2, CheckCircle, AlertCircle,
  Plus, Trash2, FolderOpen, ChevronDown, RefreshCw, Cpu,
  Circle, Zap, Terminal, Settings2, BookOpen, X,
  Cloud, Upload, HardDrive, ExternalLink,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Preset {
  filename: string
  name:     string
  config:   Record<string, unknown>
}

interface Concept {
  id:             string
  name:           string
  path:           string   // local mode: folder path
  r2DatasetKey:   string   // cloud mode: R2 key of uploaded zip
  repeats:        number
  prompt_source:  'sample' | 'filename' | 'concept'
  prompt_path:    string
  uploadProgress?: number  // 0-100 during upload, undefined when idle
}

interface TrainStatus {
  status:     'idle' | 'running' | 'done' | 'error' | 'cancelled'
  pid:        number | null
  logs:       string[]
  returncode: number | null
  started_at: number | null
  run_name:   string | null
}

interface CloudStatus {
  status:        'idle' | 'running' | 'done' | 'error' | 'cancelled'
  job_id:        string | null
  runpod_status: string | null
  logs:          string[]
  output_r2_key: string | null
  success:       boolean | null
  error:         string | null
  elapsed_min:   number | null
  started_at:    number | null
  run_name:      string | null
}

interface R2Checkpoint {
  key:           string
  name:          string
  size_gb:       number
  last_modified: string | null
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getPass(): string {
  try { return sessionStorage.getItem('admin-password') || '' } catch { return '' }
}
function ah(): Record<string, string> {
  const p = getPass(); return p ? { 'x-admin-password': p } : {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

function emptyConcept(): Concept {
  return { id: uid(), name: 'concept', path: '', r2DatasetKey: '', repeats: 1, prompt_source: 'sample', prompt_path: '' }
}

function statusColor(s: TrainStatus['status'] | CloudStatus['status']) {
  return { idle: 'text-slate-500', running: 'text-emerald-400', done: 'text-emerald-400', error: 'text-red-400', cancelled: 'text-amber-400' }[s]
}
function statusLabel(s: TrainStatus['status'] | CloudStatus['status']) {
  return { idle: 'Idle', running: 'Training…', done: 'Done', error: 'Error', cancelled: 'Cancelled' }[s]
}

// ─── Preset parsing ────────────────────────────────────────────────────────────

type TrainMethod = 'LoRA' | 'Finetune' | 'Embedding' | 'Full'
interface ParsedPreset { family: string; method: TrainMethod; vram: string | null }

function parsePreset(filename: string): ParsedPreset {
  const raw = filename.replace(/^#/, '').replace(/\.json$/, '').toLowerCase()
  const vramMatch = raw.match(/(\d+)\s*gb/)
  const vram = vramMatch ? `${vramMatch[1]} GB` : null
  const method: TrainMethod =
    /\blora\b/.test(raw) ? 'LoRA' :
    /finetune/.test(raw) ? 'Finetune' :
    /embedding/.test(raw) ? 'Embedding' : 'Full'
  let family = 'Other'
  if      (raw.startsWith('flux2'))               family = 'FLUX 2'
  else if (raw.startsWith('flux'))                family = 'FLUX 1'
  else if (raw.startsWith('z-image deturbo'))     family = 'Z-Image DeTurbo'
  else if (raw.startsWith('z-image'))             family = 'Z-Image'
  else if (raw.startsWith('ernie'))               family = 'ERNIE'
  else if (raw.startsWith('sdxl'))                family = 'SDXL'
  else if (raw.startsWith('sd 3'))                family = 'SD 3'
  else if (raw.startsWith('sd 2'))                family = 'SD 2'
  else if (raw.startsWith('sd 1'))                family = 'SD 1.5'
  else if (raw.startsWith('chroma'))              family = 'Chroma'
  else if (raw.startsWith('hidream'))             family = 'HiDream'
  else if (raw.startsWith('hunyuan'))             family = 'Hunyuan Video'
  else if (raw.startsWith('pixart alpha'))        family = 'PixArt-α'
  else if (raw.startsWith('pixart sigma'))        family = 'PixArt-Σ'
  else if (raw.startsWith('qwen'))                family = 'Qwen'
  else if (raw.startsWith('sana'))                family = 'Sana'
  else if (raw.startsWith('stable cascade'))      family = 'Stable Cascade'
  else if (raw.startsWith('wuerstchen'))          family = 'Würstchen'
  return { family, method, vram }
}

const FAMILY_ORDER = [
  'FLUX 1', 'FLUX 2', 'ERNIE', 'Z-Image', 'Z-Image DeTurbo',
  'SDXL', 'SD 3', 'SD 2', 'SD 1.5',
  'Chroma', 'HiDream', 'Hunyuan Video', 'PixArt-α', 'PixArt-Σ',
  'Qwen', 'Sana', 'Stable Cascade', 'Würstchen', 'Other',
]

const FAMILY_COLOR: Record<string, string> = {
  'FLUX 1':          'text-amber-400',
  'FLUX 2':          'text-amber-400',
  'ERNIE':           'text-blue-400',
  'Z-Image':         'text-cyan-400',
  'Z-Image DeTurbo': 'text-cyan-300',
  'SDXL':            'text-violet-400',
  'SD 3':            'text-fuchsia-400',
  'SD 2':            'text-slate-400',
  'SD 1.5':          'text-slate-400',
  'Chroma':          'text-purple-400',
  'HiDream':         'text-pink-400',
  'Hunyuan Video':   'text-rose-400',
}

const METHOD_PILL: Record<TrainMethod, string> = {
  'LoRA':      'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  'Finetune':  'bg-amber-500/15   text-amber-300   border-amber-500/25',
  'Embedding': 'bg-violet-500/15  text-violet-300  border-violet-500/25',
  'Full':      'bg-slate-500/15   text-slate-400   border-slate-500/25',
}

const VRAM_PILL: Record<string, string> = {
  '8 GB':  'bg-red-500/10    text-red-400    border-red-500/20',
  '16 GB': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  '24 GB': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
}

// ─── LoRA download block ───────────────────────────────────────────────────────

function LoraDownloadBlock({ r2Key, adminHeaders }: { r2Key: string; adminHeaders: Record<string, string> }) {
  const [downloading, setDownloading] = useState(false)
  const filename = r2Key.split('/').pop() ?? 'lora.safetensors'

  async function download() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/admin/onetrainer/cloud/download?key=${encodeURIComponent(r2Key)}`, { headers: adminHeaders })
      if (!res.ok) { alert('Failed to get download URL'); return }
      const { url } = await res.json()
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
    } catch { alert('Download error') }
    finally { setDownloading(false) }
  }

  return (
    <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
      <CheckCircle size={11} className="text-emerald-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-slate-500 mb-0.5">LoRA saved to R2</p>
        <p className="text-[11px] text-emerald-300 font-mono truncate">{r2Key}</p>
      </div>
      <button
        onClick={download}
        disabled={downloading}
        className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
      >
        <ExternalLink size={10} />
        {downloading ? 'Getting link…' : 'Download'}
      </button>
    </div>
  )
}

function LoraListItem({ file, adminHeaders }: { file: R2Checkpoint; adminHeaders: Record<string, string> }) {
  const [downloading, setDownloading] = useState(false)

  async function download() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/admin/onetrainer/cloud/download?key=${encodeURIComponent(file.key)}`, { headers: adminHeaders })
      if (!res.ok) { alert('Failed to get download URL'); return }
      const { url } = await res.json()
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
    } catch { alert('Download error') }
    finally { setDownloading(false) }
  }

  const date = file.last_modified
    ? new Date(file.last_modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12] transition-colors">
      <Zap size={14} className="text-emerald-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-white truncate">{file.name.replace(/\.(safetensors|ckpt|pt|zip|tar\.gz)$/i, '')}</p>
        <p className="text-[10px] text-slate-600 font-mono mt-0.5">
          {file.size_gb} GB · {file.name.split('.').pop()}{date ? ` · ${date}` : ''} · <span className="text-slate-700">{file.key}</span>
        </p>
      </div>
      <button
        onClick={download}
        disabled={downloading}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
      >
        <ExternalLink size={10} />
        {downloading ? 'Getting link…' : 'Download'}
      </button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OneTrainerPage() {
  // Mode
  const [mode, setMode] = useState<'local' | 'cloud'>('cloud')

  // Server (local mode)
  const [serverRunning, setServerRunning] = useState(false)
  const [serverLoading, setServerLoading] = useState(false)

  // Presets
  const [presets, setPresets]               = useState<Preset[]>([])
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)

  // Overrides
  const [runName,    setRunName]    = useState('My Training Run')
  const [lr,         setLr]         = useState('')
  const [batchSize,  setBatchSize]  = useState('')
  const [epochs,     setEpochs]     = useState('')
  const [maxSteps,   setMaxSteps]   = useState('')
  const [resolution, setResolution] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [loraRank,   setLoraRank]   = useState('')

  // Local checkpoint scanner
  const [scanDir,           setScanDir]           = useState('C:\\Users\\Owner\\Downloads')
  const [checkpointFiles,   setCheckpointFiles]   = useState<{ name: string; path: string; size_gb: number }[]>([])
  const [scanLoading,       setScanLoading]       = useState(false)

  // R2 checkpoints (cloud mode)
  const [r2Checkpoints,        setR2Checkpoints]        = useState<R2Checkpoint[]>([])
  const [r2CheckpointsLoading, setR2CheckpointsLoading] = useState(false)

  // Shared: selected checkpoint (local path in local mode, R2 key in cloud mode)
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('')

  // Concepts
  const [concepts, setConcepts] = useState<Concept[]>([emptyConcept()])

  // Local training status
  const [trainStatus, setTrainStatus] = useState<TrainStatus>({
    status: 'idle', pid: null, logs: [], returncode: null, started_at: null, run_name: null,
  })

  // Cloud training status
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | null>(null)
  const [cloudJobId,  setCloudJobId]  = useState<string | null>(null)

  const [launching, setLaunching] = useState(false)
  const [tab, setTab]             = useState<'config' | 'monitor' | 'loras'>('config')

  // Saved LoRAs (cloud mode)
  const [r2Loras,        setR2Loras]        = useState<R2Checkpoint[]>([])
  const [r2LorasLoading, setR2LorasLoading] = useState(false)

  // Live log polling (cloud mode)
  const [liveLogs, setLiveLogs]     = useState<string[]>([])
  const liveLogPollRef              = useRef<ReturnType<typeof setInterval> | null>(null)

  // File input refs for dataset upload
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const logEndRef = useRef<HTMLDivElement>(null)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Server status (local mode) ─────────────────────────────────────────────

  const checkServer = useCallback(async () => {
    if (mode !== 'local') return
    try {
      const res = await fetch('/api/admin/onetrainer/server', { headers: ah() })
      if (res.ok) setServerRunning((await res.json()).running)
    } catch {}
  }, [mode])

  useEffect(() => {
    if (mode !== 'local') return
    checkServer()
    const t = setInterval(checkServer, 5000)
    return () => clearInterval(t)
  }, [mode, checkServer])

  async function toggleServer() {
    setServerLoading(true)
    try {
      if (serverRunning) {
        await fetch('/api/admin/onetrainer/server', { method: 'DELETE', headers: ah() })
        setServerRunning(false)
      } else {
        const res = await fetch('/api/admin/onetrainer/server', { method: 'POST', headers: ah() })
        const j   = await res.json()
        setServerRunning(j.started ?? false)
        if (j.started) loadPresets()
      }
    } finally { setServerLoading(false) }
  }

  // ── Presets ────────────────────────────────────────────────────────────────

  const loadPresets = useCallback(async () => {
    try {
      if (mode === 'cloud') {
        const res = await fetch('/api/admin/onetrainer/presets-local', { headers: ah() })
        if (res.ok) setPresets(await res.json())
      } else {
        const res = await fetch('/api/admin/onetrainer/presets', { headers: ah() })
        if (res.ok) setPresets(await res.json())
      }
    } catch {}
  }, [mode])

  // Load presets immediately in cloud mode, or when server comes online in local mode
  useEffect(() => {
    if (mode === 'cloud') { loadPresets() }
  }, [mode, loadPresets])

  useEffect(() => {
    if (mode === 'local' && serverRunning) loadPresets()
  }, [mode, serverRunning, loadPresets])

  function selectPreset(p: Preset) {
    setSelectedPreset(p)
    setLr(String(p.config.learning_rate ?? ''))
    setBatchSize(String(p.config.batch_size ?? ''))
    setResolution(String(p.config.resolution ?? ''))
    setOutputPath(String(p.config.output_model_destination ?? ''))
    setLoraRank('')
    setMaxSteps('')
    setSelectedCheckpoint('')
    setCheckpointFiles([])
  }

  // ── Local checkpoint scan ──────────────────────────────────────────────────

  async function scanCheckpoints() {
    if (!scanDir.trim()) return
    setScanLoading(true)
    try {
      const res = await fetch(`/api/admin/onetrainer/scan-checkpoints?dir=${encodeURIComponent(scanDir.trim())}`, { headers: ah() })
      if (res.ok) setCheckpointFiles(await res.json())
      else setCheckpointFiles([])
    } catch { setCheckpointFiles([]) }
    finally { setScanLoading(false) }
  }

  // ── R2 checkpoint list ─────────────────────────────────────────────────────

  async function loadR2Checkpoints() {
    setR2CheckpointsLoading(true)
    try {
      const res = await fetch('/api/admin/onetrainer/cloud/checkpoints', { headers: ah() })
      if (res.ok) setR2Checkpoints(await res.json())
    } catch {}
    finally { setR2CheckpointsLoading(false) }
  }

  async function loadR2Loras() {
    setR2LorasLoading(true)
    try {
      // Scan entire training/ tree so nothing is missed regardless of where the worker saved it
      const res = await fetch('/api/admin/onetrainer/cloud/checkpoints?prefix=training/&allFiles=true', { headers: ah() })
      if (res.ok) setR2Loras(await res.json())
    } catch {}
    finally { setR2LorasLoading(false) }
  }

  // ── Dataset upload (cloud mode) ────────────────────────────────────────────

  function triggerDatasetUpload(conceptId: string) {
    const input = fileInputRefs.current[conceptId]
    if (input) input.click()
  }

  async function handleDatasetFile(conceptId: string, file: File) {
    const CHUNK = 50 * 1024 * 1024  // 50 MB per part

    try {
      // 1. Initiate multipart upload — server creates the upload and returns per-part presigned URLs
      const initRes = await fetch('/api/admin/onetrainer/cloud/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ah() },
        body: JSON.stringify({ action: 'init', type: 'dataset', filename: file.name, contentType: 'application/zip', fileSize: file.size }),
      })
      if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`)
      const { uploadId, key, partUrls } = await initRes.json()

      updateConcept(conceptId, { uploadProgress: 0 })

      // 2. Upload each chunk directly to R2 using its presigned URL
      let uploadedBytes = 0
      for (let i = 0; i < partUrls.length; i++) {
        const start = i * CHUNK
        const end = Math.min(start + CHUNK, file.size)
        const chunk = file.slice(start, end)

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.upload.onprogress = e => {
            if (e.lengthComputable) {
              const pct = Math.round((uploadedBytes + e.loaded) / file.size * 100)
              updateConcept(conceptId, { uploadProgress: Math.min(pct, 99) })
            }
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              uploadedBytes += (end - start)
              resolve()
            } else {
              reject(new Error(`Part ${i + 1} upload failed: ${xhr.status}`))
            }
          }
          xhr.onerror = () => reject(new Error(`Part ${i + 1} network error`))
          xhr.open('PUT', partUrls[i])
          xhr.send(chunk)
        })
      }

      // 3. Tell the server to assemble the parts
      const completeRes = await fetch('/api/admin/onetrainer/cloud/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ah() },
        body: JSON.stringify({ action: 'complete', key, uploadId }),
      })
      if (!completeRes.ok) throw new Error(`Complete failed: ${completeRes.status}`)

      updateConcept(conceptId, { r2DatasetKey: key, uploadProgress: undefined })
    } catch (err: any) {
      updateConcept(conceptId, { uploadProgress: undefined })
      alert(`Dataset upload failed: ${err.message}`)
    }
  }

  // ── Training status poll ───────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      if (mode === 'local') {
        const res = await fetch('/api/admin/onetrainer/status', { headers: ah() })
        if (res.ok) {
          const s: TrainStatus = await res.json()
          setTrainStatus(s)
          if (s.status !== 'running') stopPoll()
        }
      } else {
        if (!cloudJobId) return
        const res = await fetch(`/api/admin/onetrainer/cloud/status?job_id=${cloudJobId}`, { headers: ah() })
        if (res.ok) {
          const s = await res.json()
          setCloudStatus(prev => ({
            ...s,
            started_at: prev?.started_at ?? Date.now() / 1000,
            run_name:   prev?.run_name   ?? runName,
          }))
          if (s.status !== 'running') stopPoll()
        }
      }
    } catch {}
  }, [mode, cloudJobId, runName]) // eslint-disable-line react-hooks/exhaustive-deps

  function startPoll() {
    if (pollRef.current) return
    pollRef.current = setInterval(fetchStatus, mode === 'cloud' ? 5000 : 2000)
  }

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const fetchLiveLogs = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/admin/onetrainer/cloud/logs?job_id=${jobId}`, { headers: ah() })
      if (res.ok) {
        const { logs } = await res.json()
        if (logs.length > 0) setLiveLogs(logs)
      }
    } catch {}
  }, [])

  function startLiveLogPoll(jobId: string) {
    if (liveLogPollRef.current) return
    fetchLiveLogs(jobId)
    liveLogPollRef.current = setInterval(() => fetchLiveLogs(jobId), 15000)
  }

  function stopLiveLogPoll() {
    if (liveLogPollRef.current) { clearInterval(liveLogPollRef.current); liveLogPollRef.current = null }
  }

  const activeStatus  = mode === 'local' ? trainStatus.status  : (cloudStatus?.status  ?? 'idle')
  const isTraining    = activeStatus === 'running'

  useEffect(() => {
    if (isTraining) { startPoll(); setTab('monitor') }
    return stopPoll
  }, [isTraining]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode === 'cloud' && isTraining && cloudJobId) {
      startLiveLogPoll(cloudJobId)
    } else {
      stopLiveLogPoll()
    }
    return stopLiveLogPoll
  }, [mode, isTraining, cloudJobId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [
    trainStatus.logs, cloudStatus?.logs,
  ])

  // ── Start training ─────────────────────────────────────────────────────────

  async function startTraining() {
    if (!selectedPreset) return
    setLaunching(true)
    setLiveLogs([])
    try {
      const config: Record<string, unknown> = { ...selectedPreset.config }
      if (lr)         config.learning_rate            = parseFloat(lr)
      if (batchSize)  config.batch_size               = parseInt(batchSize)
      if (epochs)     config.epochs                   = parseInt(epochs)
      if (maxSteps)   config.max_steps                = parseInt(maxSteps)
      if (resolution) config.resolution               = resolution
      if (outputPath) config.output_model_destination = outputPath
      if (loraRank)   config.lora_rank                = parseInt(loraRank)
      config.output_model_format = config.output_model_format ?? 'SAFETENSORS'

      if (mode === 'local') {
        if (selectedCheckpoint) config.base_model_name = selectedCheckpoint

        const conceptPayload = concepts
          .filter(c => c.path.trim())
          .map(c => ({
            name:    c.name,
            path:    c.path.trim(),
            repeats: c.repeats,
            text: { prompt_source: c.prompt_source, prompt_path: c.prompt_path || '' },
          }))

        const res = await fetch('/api/admin/onetrainer/train', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...ah() },
          body: JSON.stringify({ name: runName, config, concepts: conceptPayload }),
        })

        if (res.ok) {
          await fetchStatus()
          setTab('monitor')
          startPoll()
        } else {
          const j = await res.json().catch(() => ({}))
          alert(j.error ?? `Error ${res.status}`)
        }
      } else {
        // Cloud mode — submit to RunPod
        const cloudConcepts = concepts
          .filter(c => c.r2DatasetKey)
          .map(c => ({
            name:           c.name,
            r2_dataset_key: c.r2DatasetKey,
            repeats:        c.repeats,
            prompt_source:  c.prompt_source,
            prompt_path:    c.prompt_path || '',
          }))

        const safeName = runName.replace(/[^a-z0-9_-]/gi, '_')

        const res = await fetch('/api/admin/onetrainer/cloud/train', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...ah() },
          body: JSON.stringify({
            run_name:           runName,
            config,
            concepts:           cloudConcepts,
            checkpoint_r2_key:  selectedCheckpoint,
            output_r2_key:      `training/loras/${safeName}.safetensors`,
          }),
        })

        if (res.ok) {
          const { job_id } = await res.json()
          setCloudJobId(job_id)
          setCloudStatus({
            status: 'running', job_id, runpod_status: 'IN_QUEUE',
            logs: [`[runpod] Job submitted — queued on RunPod (${job_id})`],
            output_r2_key: null, success: null, error: null, elapsed_min: null,
            started_at: Date.now() / 1000, run_name: runName,
          })
          setTab('monitor')
          startPoll()
        } else {
          const j = await res.json().catch(() => ({}))
          alert(j.error ?? `Error ${res.status}`)
        }
      }
    } finally { setLaunching(false) }
  }

  async function cancelTraining() {
    if (mode === 'local') {
      await fetch('/api/admin/onetrainer/cancel', { method: 'POST', headers: ah() })
      await fetchStatus()
    } else {
      if (cloudJobId) {
        await fetch('/api/admin/onetrainer/cloud/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...ah() },
          body: JSON.stringify({ job_id: cloudJobId }),
        })
        setCloudStatus(prev => prev ? { ...prev, status: 'cancelled' } : prev)
        stopPoll()
      }
    }
  }

  // ── Concept helpers ────────────────────────────────────────────────────────

  function updateConcept(id: string, patch: Partial<Concept>) {
    setConcepts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const canTrain = mode === 'local'
    ? (serverRunning && !!selectedPreset && concepts.some(c => c.path.trim()) && !isTraining)
    : (!!selectedPreset && !!selectedCheckpoint && concepts.some(c => c.r2DatasetKey) && !isTraining)

  const activeLogs    = mode === 'local' ? trainStatus.logs
    : cloudStatus?.status === 'running' ? liveLogs
    : (cloudStatus?.logs ?? [])
  const activeRunName = mode === 'local' ? trainStatus.run_name : cloudStatus?.run_name
  const activeStarted = mode === 'local' ? trainStatus.started_at : cloudStatus?.started_at

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-[#09090f] text-white flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 bg-[#09090f] border-b border-white/[0.06] px-4 py-3 flex items-center gap-3">
        <button onClick={() => window.location.href = '/admin'}
          className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-white transition-colors">
          <ArrowLeft size={14} />
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-white">OneTrainer</h1>
          <p className="text-[11px] text-slate-600">Fine-tune Flux, SDXL, and more</p>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
          <button onClick={() => setMode('local')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              mode === 'local' ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300'
            }`}>
            <HardDrive size={10} /> Local
          </button>
          <button onClick={() => setMode('cloud')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              mode === 'cloud' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
            }`}>
            <Cloud size={10} /> Cloud
          </button>
        </div>

        {/* Server status (local) / RunPod badge (cloud) */}
        {mode === 'local' ? (
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] ${
              serverRunning
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-white/[0.08] bg-white/[0.03] text-slate-500'
            }`}>
              <Circle size={6} className={serverRunning ? 'fill-emerald-400 text-emerald-400' : 'fill-slate-600 text-slate-600'} />
              {serverRunning ? 'Server online' : 'Server offline'}
            </div>
            <button onClick={toggleServer} disabled={serverLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-50 ${
                serverRunning
                  ? 'border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/15'
                  : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15'
              }`}>
              {serverLoading ? <Loader2 size={11} className="animate-spin" /> : serverRunning ? <Square size={11} /> : <Zap size={11} />}
              {serverLoading ? 'Starting…' : serverRunning ? 'Stop Server' : 'Start Server'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400 text-[11px]">
            <Cloud size={9} />
            RunPod Cloud
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="shrink-0 border-b border-white/[0.06] px-4">
        <div className="flex">
          {([['config', 'Configuration', Settings2], ['monitor', 'Monitor', Terminal], ['loras', 'Saved LoRAs', Zap]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => { setTab(id); if (id === 'loras') loadR2Loras() }}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                tab === id ? 'border-violet-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}>
              <Icon size={12} /> {label}
              {id === 'monitor' && isTraining && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Config tab ── */}
      {tab === 'config' && (
        <div className="flex-1 flex overflow-hidden">

          {/* Left sidebar — preset picker */}
          <div className="w-72 shrink-0 border-r border-white/[0.06] overflow-y-auto flex flex-col">
            <div className="p-4 flex items-center justify-between shrink-0">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Training Preset</p>
                <p className="text-[9px] text-slate-700 mt-0.5">Select model + method</p>
              </div>
              <button onClick={loadPresets} className="p-1 rounded hover:bg-white/[0.06] text-slate-600 hover:text-slate-400 transition-colors">
                <RefreshCw size={10} />
              </button>
            </div>

            <div className="flex-1 px-3 pb-4">
              {mode === 'local' && !serverRunning ? (
                <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3 flex items-start gap-2.5">
                  <BookOpen size={12} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-[10px] text-amber-600 space-y-0.5">
                    <p className="font-semibold text-amber-400">Server offline</p>
                    <p>Click <strong>Start Server</strong> above to load presets.</p>
                  </div>
                </div>
              ) : presets.length === 0 ? (
                <p className="text-[10px] text-slate-600 px-1">No presets found — check your OneTrainer installation.</p>
              ) : (() => {
                const grouped: Record<string, Preset[]> = {}
                for (const p of presets) {
                  const { family } = parsePreset(p.filename)
                  ;(grouped[family] ??= []).push(p)
                }
                const activeFamilies = FAMILY_ORDER.filter(f => grouped[f]?.length)
                return (
                  <div className="space-y-3">
                    {activeFamilies.map(family => (
                      <div key={family}>
                        <div className="flex items-center gap-2 mb-1.5 px-1">
                          <span className={`text-[9px] font-bold uppercase tracking-widest ${FAMILY_COLOR[family] ?? 'text-slate-500'}`}>
                            {family}
                          </span>
                          <div className="flex-1 h-px bg-white/[0.05]" />
                        </div>
                        <div className="space-y-0.5">
                          {grouped[family].map(p => {
                            const { method, vram } = parsePreset(p.filename)
                            const isSelected = selectedPreset?.filename === p.filename
                            const cfgLr  = p.config.learning_rate
                            const cfgBs  = p.config.batch_size
                            const cfgRes = p.config.resolution
                            return (
                              <button key={p.filename} onClick={() => selectPreset(p)}
                                className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all ${
                                  isSelected
                                    ? 'border-violet-500/40 bg-violet-500/10'
                                    : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.03]'
                                }`}>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${METHOD_PILL[method]}`}>{method}</span>
                                  {vram
                                    ? <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${VRAM_PILL[vram] ?? 'bg-white/5 text-slate-400 border-white/10'}`}>{vram}</span>
                                    : <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-white/5 text-slate-500 border-white/10">any</span>
                                  }
                                  {isSelected && <CheckCircle size={9} className="text-violet-400 ml-auto shrink-0" />}
                                </div>
                                <div className="flex gap-2 mt-1">
                                  {!!cfgRes && <span className="text-[9px] text-slate-600 font-mono">res <span className="text-slate-500">{String(cfgRes)}</span></span>}
                                  {!!cfgBs  && <span className="text-[9px] text-slate-600 font-mono">bs <span className="text-slate-500">{String(cfgBs)}</span></span>}
                                  {!!cfgLr  && <span className="text-[9px] text-slate-600 font-mono">lr <span className="text-slate-500">{Number(cfgLr).toExponential(0)}</span></span>}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Right main panel */}
          <div className="flex-1 overflow-y-auto">
            {!selectedPreset ? (
              <div className="flex items-center justify-center h-full text-slate-700 text-sm">
                {mode === 'cloud' ? 'Select a preset from the left to begin.' : serverRunning ? 'Select a preset from the left to begin.' : 'Start the server, then select a preset.'}
              </div>
            ) : (
              <div className="p-6 space-y-5 max-w-3xl">

                {/* ── Section 1: Base Model ── */}
                <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">1 · Base Model</p>
                    {selectedCheckpoint && (
                      <button onClick={() => { setSelectedCheckpoint(''); setCheckpointFiles([]); setR2Checkpoints([]) }}
                        className="text-[10px] text-slate-500 hover:text-white transition-colors">
                        Reset
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                    <span className="text-[10px] text-slate-600 font-mono shrink-0">
                      {mode === 'cloud' ? 'r2_key:' : 'base_model_name:'}
                    </span>
                    <span className="text-[11px] text-slate-300 font-mono truncate flex-1">
                      {selectedCheckpoint || String(selectedPreset.config.base_model_name ?? '—')}
                    </span>
                    {selectedCheckpoint
                      ? <CheckCircle size={11} className="text-emerald-400 shrink-0" />
                      : <span className="text-[10px] text-slate-600 shrink-0">preset default</span>}
                  </div>

                  {mode === 'local' ? (
                    <>
                      <div className="flex gap-2">
                        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] focus-within:border-violet-500/30 transition-colors">
                          <FolderOpen size={11} className="text-slate-600 shrink-0" />
                          <input
                            value={scanDir}
                            onChange={e => setScanDir(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && scanCheckpoints()}
                            placeholder="C:\Users\Owner\Downloads"
                            className="flex-1 bg-transparent text-[11px] text-white placeholder:text-slate-700 focus:outline-none font-mono"
                          />
                        </div>
                        <button onClick={scanCheckpoints} disabled={scanLoading || !scanDir.trim()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white hover:border-white/20 text-[11px] transition-all disabled:opacity-40">
                          {scanLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                          Scan
                        </button>
                      </div>
                      {checkpointFiles.length > 0 ? (
                        <div className="space-y-1.5">
                          {checkpointFiles.map(f => (
                            <button key={f.path}
                              onClick={() => setSelectedCheckpoint(selectedCheckpoint === f.path ? '' : f.path)}
                              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                                selectedCheckpoint === f.path
                                  ? 'border-violet-500/40 bg-violet-500/10'
                                  : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15'
                              }`}>
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-white truncate">{f.name.replace(/\.(safetensors|ckpt|pt)$/i, '')}</p>
                                <p className="text-[10px] text-slate-600 font-mono mt-0.5">{f.size_gb} GB · {f.name.split('.').pop()?.toLowerCase()}</p>
                              </div>
                              {selectedCheckpoint === f.path
                                ? <CheckCircle size={12} className="text-violet-400 shrink-0" />
                                : <div className="w-3 h-3 rounded-full border border-white/20 shrink-0" />}
                            </button>
                          ))}
                        </div>
                      ) : !scanLoading && (
                        <p className="text-[10px] text-slate-700">
                          Enter a folder path and click Scan to find .safetensors / .ckpt files.
                        </p>
                      )}
                    </>
                  ) : (
                    /* Cloud: R2 checkpoint picker */
                    <>
                      <button onClick={loadR2Checkpoints} disabled={r2CheckpointsLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white hover:border-white/20 text-[11px] transition-all disabled:opacity-40">
                        {r2CheckpointsLoading ? <Loader2 size={11} className="animate-spin" /> : <Cloud size={11} />}
                        Load checkpoints from R2
                      </button>

                      {r2Checkpoints.length > 0 && (
                        <div className="space-y-1.5">
                          {r2Checkpoints.map(f => (
                            <button key={f.key}
                              onClick={() => setSelectedCheckpoint(selectedCheckpoint === f.key ? '' : f.key)}
                              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                                selectedCheckpoint === f.key
                                  ? 'border-violet-500/40 bg-violet-500/10'
                                  : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15'
                              }`}>
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-white truncate">{f.name.replace(/\.(safetensors|ckpt|pt)$/i, '')}</p>
                                <p className="text-[10px] text-slate-600 font-mono mt-0.5">
                                  {f.size_gb} GB · {f.name.split('.').pop()?.toLowerCase()}
                                  {f.last_modified && ` · ${new Date(f.last_modified).toLocaleDateString()}`}
                                </p>
                              </div>
                              {selectedCheckpoint === f.key
                                ? <CheckCircle size={12} className="text-violet-400 shrink-0" />
                                : <div className="w-3 h-3 rounded-full border border-white/20 shrink-0" />}
                            </button>
                          ))}
                        </div>
                      )}

                      {!r2CheckpointsLoading && r2Checkpoints.length === 0 && (
                        <p className="text-[10px] text-slate-700">
                          Click above to list checkpoints from R2. Upload checkpoints to <span className="font-mono text-slate-600">training/checkpoints/</span> in your R2 bucket.
                        </p>
                      )}
                    </>
                  )}
                </div>

                {/* ── Section 2: Run Settings ── */}
                <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">2 · Run Settings</p>
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Run name</label>
                    <input value={runName} onChange={e => setRunName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-violet-500/40" />
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {([
                      ['Learning Rate', lr,         setLr,         'e.g. 0.0001',          'number'],
                      ['Batch Size',    batchSize,  setBatchSize,  'e.g. 2',                'number'],
                      ['Epochs',        epochs,     setEpochs,     'e.g. 1',                'number'],
                      ['Max Steps',     maxSteps,   setMaxSteps,   'e.g. 1000',             'number'],
                      ['Resolution',    resolution, setResolution, 'e.g. 768',              'text'  ],
                      ['LoRA Rank',     loraRank,   setLoraRank,   'e.g. 16',               'number'],
                      ['Output Path',   outputPath, setOutputPath, 'path/lora.safetensors', 'text'  ],
                    ] as const).map(([label, val, setter, ph, type]) => (
                      <div key={label} className="space-y-1.5">
                        <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono flex items-center gap-1">
                          {label}
                          <span className="text-slate-700 normal-case font-sans">
                            {val ? '' : `(preset: ${selectedPreset.config[
                              ({ 'Learning Rate': 'learning_rate', 'Batch Size': 'batch_size',
                                 'Epochs': 'epochs', 'Resolution': 'resolution',
                                 'Output Path': 'output_model_destination' } as Record<string, string>)[label] ?? ''
                            ] ?? '—'})`}
                          </span>
                        </label>
                        <input
                          type={type}
                          value={val}
                          onChange={e => setter(e.target.value)}
                          placeholder={ph}
                          className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-700 focus:outline-none focus:border-violet-500/40"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Section 3: Training Concepts ── */}
                <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">3 · Training Concepts</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">
                        {mode === 'local' ? 'Each concept is a local folder of images.' : 'Upload a .zip of your image + caption pairs for each concept.'}
                      </p>
                    </div>
                    <button onClick={() => setConcepts(p => [...p, emptyConcept()])}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white text-[11px] transition-all">
                      <Plus size={11} /> Add concept
                    </button>
                  </div>

                  <div className="space-y-3">
                    {concepts.map((c, i) => (
                      <div key={c.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-600 font-mono shrink-0">#{i + 1}</span>
                          <input value={c.name} onChange={e => updateConcept(c.id, { name: e.target.value })}
                            placeholder="Concept name"
                            className="flex-1 bg-transparent text-xs font-medium text-white placeholder:text-slate-600 focus:outline-none" />
                          {concepts.length > 1 && (
                            <button onClick={() => setConcepts(p => p.filter(x => x.id !== c.id))}
                              className="p-1 rounded hover:bg-red-500/10 text-slate-700 hover:text-red-400 transition-colors">
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {mode === 'local' ? (
                            <div className="space-y-1 col-span-2">
                              <label className="text-[9px] text-slate-600 uppercase tracking-wider font-mono">Image folder path</label>
                              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] focus-within:border-violet-500/30 transition-colors">
                                <FolderOpen size={11} className="text-slate-600 shrink-0" />
                                <input value={c.path} onChange={e => updateConcept(c.id, { path: e.target.value })}
                                  placeholder="C:\Training\datasets\my-dataset"
                                  className="flex-1 bg-transparent text-[11px] text-white placeholder:text-slate-700 focus:outline-none font-mono" />
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1.5 col-span-2">
                              <label className="text-[9px] text-slate-600 uppercase tracking-wider font-mono">Dataset (.zip of images + captions)</label>
                              {c.r2DatasetKey ? (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                                  <CheckCircle size={11} className="text-emerald-400 shrink-0" />
                                  <span className="flex-1 text-[11px] text-emerald-300 font-mono truncate">{c.r2DatasetKey}</span>
                                  <button onClick={() => updateConcept(c.id, { r2DatasetKey: '' })}
                                    className="text-slate-600 hover:text-red-400 transition-colors">
                                    <X size={11} />
                                  </button>
                                </div>
                              ) : c.uploadProgress !== undefined ? (
                                <div className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08]">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[10px] text-slate-400">Uploading…</span>
                                    <span className="text-[10px] text-slate-500 font-mono">{c.uploadProgress}%</span>
                                  </div>
                                  <div className="h-1 rounded-full bg-white/[0.08]">
                                    <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${c.uploadProgress}%` }} />
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => triggerDatasetUpload(c.id)}
                                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-dashed border-white/[0.12] text-slate-500 hover:text-white hover:border-white/25 text-[11px] transition-all w-full">
                                  <Upload size={11} />
                                  Click to upload dataset .zip
                                </button>
                              )}
                              <input
                                type="file"
                                accept=".zip"
                                className="hidden"
                                ref={el => { fileInputRefs.current[c.id] = el }}
                                onChange={e => {
                                  const file = e.target.files?.[0]
                                  if (file) handleDatasetFile(c.id, file)
                                  e.target.value = ''
                                }}
                              />
                            </div>
                          )}

                          <div className="space-y-1">
                            <label className="text-[9px] text-slate-600 uppercase tracking-wider font-mono">Caption source</label>
                            <div className="relative">
                              <select value={c.prompt_source} onChange={e => updateConcept(c.id, { prompt_source: e.target.value as Concept['prompt_source'] })}
                                className="w-full appearance-none border border-white/[0.08] rounded-lg px-2 py-1.5 text-[11px] focus:outline-none focus:border-violet-500/40 pr-6"
                                style={{ backgroundColor: '#131320', color: '#cbd5e1' }}>
                                <option value="sample"   style={{ backgroundColor: '#131320', color: '#cbd5e1' }}>txt files (same name as image)</option>
                                <option value="filename" style={{ backgroundColor: '#131320', color: '#cbd5e1' }}>Image filename as prompt</option>
                                <option value="concept"  style={{ backgroundColor: '#131320', color: '#cbd5e1' }}>Single prompt file</option>
                              </select>
                              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[9px] text-slate-600 uppercase tracking-wider font-mono">Repeats</label>
                            <input type="number" min="0.1" step="0.1" value={c.repeats}
                              onChange={e => updateConcept(c.id, { repeats: parseFloat(e.target.value) || 1 })}
                              className="w-full px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] text-white focus:outline-none focus:border-violet-500/40" />
                          </div>

                          {c.prompt_source === 'concept' && (
                            <div className="space-y-1 col-span-2">
                              <label className="text-[9px] text-slate-600 uppercase tracking-wider font-mono">Prompt file path</label>
                              <input value={c.prompt_path} onChange={e => updateConcept(c.id, { prompt_path: e.target.value })}
                                placeholder="C:\Training\prompts.txt"
                                className="w-full px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] text-white placeholder:text-slate-700 focus:outline-none focus:border-violet-500/40 font-mono" />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Start button */}
                <button onClick={startTraining} disabled={!canTrain || launching}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-300 text-sm font-semibold hover:bg-violet-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  {launching ? <Loader2 size={15} className="animate-spin" /> : mode === 'cloud' ? <Cloud size={15} /> : <Play size={15} />}
                  {launching ? 'Launching…' : isTraining ? 'Training in progress…' : mode === 'cloud' ? 'Train on RunPod' : 'Start Training'}
                </button>

              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Monitor tab ── */}
      {tab === 'monitor' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4 max-w-3xl mx-auto">

            <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex items-center gap-2 text-sm font-semibold ${statusColor(activeStatus)}`}>
                    {activeStatus === 'running'   && <Loader2 size={14} className="animate-spin" />}
                    {activeStatus === 'done'      && <CheckCircle size={14} />}
                    {activeStatus === 'error'     && <AlertCircle size={14} />}
                    {activeStatus === 'idle'      && <Cpu size={14} />}
                    {activeStatus === 'cancelled' && <X size={14} />}
                    {statusLabel(activeStatus)}
                  </div>
                  {activeRunName && <span className="text-xs text-slate-500">{activeRunName}</span>}
                  {mode === 'local' && trainStatus.pid && (
                    <span className="text-[10px] text-slate-700 font-mono">PID {trainStatus.pid}</span>
                  )}
                  {mode === 'cloud' && cloudJobId && (
                    <span className="text-[10px] text-slate-700 font-mono">Job {cloudJobId.slice(0, 12)}…</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={fetchStatus} className="p-1.5 rounded hover:bg-white/[0.06] text-slate-600 hover:text-slate-400 transition-colors">
                    <RefreshCw size={11} />
                  </button>
                  {isTraining && (
                    <button onClick={cancelTraining}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs hover:bg-red-500/15 transition-all">
                      <Square size={10} /> Cancel
                    </button>
                  )}
                </div>
              </div>

              {activeStarted && (
                <p className="text-[10px] text-slate-600 mt-2">
                  Started {new Date(activeStarted * 1000).toLocaleTimeString()}
                  {mode === 'local' && activeStatus !== 'running' && trainStatus.returncode !== null && ` · Exit code ${trainStatus.returncode}`}
                  {mode === 'cloud' && cloudStatus?.elapsed_min && ` · ${cloudStatus.elapsed_min} min`}
                </p>
              )}

              {/* Cloud: output LoRA key when done */}
              {mode === 'cloud' && cloudStatus?.output_r2_key && (
                <LoraDownloadBlock r2Key={cloudStatus.output_r2_key} adminHeaders={ah()} />
              )}

              {/* Cloud: error */}
              {mode === 'cloud' && cloudStatus?.error && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
                  <p className="text-[10px] text-red-400">{cloudStatus.error}</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#07070e] p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] text-slate-600 uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <Terminal size={10} /> Training Log
                </p>
                <span className="text-[10px] text-slate-700">{activeLogs.length} lines</span>
              </div>
              {activeLogs.length === 0 ? (
                <p className="text-xs text-slate-700 font-mono text-center py-8">
                  {mode === 'cloud' && isTraining ? 'Waiting for first log update — logs flush from RunPod every 30 seconds.' : 'No logs yet — start a training run.'}
                </p>
              ) : (
                <div className="space-y-0.5 font-mono text-[11px]">
                  {activeLogs.map((line, i) => {
                    const isErr  = /error|exception|traceback/i.test(line)
                    const isWarn = /warn|warning/i.test(line)
                    const isStep = /step|epoch|loss/i.test(line)
                    return (
                      <p key={i} className={
                        isErr  ? 'text-red-400' :
                        isWarn ? 'text-amber-400' :
                        isStep ? 'text-emerald-400' :
                        line.startsWith('[server]') || line.startsWith('[runpod]') ? 'text-violet-400' :
                        'text-slate-400'
                      }>{line}</p>
                    )
                  })}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>

            {/* Cloud: RunPod dashboard link */}
            {mode === 'cloud' && cloudJobId && (
              <a href="https://www.runpod.io/console/serverless" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors">
                <ExternalLink size={11} /> View job on RunPod dashboard
              </a>
            )}

            {!isTraining && (
              <button onClick={() => setTab('config')}
                className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-400 transition-colors">
                <Settings2 size={11} /> Configure a new run
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Saved LoRAs tab ── */}
      {tab === 'loras' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-4">

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-white">Saved LoRAs</p>
                <p className="text-[11px] text-slate-600 mt-0.5">All completed training outputs stored in R2 under <span className="font-mono">training/loras/</span></p>
              </div>
              <button onClick={loadR2Loras} disabled={r2LorasLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white hover:border-white/20 text-[11px] transition-all disabled:opacity-40">
                {r2LorasLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Refresh
              </button>
            </div>

            {r2LorasLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-slate-600" />
              </div>
            )}

            {!r2LorasLoading && r2Loras.length === 0 && (
              <div className="text-center py-12 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
                <Zap size={28} className="mx-auto text-slate-700 mb-3" />
                <p className="text-sm text-slate-600">No LoRAs found</p>
                <p className="text-[11px] text-slate-700 mt-1">Completed training runs will appear here automatically.</p>
              </div>
            )}

            {r2Loras.length > 0 && (
              <div className="space-y-2">
                {r2Loras.map(f => (
                  <LoraListItem key={f.key} file={f} adminHeaders={ah()} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
