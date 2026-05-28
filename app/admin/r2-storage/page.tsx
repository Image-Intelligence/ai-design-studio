"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  ArrowLeft, Upload, Trash2, RefreshCw, Loader2, CheckCircle,
  AlertCircle, HardDrive, Database, Brain, Cloud, FolderOpen, X,
} from "lucide-react"

// ─── Constants ────────────────────────────────────────────────────────────────

const CHUNK_SIZE   = 50 * 1024 * 1024  // 50 MB per part
const CONCURRENCY  = 3                  // parallel part uploads

const TABS = [
  {
    id:          'checkpoints',
    label:       'Checkpoints',
    prefix:      'training/checkpoints/',
    accept:      '.safetensors,.ckpt,.pt',
    description: 'Base model checkpoints used for training (safetensors, ckpt, pt)',
    readOnly:    false,
  },
  {
    id:          'models',
    label:       'Required Models',
    prefix:      'training/models/',
    accept:      '.safetensors',
    description: 'CLIP, T5, and VAE files required by the RunPod worker',
    readOnly:    false,
  },
  {
    id:          'datasets',
    label:       'Datasets',
    prefix:      'training/datasets/',
    accept:      '.zip',
    description: 'Training image + caption datasets (zipped folders)',
    readOnly:    false,
  },
  {
    id:          'loras',
    label:       'Trained LoRAs',
    prefix:      'training/loras/',
    accept:      null,
    description: 'Output LoRA files from completed training runs',
    readOnly:    true,
  },
] as const

type TabId = typeof TABS[number]['id']

const REQUIRED_MODELS = [
  {
    filename:    'clip_l.safetensors',
    label:       'CLIP-L',
    description: 'CLIP text encoder · ~250 MB',
  },
  {
    filename:    't5xxl_fp8_e4m3fn.safetensors',
    label:       'T5-XXL (fp8)',
    description: 'T5 text encoder in fp8 · ~8 GB',
  },
  {
    filename:    'flux_vae.safetensors',
    label:       'Flux VAE',
    description: 'Variational autoencoder · ~167 MB',
  },
] as const

const ESRGAN_MODELS = [
  {
    filename:    '4x-UltraSharp.pth',
    label:       '4x-UltraSharp',
    description: 'ESRGAN 4× super-resolution · ~64 MB · required for UltraSharp upscale mode',
  },
] as const

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileEntry {
  key:           string
  name:          string
  size_bytes:    number
  last_modified: string | null
}

interface UploadJob {
  id:             string
  filename:       string
  targetKey:      string
  uploadId:       string | null
  totalParts:     number
  completedParts: number
  status:         'starting' | 'uploading' | 'completing' | 'done' | 'error'
  error?:         string
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function ah(): Record<string, string> {
  try {
    const p = sessionStorage.getItem('admin-password')
    return p ? { 'x-admin-password': p } : {}
  } catch { return {} }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.round(bytes / 1e3)} KB`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function R2StoragePage() {
  const [activeTab,     setActiveTab]     = useState<TabId>('checkpoints')
  const [filesByPrefix, setFilesByPrefix] = useState<Record<string, FileEntry[]>>({})
  const [loading,       setLoading]       = useState<Record<string, boolean>>({})
  const [jobs,          setJobs]          = useState<UploadJob[]>([])
  const [deleting,      setDeleting]      = useState<Set<string>>(new Set())
  const [dragOver,      setDragOver]      = useState(false)

  const jobsRef        = useRef<UploadJob[]>([])
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const modelRefs      = useRef<Record<string, HTMLInputElement | null>>({})

  const currentTab = TABS.find(t => t.id === activeTab)!

  // ── Job state helpers ──────────────────────────────────────────────────────

  function addJob(job: UploadJob) {
    jobsRef.current = [...jobsRef.current, job]
    setJobs([...jobsRef.current])
  }

  function patchJob(id: string, patch: Partial<UploadJob>) {
    jobsRef.current = jobsRef.current.map(j => j.id === id ? { ...j, ...patch } : j)
    setJobs([...jobsRef.current])
  }

  function removeJob(id: string) {
    jobsRef.current = jobsRef.current.filter(j => j.id !== id)
    setJobs([...jobsRef.current])
  }

  // ── File listing ───────────────────────────────────────────────────────────

  const loadFiles = useCallback(async (prefix: string) => {
    setLoading(prev => ({ ...prev, [prefix]: true }))
    try {
      const res = await fetch(`/api/admin/r2/files?prefix=${encodeURIComponent(prefix)}`, { headers: ah() })
      if (res.ok) {
        const files = await res.json()
        setFilesByPrefix(prev => ({ ...prev, [prefix]: files }))
      }
    } catch {}
    finally { setLoading(prev => ({ ...prev, [prefix]: false })) }
  }, [])

  useEffect(() => {
    loadFiles(currentTab.prefix)
    if (activeTab === 'models') loadFiles('training/models/esrgan/')
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function deleteFile(key: string, prefix: string) {
    if (!confirm(`Delete "${key.split('/').pop()}"?`)) return
    setDeleting(prev => new Set(prev).add(key))
    try {
      await fetch('/api/admin/r2/files', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json', ...ah() },
        body:    JSON.stringify({ key }),
      })
      await loadFiles(prefix)
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }

  // ── Multipart upload ───────────────────────────────────────────────────────

  async function uploadFile(file: File, targetKey: string, prefix: string) {
    const jobId      = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const totalParts = Math.ceil(file.size / CHUNK_SIZE)

    addJob({ id: jobId, filename: file.name, targetKey, uploadId: null, totalParts, completedParts: 0, status: 'starting' })

    // 1. Start
    let uploadId: string
    try {
      const r = await fetch('/api/admin/r2/upload/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...ah() },
        body:    JSON.stringify({ key: targetKey, contentType: 'application/octet-stream' }),
      })
      if (!r.ok) throw new Error(`Start failed: ${r.status}`)
      uploadId = (await r.json()).uploadId
      patchJob(jobId, { uploadId, status: 'uploading' })
    } catch (err) {
      patchJob(jobId, { status: 'error', error: String(err) })
      return
    }

    // 2. Upload parts with concurrency
    const queue  = Array.from({ length: totalParts }, (_, i) => i + 1)
    const parts: { partNumber: number; etag: string }[] = []
    let failed = false

    async function worker() {
      while (queue.length > 0 && !failed) {
        const pn = queue.shift()
        if (pn === undefined) break
        const start = (pn - 1) * CHUNK_SIZE
        const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size))
        try {
          const r = await fetch(
            `/api/admin/r2/upload/part?key=${encodeURIComponent(targetKey)}&uploadId=${uploadId}&partNumber=${pn}`,
            { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...ah() }, body: chunk }
          )
          if (!r.ok) throw new Error(`Part ${pn} failed: ${r.status}`)
          const { etag } = await r.json()
          parts.push({ partNumber: pn, etag })
          patchJob(jobId, { completedParts: parts.length })
        } catch (err) {
          failed = true
          patchJob(jobId, { status: 'error', error: String(err) })
          fetch('/api/admin/r2/upload/abort', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...ah() },
            body: JSON.stringify({ key: targetKey, uploadId }),
          }).catch(() => {})
        }
      }
    }

    await Promise.all(Array(Math.min(CONCURRENCY, totalParts)).fill(null).map(() => worker()))
    if (failed) return

    // 3. Complete
    patchJob(jobId, { status: 'completing' })
    try {
      const r = await fetch('/api/admin/r2/upload/complete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...ah() },
        body:    JSON.stringify({ key: targetKey, uploadId, parts }),
      })
      if (!r.ok) throw new Error(`Complete failed: ${r.status}`)
      patchJob(jobId, { status: 'done', completedParts: totalParts })
      await loadFiles(prefix)
      setTimeout(() => removeJob(jobId), 4000)
    } catch (err) {
      patchJob(jobId, { status: 'error', error: String(err) })
    }
  }

  // ── File selection handlers ────────────────────────────────────────────────

  function handleFiles(files: FileList | null, prefix: string) {
    if (!files) return
    Array.from(files).forEach(f => uploadFile(f, `${prefix}${f.name}`, prefix))
  }

  function handleModelFile(file: File, filename: string) {
    uploadFile(file, `training/models/${filename}`, 'training/models/')
  }

  function handleEsrganModelFile(file: File, filename: string) {
    uploadFile(file, `training/models/esrgan/${filename}`, 'training/models/esrgan/')
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const activeJobs    = jobs.filter(j => j.status !== 'done')
  const currentFiles  = filesByPrefix[currentTab.prefix] ?? []
  const isLoading     = loading[currentTab.prefix]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-[#09090f] text-white flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-white/[0.06] px-4 py-3 flex items-center gap-3">
        <button onClick={() => window.location.href = '/admin'}
          className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-white transition-colors">
          <ArrowLeft size={14} />
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-white">R2 Storage</h1>
          <p className="text-[11px] text-slate-600">Upload and manage training files</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-orange-500/25 bg-orange-500/8 text-orange-400 text-[11px]">
          <HardDrive size={9} />
          Cloudflare R2
        </div>
      </div>

      {/* ── Active uploads bar ── */}
      {activeJobs.length > 0 && (
        <div className="shrink-0 bg-violet-500/5 border-b border-violet-500/15 px-4 py-3 space-y-2.5">
          {activeJobs.map(job => {
            const pct = job.totalParts > 0 ? Math.round(job.completedParts / job.totalParts * 100) : 0
            return (
              <div key={job.id}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {job.status === 'error'
                      ? <AlertCircle size={10} className="text-red-400" />
                      : <Loader2 size={10} className="text-violet-400 animate-spin" />}
                    <span className="text-[11px] text-white font-medium">{job.filename}</span>
                    <span className="text-[10px] text-slate-500 font-mono">→ {job.targetKey}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    {job.status === 'starting'   ? 'Starting…' :
                     job.status === 'completing' ? 'Finalizing…' :
                     job.status === 'error'      ? `Error: ${job.error}` :
                     `${pct}% · ${job.completedParts}/${job.totalParts} parts`}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${job.status === 'error' ? 'bg-red-500' : 'bg-violet-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="shrink-0 border-b border-white/[0.06] px-4">
        <div className="flex">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-violet-500 text-white'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}>
              {tab.id === 'checkpoints' && <Brain size={11} />}
              {tab.id === 'models'      && <Cloud size={11} />}
              {tab.id === 'datasets'    && <Database size={11} />}
              {tab.id === 'loras'       && <FolderOpen size={11} />}
              {tab.label}
              {/* Badge: number of files */}
              {(filesByPrefix[tab.prefix]?.length ?? 0) > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-white/[0.06] text-slate-500 text-[9px] font-mono">
                  {filesByPrefix[tab.prefix]!.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-5">

          {/* Tab description */}
          <p className="text-[11px] text-slate-600">{currentTab.description}</p>

          {/* ── Required Models: special fixed-slot layout ── */}
          {activeTab === 'models' && (
            <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Required for Flux Training</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">All 3 must exist in R2 before the worker can start training.</p>
                </div>
                <button onClick={() => loadFiles('training/models/')}
                  className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-600 hover:text-slate-400 transition-colors">
                  {loading['training/models/'] ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                </button>
              </div>

              <div className="space-y-2">
                {REQUIRED_MODELS.map(model => {
                  const existing = (filesByPrefix['training/models/'] ?? []).find(f => f.name === model.filename)
                  const job      = jobs.find(j => j.targetKey === `training/models/${model.filename}`)

                  return (
                    <div key={model.filename}
                      className="flex items-center gap-4 px-4 py-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">

                      {/* Status dot */}
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        job       ? 'bg-violet-400 animate-pulse' :
                        existing  ? 'bg-emerald-400' :
                                    'bg-red-500/60'
                      }`} />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-semibold text-white">{model.label}</p>
                          {existing && !job && (
                            <span className="text-[9px] text-emerald-400 font-mono">{fmt(existing.size_bytes)}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-600 font-mono mt-0.5">{model.filename}</p>
                        <p className="text-[10px] text-slate-700 mt-0.5">{model.description}</p>
                      </div>

                      {/* Action */}
                      {job ? (
                        <div className="text-[10px] font-mono text-violet-400 shrink-0">
                          {job.status === 'starting'   ? 'Starting…' :
                           job.status === 'completing' ? 'Finishing…' :
                           job.status === 'done'       ? '✓ Done!' :
                           job.status === 'error'      ? `Error` :
                           `${Math.round(job.completedParts / job.totalParts * 100)}%`}
                        </div>
                      ) : existing ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <CheckCircle size={12} className="text-emerald-400" />
                          <button onClick={() => modelRefs.current[model.filename]?.click()}
                            className="text-[10px] text-slate-500 hover:text-white px-2 py-1 rounded-lg border border-white/[0.08] hover:border-white/20 transition-all">
                            Replace
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => modelRefs.current[model.filename]?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/25 text-violet-300 text-[11px] hover:bg-violet-500/20 transition-all shrink-0">
                          <Upload size={10} /> Upload
                        </button>
                      )}

                      <input
                        type="file"
                        accept=".safetensors"
                        className="hidden"
                        ref={el => { modelRefs.current[model.filename] = el }}
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) handleModelFile(f, model.filename)
                          e.target.value = ''
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── ESRGAN Upscale Models ── */}
          {activeTab === 'models' && (
            <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ESRGAN Upscale Models</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">.pth files used by the RunPod worker for ESRGAN upscaling.</p>
                </div>
                <button onClick={() => loadFiles('training/models/esrgan/')}
                  className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-600 hover:text-slate-400 transition-colors">
                  {loading['training/models/esrgan/'] ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                </button>
              </div>

              <div className="space-y-2">
                {ESRGAN_MODELS.map(model => {
                  const existing = (filesByPrefix['training/models/esrgan/'] ?? []).find(f => f.name === model.filename)
                  const job      = jobs.find(j => j.targetKey === `training/models/esrgan/${model.filename}`)
                  return (
                    <div key={model.filename}
                      className="flex items-center gap-4 px-4 py-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        job      ? 'bg-violet-400 animate-pulse' :
                        existing ? 'bg-emerald-400' :
                                   'bg-amber-500/60'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-semibold text-white">{model.label}</p>
                          {existing && !job && (
                            <span className="text-[9px] text-emerald-400 font-mono">{fmt(existing.size_bytes)}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-600 font-mono mt-0.5">{model.filename}</p>
                        <p className="text-[10px] text-slate-700 mt-0.5">{model.description}</p>
                      </div>
                      {job ? (
                        <div className="text-[10px] font-mono text-violet-400 shrink-0">
                          {job.status === 'starting'   ? 'Starting…' :
                           job.status === 'completing' ? 'Finishing…' :
                           job.status === 'done'       ? '✓ Done!' :
                           job.status === 'error'      ? 'Error' :
                           `${Math.round(job.completedParts / job.totalParts * 100)}%`}
                        </div>
                      ) : existing ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <CheckCircle size={12} className="text-emerald-400" />
                          <button onClick={() => modelRefs.current[`esrgan_${model.filename}`]?.click()}
                            className="text-[10px] text-slate-500 hover:text-white px-2 py-1 rounded-lg border border-white/[0.08] hover:border-white/20 transition-all">
                            Replace
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => modelRefs.current[`esrgan_${model.filename}`]?.click()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-300 text-[11px] hover:bg-amber-500/20 transition-all shrink-0">
                          <Upload size={10} /> Upload
                        </button>
                      )}
                      <input
                        type="file"
                        accept=".pth"
                        className="hidden"
                        ref={el => { modelRefs.current[`esrgan_${model.filename}`] = el }}
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) handleEsrganModelFile(f, model.filename)
                          e.target.value = ''
                        }}
                      />
                    </div>
                  )
                })}
              </div>

              {/* Upload arbitrary .pth */}
              <input
                type="file"
                accept=".pth"
                className="hidden"
                ref={el => { modelRefs.current['esrgan_custom'] = el }}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleEsrganModelFile(f, f.name)
                  e.target.value = ''
                }}
              />
              <button onClick={() => modelRefs.current['esrgan_custom']?.click()}
                className="w-full py-2 rounded-xl border border-dashed border-white/[0.08] text-[11px] text-slate-600 hover:text-slate-400 hover:border-white/[0.15] transition-all flex items-center justify-center gap-1.5">
                <Upload size={10} /> Upload custom .pth file
              </button>
            </div>
          )}

          {/* ── Upload zone (all tabs except models and loras) ── */}
          {activeTab !== 'models' && !currentTab.readOnly && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault()
                setDragOver(false)
                handleFiles(e.dataTransfer.files, currentTab.prefix)
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-2xl border-2 border-dashed p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all select-none ${
                dragOver
                  ? 'border-violet-500/60 bg-violet-500/5'
                  : 'border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.015]'
              }`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                dragOver ? 'bg-violet-500/20' : 'bg-white/[0.04]'
              }`}>
                <Upload size={18} className={dragOver ? 'text-violet-300' : 'text-slate-500'} />
              </div>
              <div className="text-center">
                <p className="text-sm text-slate-300 font-medium">
                  {dragOver ? 'Drop to upload' : 'Drop files here or click to browse'}
                </p>
                <p className="text-[11px] text-slate-600 mt-1">
                  {activeTab === 'checkpoints' && 'Accepts .safetensors · .ckpt · .pt — large files supported'}
                  {activeTab === 'datasets'    && 'Accepts .zip — create a zip of your images + caption .txt files'}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={currentTab.accept ?? undefined}
                className="hidden"
                onChange={e => { handleFiles(e.target.files, currentTab.prefix); e.target.value = '' }}
              />
            </div>
          )}

          {/* ── File list ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">
                  {currentTab.prefix}
                </p>
                {currentTab.readOnly && (
                  <p className="text-[9px] text-slate-700 mt-0.5">Read-only — files are written by training runs</p>
                )}
              </div>
              <button onClick={() => loadFiles(currentTab.prefix)}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-600 hover:text-slate-400 transition-colors">
                {isLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              </button>
            </div>

            {isLoading ? (
              <div className="p-10 flex items-center justify-center">
                <Loader2 size={18} className="animate-spin text-slate-700" />
              </div>
            ) : currentFiles.length === 0 ? (
              <div className="p-10 text-center space-y-1">
                <p className="text-sm text-slate-600">No files here yet</p>
                {!currentTab.readOnly && (
                  <p className="text-[11px] text-slate-700">Upload files using the zone above.</p>
                )}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {currentFiles.map(file => {
                  const job = jobs.find(j => j.targetKey === file.key)
                  return (
                    <div key={file.key}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-white truncate">{file.name}</p>
                        <p className="text-[10px] text-slate-600 font-mono mt-0.5">
                          {fmt(file.size_bytes)}
                          {file.last_modified && ` · ${new Date(file.last_modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                        </p>
                      </div>

                      {job && (
                        <div className="text-[10px] text-violet-400 font-mono shrink-0">
                          {job.status === 'starting'   ? 'Starting…' :
                           job.status === 'completing' ? 'Finishing…' :
                           job.status === 'done'       ? '✓ Done!' :
                           `${Math.round(job.completedParts / job.totalParts * 100)}% uploading`}
                        </div>
                      )}

                      {!currentTab.readOnly && !job && (
                        <button
                          onClick={() => deleteFile(file.key, currentTab.prefix)}
                          disabled={deleting.has(file.key)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-700 hover:text-red-400 transition-colors disabled:opacity-40 shrink-0">
                          {deleting.has(file.key)
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Trash2 size={12} />}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Upload key reference for Models tab ── */}
          {activeTab === 'models' && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">R2 Key Reference</p>
              {REQUIRED_MODELS.map(m => (
                <div key={m.filename} className="flex items-center gap-2">
                  <code className="text-[10px] text-slate-400 font-mono">training/models/{m.filename}</code>
                </div>
              ))}
              {ESRGAN_MODELS.map(m => (
                <div key={m.filename} className="flex items-center gap-2">
                  <code className="text-[10px] text-amber-500/70 font-mono">training/models/esrgan/{m.filename}</code>
                </div>
              ))}
              <p className="text-[10px] text-slate-700 mt-2">
                These exact paths are expected by the RunPod worker. Uploading via the buttons above sets them automatically.
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
