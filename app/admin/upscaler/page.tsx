"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  ArrowLeft, Play, Square, Server, Loader2, CheckCircle,
  AlertCircle, FolderOpen, ChevronDown, Copy, RefreshCw,
  Zap, Brain, Terminal
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ArchInfo {
  id:        string
  label:     string
  desc:      string
  setup:     string
  installed: boolean
  path:      string
}

interface TrainStatus {
  status:     string
  arch:       string | null
  logs:       string[]
  iter:       number
  total_iter: number
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function pw() { try { return sessionStorage.getItem('admin-password') || '' } catch { return '' } }
function ah(): Record<string, string> { const p = pw(); return p ? { 'x-admin-password': p } : {} }
function aj(): Record<string, string> { return { 'Content-Type': 'application/json', ...ah() } }

// ── Constants ─────────────────────────────────────────────────────────────────

const SCALES    = [2, 4]
const PATCHES   = [128, 192, 256, 320, 512]
const BATCHES   = [1, 2, 4, 8]
const ITER_OPTS = [
  { label: '50k  — quick test',   value: 50000  },
  { label: '100k — light run',    value: 100000 },
  { label: '200k — solid run',    value: 200000 },
  { label: '400k — full train',   value: 400000 },
]
const SAVE_OPTS = [1000, 2500, 5000, 10000]

const NEOSR_NETS = [
  // CNN / lightweight
  { id: 'span',           label: 'SPAN',       hint: 'Fast · ClearRealityV1 compat', group: 'cnn' },
  { id: 'spanplus',       label: 'SPAN+',      hint: 'Dynamic upsampler variant',    group: 'cnn' },
  { id: 'realplksr',      label: 'RealPLKSR',  hint: 'Real-degradation optimised',   group: 'cnn' },
  { id: 'plksr',          label: 'PLKSR',      hint: 'Large-kernel CNN',             group: 'cnn' },
  { id: 'esrgan',         label: 'ESRGAN',     hint: 'Classic RRDBNet backbone',     group: 'cnn' },
  { id: 'omnisr',         label: 'OmniSR',     hint: 'Omni self-attention, light',   group: 'cnn' },
  { id: 'compact',        label: 'Compact',    hint: 'Ultra-lightweight inference',  group: 'cnn' },
  // Transformer-based
  { id: 'dat_2',          label: 'DAT-2',      hint: 'Nomos8kDAT compat',           group: 'xfm' },
  { id: 'hat_s',          label: 'HAT-S',      hint: 'Hybrid attention, small',      group: 'xfm' },
  { id: 'drct',           label: 'DRCT',       hint: 'Dense residual connection',    group: 'xfm' },
  { id: 'srformer_light', label: 'SRFormer',   hint: 'Shuffled sparse attention',    group: 'xfm' },
  { id: 'man',            label: 'MAN',        hint: 'Multi-scale attention',        group: 'xfm' },
  { id: 'rgt_s',          label: 'RGT-S',      hint: 'Residual global context',      group: 'xfm' },
]

const STATUS_COLOR: Record<string, string> = {
  idle:      'text-slate-500',
  preparing: 'text-amber-400',
  training:  'text-cyan-400',
  done:      'text-emerald-400',
  error:     'text-red-400',
  cancelled: 'text-amber-400',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UpscalerPage() {
  const [tab, setTab] = useState<'config' | 'monitor'>('config')

  // Server
  const [serverRunning, setServerRunning] = useState(false)
  const [serverBusy,    setServerBusy]    = useState(false)

  // Architectures
  const [archs,     setArchs]     = useState<ArchInfo[]>([])
  const [arch,      setArch]      = useState<'esrgan' | 'drct' | 'neosr'>('esrgan')
  const [netType,   setNetType]   = useState('span')
  const [setupOpen, setSetupOpen] = useState<string | null>(null)

  // Config
  const [runName,     setRunName]     = useState('my_upscaler')
  const [datasetPath, setDatasetPath] = useState('')
  const [outputPath,  setOutputPath]  = useState('')
  const [scale,       setScale]       = useState(4)
  const [patchSize,   setPatchSize]   = useState(256)
  const [batchSize,   setBatchSize]   = useState(4)
  const [totalIter,   setTotalIter]   = useState(100000)
  const [lr,          setLr]          = useState('1e-4')
  const [saveFreq,    setSaveFreq]    = useState(5000)

  // Resume support
  const [latestState,   setLatestState]   = useState<{ iter: number; path: string } | null>(null)
  const [resumeEnabled, setResumeEnabled] = useState(false)

  // Pretrain weights
  interface WeightFile { name: string; path: string; arch: string; scale: number }
  const [weights,        setWeights]        = useState<WeightFile[]>([])
  const [selectedWeight, setSelectedWeight] = useState<WeightFile | null>(null)

  // Training state
  const [status, setStatus]         = useState<TrainStatus | null>(null)
  const [showJumpBtn, setShowJumpBtn] = useState(false)
  const logEndRef                    = useRef<HTMLDivElement>(null)
  const logContainerRef              = useRef<HTMLDivElement>(null)
  const pollRef                      = useRef<ReturnType<typeof setInterval> | null>(null)
  const userScrolledUpRef            = useRef(false)
  const hasAutoSwitchedToMonitor     = useRef(false)

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const api = useCallback((path: string) => `/api/admin/upscaler/${path}`, [])

  const checkServer = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/upscaler/server', { headers: ah() })
      if (r.ok) { const d = await r.json(); setServerRunning(d.running) }
    } catch {}
  }, [])

  const loadArchs = useCallback(async () => {
    try {
      const r = await fetch(api('architectures'), { headers: ah() })
      if (r.ok) setArchs(await r.json())
    } catch {}
  }, [api])

  const loadWeights = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/upscaler/scan-weights', { headers: ah() })
      if (r.ok) setWeights(await r.json())
    } catch {}
  }, [])

  const checkLatestState = useCallback(async (name: string) => {
    if (!name.trim()) { setLatestState(null); return }
    try {
      const r = await fetch(api(`latest-state?name=${encodeURIComponent(name.trim())}`), { headers: ah() })
      if (r.ok) {
        const d = await r.json()
        if (d.found) { setLatestState({ iter: d.iter, path: d.path }); setResumeEnabled(true) }
        else { setLatestState(null); setResumeEnabled(false) }
      }
    } catch { setLatestState(null) }
  }, [api])

  const pollStatus = useCallback(async () => {
    try {
      const r = await fetch(api('status'), { headers: ah() })
      if (r.ok) {
        const d: TrainStatus = await r.json()
        setStatus(d)
        if (['done', 'error', 'cancelled'].includes(d.status)) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        }
      }
    } catch {}
  }, [api])

  useEffect(() => {
    checkServer(); loadArchs(); loadWeights(); pollStatus(); checkLatestState(runName)
    pollRef.current = setInterval(pollStatus, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [checkServer, loadArchs, loadWeights, pollStatus, checkLatestState, runName])

  useEffect(() => {
    if (serverRunning) checkLatestState(runName)
  }, [runName, serverRunning, checkLatestState])

  // Auto-scroll only when user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [status?.logs])

  // Auto-switch to Monitor tab on load if a run already exists
  useEffect(() => {
    if (!hasAutoSwitchedToMonitor.current && status && status.status !== 'idle') {
      hasAutoSwitchedToMonitor.current = true
      setTab('monitor')
    }
  }, [status])

  // Clear checkpoint selection when switching to an incompatible framework
  useEffect(() => {
    if (!selectedWeight) return
    const isRRDB      = selectedWeight.arch === 'RRDBNet'
    const isNeoCompat = selectedWeight.arch === 'SPAN' || selectedWeight.arch === 'DAT'
    if (arch === 'esrgan' && !isRRDB)      setSelectedWeight(null)
    if (arch === 'neosr'  && !isNeoCompat) setSelectedWeight(null)
    if (arch === 'drct')                    setSelectedWeight(null)
  }, [arch]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Server control ──────────────────────────────────────────────────────────

  async function startServer() {
    setServerBusy(true)
    try {
      await fetch('/api/admin/upscaler/server', { method: 'POST', headers: ah() })
      await checkServer(); await loadArchs()
    } finally { setServerBusy(false) }
  }

  async function stopServer() {
    setServerBusy(true)
    try {
      await fetch('/api/admin/upscaler/server', { method: 'DELETE', headers: ah() })
      await checkServer()
    } finally { setServerBusy(false) }
  }

  // ── Training control ────────────────────────────────────────────────────────

  async function startTraining() {
    if (!datasetPath.trim() || !outputPath.trim()) return
    const body: Record<string, unknown> = {
      arch,
      name:        runName.trim() || 'my_upscaler',
      datasetPath: datasetPath.trim(),
      outputPath:  outputPath.trim(),
      scale,
      patchSize,
      batchSize,
      totalIter,
      lr:          parseFloat(lr) || 1e-4,
      saveFreq,
    }
    if (arch === 'neosr') body.netType = netType
    if (resumeEnabled && latestState?.path) body.resumeStatePath = latestState.path
    if (selectedWeight && !resumeEnabled) {
      body.pretrainNetworkG = selectedWeight.path
      body.scale = selectedWeight.scale
    }
    await fetch(api('train'), { method: 'POST', headers: aj(), body: JSON.stringify(body) })
    setTab('monitor')
    pollRef.current = setInterval(pollStatus, 2000)
    await pollStatus()
  }

  async function stopTraining() {
    await fetch(api('cancel'), { method: 'POST', headers: ah() })
    await pollStatus()
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const isTraining   = status?.status === 'training' || status?.status === 'preparing'
  const pct          = status && status.total_iter > 0
    ? Math.round((status.iter / status.total_iter) * 100) : 0
  const selectedArch = archs.find(a => a.id === arch)
  const canTrain     = serverRunning && selectedArch?.installed && !isTraining
                       && datasetPath.trim() && outputPath.trim()

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#09090f] text-white">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#09090f]/90 backdrop-blur border-b border-white/[0.06] px-4 py-3 flex items-center gap-3">
        <button onClick={() => window.location.href = '/admin'}
          className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-white transition-colors">
          <ArrowLeft size={14} />
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-white">Upscaler Training</h1>
          <p className="text-[11px] text-slate-600">Train ESRGAN / DRCT / neosr on your 4K character images</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${serverRunning ? 'bg-emerald-400' : 'bg-slate-700'}`} />
          <span className="text-[11px] text-slate-500">{serverRunning ? 'Server running' : 'Server stopped'}</span>
          <button
            onClick={serverRunning ? stopServer : startServer}
            disabled={serverBusy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all disabled:opacity-50 ${
              serverRunning
                ? 'border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/15'
                : 'border-cyan-500/25 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/15'
            }`}>
            {serverBusy ? <Loader2 size={11} className="animate-spin" /> : <Server size={11} />}
            {serverRunning ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/[0.06] px-4">
        <div className="flex gap-0">
          {([['config', 'Configure', Zap], ['monitor', 'Monitor', Terminal]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                tab === id ? 'border-cyan-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}>
              <Icon size={12} /> {label}
              {id === 'monitor' && status && isTraining && (
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* ── Config tab ── */}
        {tab === 'config' && (
          <>
            {/* Architecture */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">1 · Architecture</p>
              <div className="grid grid-cols-2 gap-3">
                {archs.length === 0
                  ? [{ id: 'esrgan' }, { id: 'drct' }, { id: 'neosr' }].map(a => (
                      <div key={a.id}
                        className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 animate-pulse h-24 ${a.id === 'neosr' ? 'col-span-2' : ''}`} />
                    ))
                  : archs.map(a => (
                    <div key={a.id}
                      onClick={() => { if (a.installed) setArch(a.id as 'esrgan' | 'drct' | 'neosr') }}
                      className={`rounded-xl border p-4 transition-all ${a.id === 'neosr' ? 'col-span-2' : ''} ${
                        arch === a.id && a.installed
                          ? 'border-cyan-500/40 bg-cyan-500/10 cursor-pointer'
                          : a.installed
                          ? 'border-white/[0.07] bg-white/[0.02] hover:border-white/15 cursor-pointer'
                          : 'border-white/[0.05] bg-white/[0.01] opacity-60 cursor-not-allowed'
                      }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-white">{a.label}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{a.desc}</p>
                        </div>
                        {a.installed
                          ? <CheckCircle size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                          : <AlertCircle size={13} className="text-slate-600 shrink-0 mt-0.5" />}
                      </div>

                      {/* neosr sub-architecture picker */}
                      {a.id === 'neosr' && arch === 'neosr' && a.installed && (
                        <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
                          <p className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Network</p>
                          <div>
                            <p className="text-[9px] text-slate-700 mb-1.5">CNN / Lightweight</p>
                            <div className="grid grid-cols-4 gap-1.5">
                              {NEOSR_NETS.filter(n => n.group === 'cnn').map(nt => (
                                <button key={nt.id}
                                  onClick={e => { e.stopPropagation(); setNetType(nt.id) }}
                                  className={`py-1.5 px-2 rounded-lg border transition-all text-left ${
                                    netType === nt.id
                                      ? 'border-cyan-500/40 bg-cyan-500/10'
                                      : 'border-white/[0.07] bg-white/[0.03] hover:border-white/15'
                                  }`}>
                                  <p className={`text-[10px] font-semibold leading-tight ${netType === nt.id ? 'text-cyan-300' : 'text-slate-400'}`}>{nt.label}</p>
                                  <p className="text-[9px] text-slate-600 mt-0.5 leading-tight">{nt.hint}</p>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-[9px] text-slate-700 mb-1.5">Transformer</p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {NEOSR_NETS.filter(n => n.group === 'xfm').map(nt => (
                                <button key={nt.id}
                                  onClick={e => { e.stopPropagation(); setNetType(nt.id) }}
                                  className={`py-1.5 px-2 rounded-lg border transition-all text-left ${
                                    netType === nt.id
                                      ? 'border-cyan-500/40 bg-cyan-500/10'
                                      : 'border-white/[0.07] bg-white/[0.03] hover:border-white/15'
                                  }`}>
                                  <p className={`text-[10px] font-semibold leading-tight ${netType === nt.id ? 'text-cyan-300' : 'text-slate-400'}`}>{nt.label}</p>
                                  <p className="text-[9px] text-slate-600 mt-0.5 leading-tight">{nt.hint}</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {!a.installed && (
                        <div className="mt-3">
                          <button
                            onClick={e => { e.stopPropagation(); setSetupOpen(setupOpen === a.id ? null : a.id) }}
                            className="text-[10px] text-cyan-500 hover:text-cyan-400 flex items-center gap-1 transition-colors">
                            <ChevronDown size={10} className={`transition-transform ${setupOpen === a.id ? 'rotate-180' : ''}`} />
                            Setup instructions
                          </button>
                          {setupOpen === a.id && (
                            <div className="mt-2 relative">
                              <pre className="text-[10px] text-slate-400 bg-black/40 rounded-lg p-3 overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap">
                                {`cd AI\n${a.setup}`}
                              </pre>
                              <button
                                onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(`cd AI\n${a.setup}`) }}
                                className="absolute top-2 right-2 p-1 rounded bg-white/[0.06] hover:bg-white/[0.1] text-slate-500 hover:text-white transition-all">
                                <Copy size={10} />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              {arch === 'drct' && selectedArch?.installed && (
                <p className="text-[10px] text-amber-400/70 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  DRCT will auto-generate LR images by downscaling your HR folder before training starts.
                </p>
              )}
              {arch === 'neosr' && selectedArch?.installed && (
                <p className="text-[10px] text-amber-400/70 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  neosr will auto-generate LR images by downscaling your HR folder before training starts.
                </p>
              )}
            </div>

            {/* Pre-trained starting checkpoint */}
            {weights.length > 0 && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">2 · Starting Checkpoint</p>
                  {selectedWeight && (
                    <button onClick={() => setSelectedWeight(null)}
                      className="text-[10px] text-slate-500 hover:text-white transition-colors">
                      Clear (start random)
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {weights.map(w => {
                    const isSelected = selectedWeight?.path === w.path
                    const isSPAN     = w.arch === 'SPAN'
                    const isDAT      = w.arch === 'DAT'
                    const isRRDB4    = w.arch === 'RRDBNet' && w.scale === 4
                    const isRRDB8    = w.arch === 'RRDBNet' && w.scale === 8

                    const canSelect =
                      (arch === 'esrgan' && w.arch === 'RRDBNet') ||
                      (arch === 'neosr'  && (isSPAN || isDAT))

                    let badge: string, badgeColor: string
                    if (arch === 'esrgan') {
                      if (isRRDB4)      { badge = 'Full transfer · trains 4x'; badgeColor = 'text-emerald-400/80' }
                      else if (isRRDB8) { badge = 'Full transfer · trains 8x'; badgeColor = 'text-cyan-400/80' }
                      else              { badge = `${w.arch} · incompatible — 0 weights transfer`; badgeColor = 'text-slate-600' }
                    } else if (arch === 'neosr') {
                      if (isSPAN)       { badge = 'SPAN · full transfer';  badgeColor = 'text-emerald-400/80' }
                      else if (isDAT)   { badge = 'DAT-2 · full transfer'; badgeColor = 'text-emerald-400/80' }
                      else              { badge = 'RRDBNet · incompatible — different architecture'; badgeColor = 'text-slate-600' }
                    } else {
                      badge = `${w.arch} · n/a for this framework`; badgeColor = 'text-slate-600'
                    }

                    return (
                      <div key={w.path}
                        onClick={() => {
                          if (!canSelect) return
                          const next = isSelected ? null : w
                          setSelectedWeight(next)
                          if (next && arch === 'neosr') {
                            if (next.arch === 'SPAN') setNetType('span')
                            else if (next.arch === 'DAT') setNetType('dat_2')
                          }
                        }}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-all ${
                          !canSelect
                            ? 'border-white/[0.04] bg-white/[0.01] opacity-50 cursor-not-allowed'
                            : isSelected
                            ? 'border-cyan-500/50 bg-cyan-500/10 cursor-pointer'
                            : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15 cursor-pointer'
                        }`}>
                        <div>
                          <p className={`text-[11px] font-medium leading-tight ${canSelect ? 'text-white' : 'text-slate-500'}`}>
                            {w.name.replace(/\.pth$/, '')}
                          </p>
                          <p className={`text-[10px] mt-0.5 font-mono ${badgeColor}`}>{badge}</p>
                        </div>
                        {isSelected && <CheckCircle size={13} className="text-cyan-400 shrink-0 ml-3" />}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Paths */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{weights.length > 0 ? '3' : '2'} · Paths</p>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">HR dataset folder</label>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] focus-within:border-cyan-500/40 transition-colors">
                  <FolderOpen size={13} className="text-slate-600 shrink-0" />
                  <input value={datasetPath} onChange={e => setDatasetPath(e.target.value)}
                    placeholder="C:\Training\datasets\my-upscaler\high_res"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-700 focus:outline-none font-mono" />
                </div>
                <p className="text-[10px] text-slate-700">Folder containing your 4K HR images. No LR folder needed — the framework handles it.</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Output folder</label>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] focus-within:border-cyan-500/40 transition-colors">
                  <FolderOpen size={13} className="text-slate-600 shrink-0" />
                  <input value={outputPath} onChange={e => setOutputPath(e.target.value)}
                    placeholder="C:\Training\models"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-700 focus:outline-none font-mono" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Run name</label>
                <input value={runName} onChange={e => setRunName(e.target.value)}
                  placeholder="my_upscaler"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-700 focus:outline-none focus:border-cyan-500/40 font-mono" />
              </div>

              {latestState && (
                <button
                  onClick={() => setResumeEnabled(v => !v)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                    resumeEnabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-white'
                  }`}>
                  <span className="text-[11px] font-medium">
                    Resume from checkpoint — iter {latestState.iter.toLocaleString()}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                    resumeEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.06] text-slate-500'
                  }`}>
                    {resumeEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              )}
            </div>

            {/* Training params */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{weights.length > 0 ? '4' : '3'} · Training Config</p>

              <div className="grid grid-cols-2 gap-4">

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Scale</label>
                  <div className="flex gap-2">
                    {SCALES.map(s => (
                      <button key={s} onClick={() => setScale(s)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                          scale === s ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-white/[0.07] bg-white/[0.03] text-slate-500 hover:border-white/15'
                        }`}>
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Iterations</label>
                  <div className="relative">
                    <select value={totalIter} onChange={e => setTotalIter(Number(e.target.value))}
                      className="w-full appearance-none border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/40 pr-7"
                      style={{ backgroundColor: '#131320', color: '#cbd5e1' }}>
                      {ITER_OPTS.map(o => (
                        <option key={o.value} value={o.value} style={{ backgroundColor: '#131320' }}>{o.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={10} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Patch size (HR)</label>
                  <div className="relative">
                    <select value={patchSize} onChange={e => setPatchSize(Number(e.target.value))}
                      className="w-full appearance-none border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/40 pr-7"
                      style={{ backgroundColor: '#131320', color: '#cbd5e1' }}>
                      {PATCHES.map(p => (
                        <option key={p} value={p} style={{ backgroundColor: '#131320' }}>{p}px</option>
                      ))}
                    </select>
                    <ChevronDown size={10} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  </div>
                  <p className="text-[9px] text-slate-700">Crop size from HR. LR = patch/{scale} = {patchSize/scale}px</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Batch size</label>
                  <div className="flex gap-2">
                    {BATCHES.map(b => (
                      <button key={b} onClick={() => setBatchSize(b)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                          batchSize === b ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-white/[0.07] bg-white/[0.03] text-slate-500 hover:border-white/15'
                        }`}>
                        {b}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] text-slate-700">4070 Ti Super: use 4–8. Lower if OOM.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Learning rate</label>
                  <input value={lr} onChange={e => setLr(e.target.value)}
                    placeholder="1e-4"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-cyan-500/40 font-mono" />
                  <p className="text-[9px] text-slate-700">ESRGAN: 1e-4 · DRCT: 2e-4 · neosr: 1e-4</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Save every</label>
                  <div className="relative">
                    <select value={saveFreq} onChange={e => setSaveFreq(Number(e.target.value))}
                      className="w-full appearance-none border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/40 pr-7"
                      style={{ backgroundColor: '#131320', color: '#cbd5e1' }}>
                      {SAVE_OPTS.map(s => (
                        <option key={s} value={s} style={{ backgroundColor: '#131320' }}>{s.toLocaleString()} iters</option>
                      ))}
                    </select>
                    <ChevronDown size={10} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  </div>
                </div>

              </div>
            </div>

            {!serverRunning && (
              <p className="text-[11px] text-amber-400/70 text-center">Start the server first before training.</p>
            )}
            <button onClick={startTraining} disabled={!canTrain}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-sm font-semibold hover:bg-cyan-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              <Play size={14} />
              Start Training
            </button>
          </>
        )}

        {/* ── Monitor tab ── */}
        {tab === 'monitor' && (
          <div className="space-y-4">

            <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f1a] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white">
                      {status?.arch ? archs.find(a => a.id === status.arch)?.label ?? status.arch : 'No run yet'}
                    </p>
                    {status && (
                      <span className={`text-[11px] font-medium ${STATUS_COLOR[status.status] ?? 'text-slate-500'}`}>
                        {status.status}
                      </span>
                    )}
                  </div>
                  {status && status.total_iter > 0 && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {status.iter.toLocaleString()} / {status.total_iter.toLocaleString()} iterations ({pct}%)
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={pollStatus}
                    className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-600 hover:text-slate-300 transition-colors">
                    <RefreshCw size={13} />
                  </button>
                  {isTraining && (
                    <button onClick={stopTraining}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/25 text-red-400 text-xs hover:bg-red-500/20 transition-all">
                      <Square size={12} /> Stop
                    </button>
                  )}
                </div>
              </div>

              {status && status.total_iter > 0 && (
                <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      status.status === 'done'      ? 'bg-emerald-500'
                      : status.status === 'error'   ? 'bg-red-500'
                      : status.status === 'cancelled' ? 'bg-amber-500'
                      : 'bg-cyan-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}

              {status?.status === 'done' && (
                <p className="text-[11px] text-emerald-400">Training complete. Check your output folder for .pth model files.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#0a0a12] p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Log</p>
                <div className="flex items-center gap-2">
                  {status && status.logs.length > 0 && (
                    <button
                      onClick={() => navigator.clipboard.writeText(status.logs.join('\n'))}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.07] text-slate-500 hover:text-white hover:border-white/20 text-[10px] transition-all">
                      <Copy size={9} /> Copy all
                    </button>
                  )}
                </div>
              </div>
              <div className="relative">
                <div
                  ref={logContainerRef}
                  className="max-h-[500px] overflow-y-auto space-y-px font-mono text-[10px]"
                  onScroll={e => {
                    const el = e.currentTarget
                    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
                    userScrolledUpRef.current = !atBottom
                    setShowJumpBtn(!atBottom)
                  }}>
                  {!status || status.logs.length === 0
                    ? <p className="text-slate-700">No output yet.</p>
                    : status.logs.map((line, i) => (
                      <p key={i} className={
                        line.startsWith('─') ? 'text-slate-700'
                        : line.toLowerCase().includes('error') || line.toLowerCase().includes('exception') ? 'text-red-400'
                        : line.toLowerCase().includes('warning') ? 'text-amber-500'
                        : line.toLowerCase().includes('iter:') ? 'text-cyan-400/80'
                        : line.startsWith('Generating') || line.startsWith('Generated') ? 'text-violet-400'
                        : 'text-slate-400'
                      }>{line}</p>
                    ))}
                  <div ref={logEndRef} />
                </div>
                {/* Jump-to-bottom button — shown when user has scrolled up */}
                {showJumpBtn && (
                  <button
                    onClick={() => {
                      userScrolledUpRef.current = false
                      setShowJumpBtn(false)
                      logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                    }}
                    className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/90 border border-white/[0.1] text-slate-400 hover:text-white text-[10px] transition-all backdrop-blur">
                    <ChevronDown size={10} /> Bottom
                  </button>
                )}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  )
}
