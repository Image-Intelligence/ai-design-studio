"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  RefreshCw, MessageSquare, Activity, Clock, ArrowLeft, Bug, Lightbulb,
  CheckCircle, Trash2, ChevronDown, ChevronUp, X, Search, SlidersHorizontal
} from "lucide-react"

interface Feedback {
  id: number
  userId: number | null
  userEmail: string
  type: string
  subject: string
  message: string
  status: string
  adminNotes: string | null
  createdAt: string
  user?: {
    id: number
    email: string
    name: string | null
  }
}

interface EchoMessage {
  id: number
  message: string
  visibleName: boolean
  name?: string
  imageUrls?: string[]
  createdAt: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    bug: 'bg-red-500/15 text-red-400 border-red-500/30',
    request: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    feedback: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
  }
  const icons: Record<string, React.ReactNode> = {
    bug: <Bug size={11} />,
    request: <Lightbulb size={11} />,
    feedback: <MessageSquare size={11} />,
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${styles[type] ?? styles.feedback}`}>
      {icons[type] ?? icons.feedback}
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-slate-500/20 text-slate-400',
    reviewed: 'bg-amber-500/20 text-amber-400',
    resolved: 'bg-green-500/20 text-green-400',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] ?? styles.pending}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

export default function AdminFeedbackPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const [feedbacks, setFeedbacks] = useState<Feedback[]>([])
  const [echoMessages, setEchoMessages] = useState<EchoMessage[]>([])
  const [activeTab, setActiveTab] = useState<'feedback' | 'echo'>('feedback')

  // Filters
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")

  // Expanded items
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  // Selection
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState<Set<number>>(new Set())
  const [selectedEchoIds, setSelectedEchoIds] = useState<Set<number>>(new Set())

  // Bulk note
  const [bulkNote, setBulkNote] = useState("")
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  const fetchData = useCallback(async (pwd: string) => {
    setIsLoading(true)
    try {
      const [feedbackRes, echoRes] = await Promise.all([
        fetch('/api/feedback', { headers: { 'x-admin-password': pwd } }),
        fetch('/api/echo'),
      ])
      if (feedbackRes.ok) {
        const data = await feedbackRes.json()
        setFeedbacks(Array.isArray(data) ? data : [])
      }
      if (echoRes.ok) {
        const data = await echoRes.json()
        setEchoMessages(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const authStatus = localStorage.getItem("multiverse-admin-auth")
    const savedPassword = sessionStorage.getItem("admin-password")

    if (authStatus === "true" && savedPassword) {
      setAdminPassword(savedPassword)
      setIsAuthenticated(true)
      fetchData(savedPassword)
      const interval = setInterval(() => fetchData(savedPassword), 30000)
      return () => clearInterval(interval)
    } else {
      localStorage.removeItem("multiverse-admin-auth")
    }
  }, [fetchData])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      if (response.ok) {
        setAdminPassword(password)
        sessionStorage.setItem("admin-password", password)
        setIsAuthenticated(true)
        localStorage.setItem("multiverse-admin-auth", "true")
        fetchData(password)
      } else {
        alert("Invalid password")
      }
    } catch {
      alert("Authentication failed")
    }
  }

  // Filtered feedback
  const filteredFeedbacks = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return feedbacks.filter(f => {
      if (statusFilter !== 'all' && f.status !== statusFilter) return false
      if (typeFilter !== 'all' && f.type !== typeFilter) return false
      if (q && !(
        f.userEmail.toLowerCase().includes(q) ||
        f.subject.toLowerCase().includes(q) ||
        f.message.toLowerCase().includes(q)
      )) return false
      return true
    })
  }, [feedbacks, searchQuery, statusFilter, typeFilter])

  // Filtered echo
  const filteredEchos = useMemo(() => {
    const q = searchQuery.toLowerCase()
    if (!q) return echoMessages
    return echoMessages.filter(m =>
      m.message.toLowerCase().includes(q) ||
      (m.name || '').toLowerCase().includes(q)
    )
  }, [echoMessages, searchQuery])

  // Stats
  const stats = useMemo(() => ({
    total: feedbacks.length,
    pending: feedbacks.filter(f => f.status === 'pending').length,
    reviewed: feedbacks.filter(f => f.status === 'reviewed').length,
    resolved: feedbacks.filter(f => f.status === 'resolved').length,
  }), [feedbacks])

  // Toggle expand
  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Feedback selection
  const toggleFeedbackSelect = (id: number) => {
    setSelectedFeedbackIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allFeedbackSelected = filteredFeedbacks.length > 0 && filteredFeedbacks.every(f => selectedFeedbackIds.has(f.id))

  const toggleSelectAllFeedback = () => {
    if (allFeedbackSelected) {
      setSelectedFeedbackIds(new Set())
    } else {
      setSelectedFeedbackIds(new Set(filteredFeedbacks.map(f => f.id)))
    }
  }

  // Echo selection
  const toggleEchoSelect = (id: number) => {
    setSelectedEchoIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allEchoSelected = filteredEchos.length > 0 && filteredEchos.every(m => selectedEchoIds.has(m.id))

  const toggleSelectAllEcho = () => {
    if (allEchoSelected) {
      setSelectedEchoIds(new Set())
    } else {
      setSelectedEchoIds(new Set(filteredEchos.map(m => m.id)))
    }
  }

  // Individual feedback actions
  const updateFeedbackStatus = async (id: number, status: string, notes?: string) => {
    try {
      await fetch('/api/feedback', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
        body: JSON.stringify({ id, status, adminNotes: notes ?? null }),
      })
      fetchData(adminPassword)
    } catch {
      alert('Failed to update feedback')
    }
  }

  const deleteFeedback = async (id: number) => {
    if (!confirm('Delete this submission?')) return
    try {
      await fetch(`/api/feedback?id=${id}`, { method: 'DELETE', headers: { 'x-admin-password': adminPassword } })
      fetchData(adminPassword)
      setSelectedFeedbackIds(prev => { const n = new Set(prev); n.delete(id); return n })
    } catch {
      alert('Failed to delete feedback')
    }
  }

  const deleteEchoMessage = async (id: number) => {
    if (!confirm('Delete this message?')) return
    try {
      await fetch('/api/echo', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: id }),
      })
      fetchData(adminPassword)
      setSelectedEchoIds(prev => { const n = new Set(prev); n.delete(id); return n })
    } catch {
      alert('Failed to delete message')
    }
  }

  // Bulk feedback actions
  const bulkUpdateFeedback = async (status: string) => {
    const ids = Array.from(selectedFeedbackIds)
    if (ids.length === 0) return
    setBulkActionLoading(true)
    try {
      await fetch('/api/feedback', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
        body: JSON.stringify({
          ids,
          status,
          adminNotes: bulkNote || undefined,
        }),
      })
      setSelectedFeedbackIds(new Set())
      setBulkNote("")
      fetchData(adminPassword)
    } catch {
      alert('Bulk update failed')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const bulkDeleteFeedback = async () => {
    const ids = Array.from(selectedFeedbackIds)
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} submission${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkActionLoading(true)
    try {
      await fetch('/api/feedback', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
        body: JSON.stringify({ ids }),
      })
      setSelectedFeedbackIds(new Set())
      fetchData(adminPassword)
    } catch {
      alert('Bulk delete failed')
    } finally {
      setBulkActionLoading(false)
    }
  }

  // Bulk echo actions
  const bulkDeleteEcho = async () => {
    const ids = Array.from(selectedEchoIds)
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} message${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkActionLoading(true)
    try {
      await fetch('/api/echo', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: ids }),
      })
      setSelectedEchoIds(new Set())
      fetchData(adminPassword)
    } catch {
      alert('Bulk delete failed')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const activeFeedbackSelection = selectedFeedbackIds.size > 0
  const activeEchoSelection = selectedEchoIds.size > 0

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center p-6">
        <div className="w-full max-w-sm p-8 rounded-2xl border border-slate-700/60 bg-slate-900/90 backdrop-blur-sm shadow-2xl shadow-black/50">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-fuchsia-600/30 to-cyan-600/30 border border-fuchsia-500/20 flex items-center justify-center mx-auto mb-4">
              <MessageSquare size={26} className="text-fuchsia-400" />
            </div>
            <h1 className="text-xl font-bold text-white">Feedback Manager</h1>
            <p className="text-sm text-slate-500 mt-1">Admin access required</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-slate-950 border-slate-700 text-white placeholder-slate-500 focus:border-fuchsia-500"
            />
            <Button type="submit" className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold">
              Authenticate
            </Button>
          </form>
        </div>
      </div>
    )
  }

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#050810] relative overflow-hidden pb-32">
      {/* Background glows */}
      <div className="fixed top-0 left-1/4 w-[500px] h-[500px] bg-fuchsia-900/10 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[500px] h-[500px] bg-cyan-900/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 p-6 max-w-6xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-600/25 to-cyan-600/25 border border-fuchsia-500/20 flex items-center justify-center">
                <MessageSquare size={18} className="text-fuchsia-400" />
              </div>
              <h1 className="text-2xl font-bold text-white">Feedback Manager</h1>
            </div>
            <p className="text-sm text-slate-500 ml-12">User submissions, requests &amp; echo stream</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => (window.location.href = '/admin')}
              variant="outline"
              className="border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-sm"
            >
              <ArrowLeft size={15} className="mr-1.5" /> Admin
            </Button>
            <Button
              onClick={() => fetchData(adminPassword)}
              disabled={isLoading}
              variant="outline"
              className="border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300"
            >
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total', value: stats.total, color: 'text-slate-300' },
            { label: 'Pending', value: stats.pending, color: 'text-slate-400' },
            { label: 'Reviewed', value: stats.reviewed, color: 'text-amber-400' },
            { label: 'Resolved', value: stats.resolved, color: 'text-green-400' },
          ].map(s => (
            <div key={s.label} className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 mb-5 p-1 rounded-xl bg-slate-900/60 border border-slate-800 w-fit">
          <button
            onClick={() => { setActiveTab('feedback'); setSelectedEchoIds(new Set()) }}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'feedback'
                ? 'bg-fuchsia-600/80 text-white shadow-lg shadow-fuchsia-900/30'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <MessageSquare size={14} className="inline mr-1.5 -mt-0.5" />
            Feedback &amp; Requests
            <span className="ml-1.5 text-xs opacity-60">({feedbacks.length})</span>
          </button>
          <button
            onClick={() => { setActiveTab('echo'); setSelectedFeedbackIds(new Set()) }}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'echo'
                ? 'bg-cyan-600/80 text-white shadow-lg shadow-cyan-900/30'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <Activity size={14} className="inline mr-1.5 -mt-0.5" />
            Echo Stream
            <span className="ml-1.5 text-xs opacity-60">({echoMessages.length})</span>
          </button>
        </div>

        {/* ── Search & Filter bar ── */}
        <div className="flex flex-wrap gap-2 mb-5">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={activeTab === 'feedback' ? "Search by email, subject, message…" : "Search messages…"}
              className="pl-9 bg-slate-900/70 border-slate-700 text-white placeholder-slate-500 text-sm focus:border-fuchsia-500/60"
            />
          </div>

          {activeTab === 'feedback' && (
            <>
              <div className="relative">
                <SlidersHorizontal size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="pl-8 pr-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-300 text-sm focus:outline-none focus:border-fuchsia-500/60 appearance-none cursor-pointer"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
              <div className="relative">
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-300 text-sm focus:outline-none focus:border-fuchsia-500/60 appearance-none cursor-pointer"
                >
                  <option value="all">All Types</option>
                  <option value="feedback">Feedback</option>
                  <option value="request">Request</option>
                  <option value="bug">Bug</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* ── FEEDBACK TAB ── */}
        {activeTab === 'feedback' && (
          <div>
            {/* Select all header */}
            {filteredFeedbacks.length > 0 && (
              <div className="flex items-center gap-3 mb-3 px-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allFeedbackSelected}
                    onChange={toggleSelectAllFeedback}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 accent-fuchsia-500 cursor-pointer"
                  />
                  <span className="text-xs text-slate-500">
                    {allFeedbackSelected ? 'Deselect all' : `Select all (${filteredFeedbacks.length})`}
                  </span>
                </label>
                {selectedFeedbackIds.size > 0 && (
                  <span className="text-xs text-fuchsia-400 font-medium">{selectedFeedbackIds.size} selected</span>
                )}
              </div>
            )}

            {filteredFeedbacks.length === 0 ? (
              <div className="p-14 rounded-2xl border border-slate-800 bg-slate-900/40 text-center">
                <MessageSquare size={40} className="mx-auto text-slate-700 mb-3" />
                <p className="text-slate-500 text-sm">
                  {feedbacks.length === 0 ? 'No feedback submissions yet' : 'No results match your filters'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredFeedbacks.map(feedback => {
                  const isExpanded = expandedIds.has(feedback.id)
                  const isSelected = selectedFeedbackIds.has(feedback.id)
                  return (
                    <div
                      key={feedback.id}
                      className={`rounded-xl border transition-all ${
                        isSelected
                          ? 'border-fuchsia-500/40 bg-fuchsia-950/20'
                          : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                      }`}
                    >
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Checkbox */}
                          <div className="pt-0.5 shrink-0">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleFeedbackSelect(feedback.id)}
                              className="w-4 h-4 rounded border-slate-600 bg-slate-800 accent-fuchsia-500 cursor-pointer"
                            />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <TypeBadge type={feedback.type} />
                              <StatusBadge status={feedback.status} />
                              <span className="text-xs text-slate-500 flex items-center gap-1 ml-auto">
                                <Clock size={11} />
                                {formatDate(feedback.createdAt)}
                              </span>
                            </div>

                            <h3 className="text-sm font-semibold text-white mb-1 leading-snug">{feedback.subject}</h3>

                            <p className={`text-sm text-slate-400 leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
                              {feedback.message}
                            </p>

                            {feedback.message.length > 120 && (
                              <button
                                onClick={() => toggleExpand(feedback.id)}
                                className="text-xs text-fuchsia-400/70 hover:text-fuchsia-400 mt-1 flex items-center gap-0.5 transition-colors"
                              >
                                {isExpanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show more</>}
                              </button>
                            )}

                            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                              <span>
                                From: <span className="text-cyan-400">{feedback.userEmail}</span>
                              </span>
                            </div>

                            {feedback.adminNotes && (
                              <div className="mt-3 px-3 py-2 rounded-lg bg-green-900/20 border border-green-500/20">
                                <p className="text-xs font-semibold text-green-400 mb-0.5">Admin note</p>
                                <p className="text-xs text-green-300/80">{feedback.adminNotes}</p>
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex flex-col gap-1.5 shrink-0">
                            {feedback.status !== 'resolved' && (
                              <button
                                title="Mark resolved"
                                onClick={() => updateFeedbackStatus(feedback.id, 'resolved')}
                                className="w-7 h-7 rounded-lg bg-green-600/20 hover:bg-green-600/40 border border-green-500/20 flex items-center justify-center transition-colors"
                              >
                                <CheckCircle size={13} className="text-green-400" />
                              </button>
                            )}
                            <button
                              title="Delete"
                              onClick={() => deleteFeedback(feedback.id)}
                              className="w-7 h-7 rounded-lg bg-red-600/15 hover:bg-red-600/30 border border-red-500/20 flex items-center justify-center transition-colors"
                            >
                              <Trash2 size={13} className="text-red-400" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ECHO TAB ── */}
        {activeTab === 'echo' && (
          <div>
            {filteredEchos.length > 0 && (
              <div className="flex items-center gap-3 mb-3 px-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allEchoSelected}
                    onChange={toggleSelectAllEcho}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 accent-cyan-500 cursor-pointer"
                  />
                  <span className="text-xs text-slate-500">
                    {allEchoSelected ? 'Deselect all' : `Select all (${filteredEchos.length})`}
                  </span>
                </label>
                {selectedEchoIds.size > 0 && (
                  <span className="text-xs text-cyan-400 font-medium">{selectedEchoIds.size} selected</span>
                )}
              </div>
            )}

            {filteredEchos.length === 0 ? (
              <div className="p-14 rounded-2xl border border-slate-800 bg-slate-900/40 text-center">
                <Activity size={40} className="mx-auto text-slate-700 mb-3" />
                <p className="text-slate-500 text-sm">
                  {echoMessages.length === 0 ? 'No echo messages yet' : 'No results match your search'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredEchos.map(msg => {
                  const isSelected = selectedEchoIds.has(msg.id)
                  return (
                    <div
                      key={msg.id}
                      className={`rounded-xl border transition-all ${
                        isSelected
                          ? 'border-cyan-500/40 bg-cyan-950/20'
                          : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                      }`}
                    >
                      <div className="p-4 flex items-start gap-3">
                        {/* Checkbox */}
                        <div className="pt-0.5 shrink-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleEchoSelect(msg.id)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 accent-cyan-500 cursor-pointer"
                          />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold text-cyan-400">
                              {msg.visibleName && msg.name ? msg.name : 'Anonymous'}
                            </span>
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Clock size={11} />
                              {formatDate(msg.createdAt)}
                            </span>
                          </div>

                          <p className="text-sm text-slate-300 leading-relaxed">{msg.message}</p>

                          {msg.imageUrls && Array.isArray(msg.imageUrls) && msg.imageUrls.length > 0 && (
                            <div className="flex gap-2 flex-wrap mt-3">
                              {msg.imageUrls.map((url: string, idx: number) => (
                                <img
                                  key={idx}
                                  src={url}
                                  alt={`Image ${idx + 1}`}
                                  onClick={() => window.open(url, '_blank')}
                                  className="h-20 w-20 object-cover rounded-lg border border-cyan-500/25 hover:border-cyan-500/60 hover:scale-105 transition-all cursor-pointer"
                                />
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Delete */}
                        <button
                          title="Delete"
                          onClick={() => deleteEchoMessage(msg.id)}
                          className="w-7 h-7 rounded-lg bg-red-600/15 hover:bg-red-600/30 border border-red-500/20 flex items-center justify-center transition-colors shrink-0"
                        >
                          <Trash2 size={13} className="text-red-400" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── BULK ACTION BAR ── */}
      {(activeFeedbackSelection && activeTab === 'feedback') && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl border border-fuchsia-500/30 bg-slate-950/95 backdrop-blur-md shadow-2xl shadow-black/60">
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-6 h-6 rounded-full bg-fuchsia-600 flex items-center justify-center text-xs font-bold text-white">
                  {selectedFeedbackIds.size}
                </div>
                <span className="text-sm text-slate-300 font-medium">
                  selected
                </span>
              </div>

              <textarea
                value={bulkNote}
                onChange={e => setBulkNote(e.target.value)}
                placeholder="Add a note to all selected…"
                rows={1}
                className="flex-1 min-w-[180px] px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:border-fuchsia-500/60 focus:outline-none resize-none"
                style={{ minHeight: '36px' }}
              />

              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => bulkUpdateFeedback('reviewed')}
                  disabled={bulkActionLoading}
                  className="px-3 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/40 border border-amber-500/30 text-amber-400 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Mark Reviewed
                </button>
                <button
                  onClick={() => bulkUpdateFeedback('resolved')}
                  disabled={bulkActionLoading}
                  className="px-3 py-2 rounded-lg bg-green-600/20 hover:bg-green-600/40 border border-green-500/30 text-green-400 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <CheckCircle size={13} className="inline mr-1 -mt-0.5" />
                  Mark Resolved
                </button>
                <button
                  onClick={bulkDeleteFeedback}
                  disabled={bulkActionLoading}
                  className="px-3 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-400 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Trash2 size={13} className="inline mr-1 -mt-0.5" />
                  Delete Selected
                </button>
                <button
                  onClick={() => { setSelectedFeedbackIds(new Set()); setBulkNote("") }}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                  title="Clear selection"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(activeEchoSelection && activeTab === 'echo') && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3 p-4 rounded-2xl border border-cyan-500/30 bg-slate-950/95 backdrop-blur-md shadow-2xl shadow-black/60">
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-6 h-6 rounded-full bg-cyan-600 flex items-center justify-center text-xs font-bold text-white">
                  {selectedEchoIds.size}
                </div>
                <span className="text-sm text-slate-300 font-medium">selected</span>
              </div>

              <div className="flex-1" />

              <div className="flex gap-2 shrink-0">
                <button
                  onClick={bulkDeleteEcho}
                  disabled={bulkActionLoading}
                  className="px-3 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-400 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Trash2 size={13} className="inline mr-1 -mt-0.5" />
                  Delete Selected
                </button>
                <button
                  onClick={() => setSelectedEchoIds(new Set())}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                  title="Clear selection"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
