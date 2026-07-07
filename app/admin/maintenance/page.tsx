"use client"

import { useState, useEffect, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Wrench, RefreshCw, ChevronLeft, ChevronDown, ChevronRight,
  Zap, Globe, Ticket, Monitor, Layers, Film, Box, Sparkles, Terminal, Loader2
} from "lucide-react"

const MODELS = [
  { id: 'nanoBanana',      name: 'NanoBanana',       emoji: '⚡' },
  { id: 'nanoBananaPro',   name: 'NB Pro',            emoji: '✨' },
  { id: 'seedream',        name: 'SeeDream',          emoji: '🌟' },
  { id: 'flux2',           name: 'FLUX 2',            emoji: '🔥' },
  { id: 'proScannerV3',    name: 'Pro Scanner v3',    emoji: '💎' },
  { id: 'flashScannerV25', name: 'Flash v2.5',        emoji: '⚡' },
]

const SCANNERS = [
  { id: 'mainScanner',   name: 'Main Scanner',         path: 'multiverse-portal' },
  { id: 'legacyScanner', name: 'Legacy Scanner',        path: 'prompting-studio/legacy' },
  { id: 'adminScanner',  name: 'Admin Scanner',         path: 'admin/scanner' },
  { id: 'canvasScanner', name: 'Canvas Scanner',        path: 'prompting-studio/canvas' },
]

interface AdminState {
  isMaintenanceMode: boolean
  aiGenerationMaintenance: boolean
  echoChamberMaintenance: boolean
  ticketDispenserMaintenance: boolean
  mainScannerMaintenance: boolean
  legacyScannerMaintenance: boolean
  adminScannerMaintenance: boolean
  canvasScannerMaintenance: boolean
  videoScannerMaintenance: boolean
  compositionCanvasMaintenance: boolean
  klingV3Maintenance: boolean
  wan25Maintenance: boolean
  [key: string]: boolean
}

const DEFAULT_STATE: AdminState = {
  isMaintenanceMode: false,
  aiGenerationMaintenance: false,
  echoChamberMaintenance: false,
  ticketDispenserMaintenance: false,
  mainScannerMaintenance: false,
  legacyScannerMaintenance: false,
  adminScannerMaintenance: false,
  canvasScannerMaintenance: false,
  videoScannerMaintenance: false,
  compositionCanvasMaintenance: false,
  klingV3Maintenance: false,
  wan25Maintenance: false,
}

// ── Reusable compact toggle row ──────────────────────────────────────────────
function ToggleRow({
  label, sub, active, color = 'red', onToggle, danger = false,
}: {
  label: string; sub?: string; active: boolean; color?: 'red' | 'yellow' | 'orange' | 'cyan' | 'emerald'
  onToggle: () => void; danger?: boolean
}) {
  const trackColor = {
    red:     active ? 'bg-red-500'     : 'bg-white/[0.08]',
    yellow:  active ? 'bg-yellow-500'  : 'bg-white/[0.08]',
    orange:  active ? 'bg-orange-500'  : 'bg-white/[0.08]',
    cyan:    active ? 'bg-cyan-500'    : 'bg-white/[0.08]',
    emerald: active ? 'bg-emerald-500' : 'bg-white/[0.08]',
  }[color]

  const statusColor = {
    red:     active ? 'text-red-400'     : 'text-emerald-400',
    yellow:  active ? 'text-yellow-400'  : 'text-emerald-400',
    orange:  active ? 'text-orange-400'  : 'text-emerald-400',
    cyan:    active ? 'text-cyan-400'    : 'text-emerald-400',
    emerald: active ? 'text-emerald-400' : 'text-slate-500',
  }[color]

  const dotColor = {
    red:     active ? 'bg-red-500'     : 'bg-emerald-500',
    yellow:  active ? 'bg-yellow-500'  : 'bg-emerald-500',
    orange:  active ? 'bg-orange-500'  : 'bg-emerald-500',
    cyan:    active ? 'bg-cyan-500'    : 'bg-emerald-500',
    emerald: active ? 'bg-emerald-500' : 'bg-slate-600',
  }[color]

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} ${active && danger ? 'animate-pulse' : ''}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white leading-none">{label}</p>
          {sub && <p className="text-[11px] text-slate-600 mt-0.5 leading-none">{sub}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2.5 shrink-0 ml-3">
        <span className={`text-[10px] font-bold uppercase tracking-wide ${statusColor}`}>
          {active ? 'offline' : 'online'}
        </span>
        <button
          onClick={onToggle}
          className={`relative w-9 h-5 rounded-full transition-colors ${trackColor}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </div>
  )
}

// ── Model chip ────────────────────────────────────────────────────────────────
function ModelChip({ emoji, name, offline, onClick }: { emoji: string; name: string; offline: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all ${
        offline
          ? 'border-red-500/30 bg-red-500/[0.06] hover:bg-red-500/10'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
      }`}
    >
      <span className="text-xs font-medium text-white flex items-center gap-1.5">
        <span className="text-sm leading-none">{emoji}</span>{name}
      </span>
      <span className={`text-[9px] font-bold uppercase ml-2 ${offline ? 'text-red-400' : 'text-emerald-400'}`}>
        {offline ? 'off' : 'on'}
      </span>
    </button>
  )
}

// ── Section card wrapper ───────────────────────────────────────────────────────
function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.07] bg-white/[0.015] overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

function SectionHeader({ icon: Icon, label, color = 'text-slate-500' }: { icon: any; label: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-2">
      <Icon size={11} className={color} />
      <p className={`text-[10px] font-bold uppercase tracking-widest ${color}`}>{label}</p>
    </div>
  )
}

function Divider() {
  return <div className="mx-4 border-t border-white/[0.04]" />
}

// ─────────────────────────────────────────────────────────────────────────────

export default function MaintenancePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [adminState, setAdminState] = useState<AdminState>(DEFAULT_STATE)
  const [expandedScanners, setExpandedScanners] = useState<Set<string>>(new Set())

  const fetchCloudData = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/config')
      if (res.ok) setAdminState(await res.json())
    } catch {}
    finally { setIsLoading(false) }
  }, [])

  useEffect(() => {
    const authed = localStorage.getItem("multiverse-admin-auth") === "true"
    const pass = sessionStorage.getItem("admin-password")
    if (authed && pass) { setIsAuthenticated(true); fetchCloudData() }
    else { localStorage.removeItem("multiverse-admin-auth"); setIsLoading(false) }
  }, [fetchCloudData])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        sessionStorage.setItem("admin-password", password)
        localStorage.setItem("multiverse-admin-auth", "true")
        setIsAuthenticated(true)
        fetchCloudData()
      } else {
        alert("Invalid password")
      }
    } catch { alert("Authentication failed") }
  }

  const updateAdminState = async (updates: Partial<AdminState>) => {
    const newState = { ...adminState, ...updates } as AdminState
    setAdminState(newState)
    setSaving(true)
    try {
      await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('admin-password') : '') || '',
        },
        body: JSON.stringify(newState),
      })
    } catch {}
    finally { setSaving(false) }
  }

  const toggle = (key: keyof AdminState) => updateAdminState({ [key]: !adminState[key] })

  const toggleScannerModel = (scanner: string, model: string) => {
    const key = `${scanner}_${model}`
    updateAdminState({ [key]: !adminState[key] })
  }

  const toggleModelGlobally = (model: string) => {
    const currentValue = adminState[`mainScanner_${model}`]
    updateAdminState({
      [`mainScanner_${model}`]:   !currentValue,
      [`legacyScanner_${model}`]: !currentValue,
      [`adminScanner_${model}`]:  !currentValue,
      [`canvasScanner_${model}`]: !currentValue,
    })
  }

  const toggleAllModelsForScanner = (scannerId: string) => {
    const allOff = MODELS.every(m => adminState[`${scannerId}_${m.id}`])
    const updates: Record<string, boolean> = {}
    MODELS.forEach(m => { updates[`${scannerId}_${m.id}`] = !allOff })
    updateAdminState(updates)
  }

  const isModelGloballyOff = (modelId: string) =>
    !!adminState[`mainScanner_${modelId}`] &&
    !!adminState[`legacyScanner_${modelId}`] &&
    !!adminState[`adminScanner_${modelId}`] &&
    !!adminState[`canvasScanner_${modelId}`]

  const toggleExpanded = (id: string) =>
    setExpandedScanners(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // ── Login screen ─────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#09090f] flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 justify-center mb-6">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <Wrench size={14} className="text-orange-400" />
            </div>
            <span className="text-sm font-bold text-white">Maintenance Control</span>
          </div>
          <Section>
            <form onSubmit={handleLogin} className="p-4 space-y-3">
              <Input
                type="password"
                placeholder="Admin password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-600 h-9 text-sm"
              />
              <Button type="submit" className="w-full h-9 bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500/20 text-sm font-bold">
                Authenticate
              </Button>
            </form>
          </Section>
        </div>
      </div>
    )
  }

  // ── Main page ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#09090f] relative">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-orange-500/[0.025] rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-2xl mx-auto px-5 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.location.href = '/admin'}
              className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.07] flex items-center justify-center hover:bg-white/[0.07] transition-colors text-slate-400 hover:text-white"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="w-9 h-9 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <Wrench size={16} className="text-orange-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">Maintenance</h1>
              <p className="text-[11px] text-slate-600 mt-0.5">Feature & model toggles</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saving && <Loader2 size={13} className="text-slate-600 animate-spin" />}
            <button
              onClick={fetchCloudData}
              disabled={isLoading}
              className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.07] flex items-center justify-center hover:bg-white/[0.07] transition-colors text-slate-400 hover:text-white disabled:opacity-40"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="space-y-4">

          {/* ── Global Controls ── */}
          <Section>
            <SectionHeader icon={Globe} label="Global Controls" color="text-slate-500" />
            <ToggleRow
              label="Kill All Generation"
              sub="Blocks all FAL.ai and Gemini calls site-wide"
              active={adminState.aiGenerationMaintenance}
              color="red"
              danger
              onToggle={() => toggle('aiGenerationMaintenance')}
            />
            <Divider />
            <ToggleRow
              label="Global Maintenance Mode"
              sub="Locks the site — users cannot access any page"
              active={adminState.isMaintenanceMode}
              color="yellow"
              danger
              onToggle={() => toggle('isMaintenanceMode')}
            />
            <Divider />
            <ToggleRow
              label="Ticket Dispenser"
              sub="buy-tickets page — replaces button with Coming Soon"
              active={adminState.ticketDispenserMaintenance}
              color="orange"
              onToggle={() => toggle('ticketDispenserMaintenance')}
            />
            <div className="h-1" />
          </Section>

          {/* ── Scanners ── */}
          <Section>
            <SectionHeader icon={Monitor} label="Scanners" color="text-slate-500" />
            <ToggleRow
              label="Main Scanner"
              sub="multiverse-portal"
              active={adminState.mainScannerMaintenance}
              color="red"
              onToggle={() => toggle('mainScannerMaintenance')}
            />
            <Divider />
            <ToggleRow
              label="Legacy Scanner"
              sub="prompting-studio/legacy"
              active={adminState.legacyScannerMaintenance}
              color="red"
              onToggle={() => toggle('legacyScannerMaintenance')}
            />
            <Divider />
            <ToggleRow
              label="Admin Scanner"
              sub="admin/scanner"
              active={adminState.adminScannerMaintenance}
              color="red"
              onToggle={() => toggle('adminScannerMaintenance')}
            />
            <Divider />
            <ToggleRow
              label="Canvas Scanner"
              sub="prompting-studio/canvas"
              active={adminState.canvasScannerMaintenance}
              color="red"
              onToggle={() => toggle('canvasScannerMaintenance')}
            />
            <Divider />
            <ToggleRow
              label="Video Scanner"
              sub="video-scanner"
              active={adminState.videoScannerMaintenance}
              color="red"
              onToggle={() => toggle('videoScannerMaintenance')}
            />
            <Divider />
            <ToggleRow
              label="Composition Canvas"
              sub="composition-canvas"
              active={adminState.compositionCanvasMaintenance}
              color="red"
              onToggle={() => toggle('compositionCanvasMaintenance')}
            />
            <div className="h-1" />
          </Section>

          {/* ── Video Scanner Models ── */}
          <Section>
            <SectionHeader icon={Film} label="Video Scanner Models" color="text-slate-500" />
            <div className="px-4 pb-4 pt-1 grid grid-cols-2 gap-2">
              {[
                { id: 'klingV3Maintenance', name: 'Kling 3.0', emoji: '🎬' },
                { id: 'wan25Maintenance',   name: 'WAN 2.5',   emoji: '🌊' },
              ].map(m => (
                <ModelChip
                  key={m.id}
                  emoji={m.emoji}
                  name={m.name}
                  offline={adminState[m.id]}
                  onClick={() => toggle(m.id as keyof AdminState)}
                />
              ))}
            </div>
          </Section>

          {/* ── Global Model Toggles ── */}
          <Section>
            <SectionHeader icon={Sparkles} label="Image Models — All Scanners" color="text-slate-500" />
            <p className="px-4 pb-2 text-[11px] text-slate-600">Toggles apply to Main, Legacy, Admin, and Canvas scanners simultaneously.</p>
            <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {MODELS.map(m => (
                <ModelChip
                  key={m.id}
                  emoji={m.emoji}
                  name={m.name}
                  offline={!!isModelGloballyOff(m.id)}
                  onClick={() => toggleModelGlobally(m.id)}
                />
              ))}
            </div>
          </Section>

          {/* ── Per-Scanner Model Controls ── */}
          <Section>
            <SectionHeader icon={Layers} label="Per-Scanner Model Controls" color="text-slate-500" />
            <div className="pb-2">
              {SCANNERS.map((scanner, i) => {
                const expanded = expandedScanners.has(scanner.id)
                const anyOff = MODELS.some(m => adminState[`${scanner.id}_${m.id}`])
                const allOff = MODELS.every(m => adminState[`${scanner.id}_${m.id}`])
                const offCount = MODELS.filter(m => adminState[`${scanner.id}_${m.id}`]).length

                return (
                  <div key={scanner.id}>
                    {i > 0 && <Divider />}
                    {/* Scanner row */}
                    <button
                      onClick={() => toggleExpanded(scanner.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-1.5 h-1.5 rounded-full ${anyOff ? 'bg-orange-500' : 'bg-emerald-500'}`} />
                        <div>
                          <p className="text-sm font-medium text-white leading-none">{scanner.name}</p>
                          <p className="text-[11px] text-slate-600 mt-0.5 leading-none">{scanner.path}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {offCount > 0 && (
                          <span className="text-[10px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded">
                            {offCount} off
                          </span>
                        )}
                        {expanded ? <ChevronDown size={13} className="text-slate-600" /> : <ChevronRight size={13} className="text-slate-600" />}
                      </div>
                    </button>

                    {/* Expanded model chips */}
                    {expanded && (
                      <div className="px-4 pb-3 space-y-2">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {MODELS.map(m => (
                            <ModelChip
                              key={m.id}
                              emoji={m.emoji}
                              name={m.name}
                              offline={adminState[`${scanner.id}_${m.id}`]}
                              onClick={() => toggleScannerModel(scanner.id, m.id)}
                            />
                          ))}
                        </div>
                        <button
                          onClick={() => toggleAllModelsForScanner(scanner.id)}
                          className={`w-full text-[11px] font-bold py-1.5 rounded-lg border transition-colors ${
                            allOff
                              ? 'border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/5'
                              : 'border-red-500/20 text-red-400 hover:bg-red-500/5'
                          }`}
                        >
                          {allOff ? '↑ Turn all ON' : '↓ Turn all OFF'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>

        </div>
      </div>
    </div>
  )
}
