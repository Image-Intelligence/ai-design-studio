"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import {
  Users as UsersIcon, RefreshCw, ChevronLeft, ChevronDown, ChevronRight,
  Crown, Ticket, DollarSign, Search, ArrowUpDown, AlertTriangle, X,
  ShieldCheck, ClipboardCheck, Loader2, RotateCcw, Ban, Sparkles, ShoppingCart, Clock, Tag
} from "lucide-react"

interface UserData {
  id: number
  email: string
  name: string | null
  createdAt: string
  ticketBalance: number
  totalTicketsBought: number
  totalTicketsUsed: number
  generationCount: number
  hasDevTier: boolean
  subscription: any | null
  recentPurchases: any[]
  recentTicketPurchases: any[]
  totalSpent: number
  totalPurchases: number
}

interface Stats {
  totalUsers: number
  devTierUsers: number
  freeUsers: number
}

function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.07] bg-white/[0.015] overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

function SectionLabel({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
      <Icon size={11} className="text-slate-600" />
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{label}</p>
    </div>
  )
}

function Divider() {
  return <div className="mx-4 border-t border-white/[0.04]" />
}

type ChipColor = 'cyan' | 'green' | 'yellow' | 'red' | 'violet' | 'slate' | 'fuchsia' | 'orange'

function Chip({ label, active, color = 'cyan', count, onClick, icon: Icon }: {
  label: string; active: boolean; color?: ChipColor
  count?: number; onClick: () => void; icon?: any
}) {
  const activeStyles: Record<ChipColor, string> = {
    cyan:    'border-cyan-500/40 bg-cyan-500/10 text-cyan-400',
    green:   'border-green-500/40 bg-green-500/10 text-green-400',
    yellow:  'border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
    red:     'border-red-500/40 bg-red-500/10 text-red-400',
    violet:  'border-violet-500/40 bg-violet-500/10 text-violet-400',
    slate:   'border-slate-500/40 bg-slate-500/10 text-slate-300',
    fuchsia: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-400',
    orange:  'border-orange-500/40 bg-orange-500/10 text-orange-400',
  }

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
        active ? activeStyles[color] : 'border-white/[0.07] bg-white/[0.02] text-slate-500 hover:text-slate-300 hover:border-white/[0.12]'
      }`}
    >
      {Icon && <Icon size={11} />}
      {label}
      {active && count !== undefined && (
        <span className="text-[9px] bg-black/20 px-1 py-0.5 rounded-full leading-none">{count}</span>
      )}
    </button>
  )
}

export default function AdminUsersPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [users, setUsers] = useState<UserData[]>([])
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, devTierUsers: 0, freeUsers: 0 })
  const [searchQuery, setSearchQuery] = useState("")
  const [filterTier, setFilterTier] = useState<'all' | 'dev' | 'free'>('all')
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<'totalSpent' | 'ticketBalance' | 'totalBought' | 'totalUsed' | 'generations' | 'purchases' | 'joinedNewest' | 'joinedOldest'>('totalSpent')
  const [filterStatus, setFilterStatus] = useState<'all' | 'hasPurchased' | 'neverPurchased' | 'hasTickets' | 'noTickets' | 'joinedThisWeek' | 'joinedThisMonth'>('all')

  // Reset tickets state
  const [showResetPanel, setShowResetPanel] = useState(false)
  const [resetExcludeAdmins, setResetExcludeAdmins] = useState(true)
  const [resetExcludeAudit, setResetExcludeAudit] = useState(true)
  const [resetExcludeIds, setResetExcludeIds] = useState<Set<number>>(new Set())
  const [resetUserSearch, setResetUserSearch] = useState("")
  const [resetPreview, setResetPreview] = useState<{ willReset: number; excluded: number } | null>(null)
  const [resetConfirmText, setResetConfirmText] = useState("")
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState<{ resetCount: number; excludedCount: number } | null>(null)
  const previewTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Revoke subscriptions state
  const [showRevokePanel, setShowRevokePanel] = useState(false)
  const [revokeExcludeAdmins, setRevokeExcludeAdmins] = useState(true)
  const [revokeExcludeAudit, setRevokeExcludeAudit] = useState(true)
  const [revokeExcludeIds, setRevokeExcludeIds] = useState<Set<number>>(new Set())
  const [revokeUserSearch, setRevokeUserSearch] = useState("")
  const [revokePreview, setRevokePreview] = useState<{ willRevoke: number; excluded: number } | null>(null)
  const [revokeConfirmText, setRevokeConfirmText] = useState("")
  const [revoking, setRevoking] = useState(false)
  const [revokeDone, setRevokeDone] = useState<{ revokedCount: number; excludedCount: number } | null>(null)
  const revokePreviewTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Repair reserved state
  const [repairingReserved, setRepairingReserved] = useState(false)
  const [repairReservedResult, setRepairReservedResult] = useState<string | null>(null)

  useEffect(() => {
    const authStatus = localStorage.getItem("multiverse-admin-auth")
    const savedPassword = sessionStorage.getItem("admin-password")
    if (authStatus === "true" && savedPassword) {
      setIsAuthenticated(true)
      fetchUsers()
    } else {
      localStorage.removeItem("multiverse-admin-auth")
      setIsLoading(false)
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (response.ok) {
        sessionStorage.setItem("admin-password", password)
        setIsAuthenticated(true)
        localStorage.setItem("multiverse-admin-auth", "true")
        fetchUsers()
      } else {
        alert("Invalid password")
      }
    } catch {
      alert("Authentication failed")
    }
  }

  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/users')
      const data = await res.json()
      if (data.success) {
        setUsers(data.users)
        setStats({ totalUsers: data.totalUsers, devTierUsers: data.devTierUsers, freeUsers: data.freeUsers })
      }
    } catch (err) {
      console.error("Failed to fetch users:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const formatDateTime = (dateString: string) =>
    new Date(dateString).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

  const adminPassword = () => sessionStorage.getItem("admin-password") || ""

  const fetchResetPreview = (excludeAdmins: boolean, excludeAudit: boolean, excludeIds: Set<number>) => {
    if (previewTimeout.current) clearTimeout(previewTimeout.current)
    previewTimeout.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          excludeAdmins: String(excludeAdmins),
          excludeAuditAccounts: String(excludeAudit),
          excludeUserIds: JSON.stringify(Array.from(excludeIds)),
        })
        const res = await fetch(`/api/admin/users/reset-tickets?${params}`, {
          headers: { 'x-admin-password': adminPassword() },
        })
        if (res.ok) setResetPreview(await res.json())
      } catch {}
    }, 400)
  }

  const toggleExcludeUser = (userId: number) => {
    setResetExcludeIds(prev => {
      const next = new Set(prev)
      next.has(userId) ? next.delete(userId) : next.add(userId)
      fetchResetPreview(resetExcludeAdmins, resetExcludeAudit, next)
      return next
    })
  }

  const handleResetTickets = async () => {
    if (resetConfirmText !== "RESET") return
    setResetting(true)
    try {
      const res = await fetch('/api/admin/users/reset-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword() },
        body: JSON.stringify({
          excludeAdmins: resetExcludeAdmins,
          excludeAuditAccounts: resetExcludeAudit,
          excludeUserIds: Array.from(resetExcludeIds),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setResetDone(data)
        setResetConfirmText("")
        await fetchUsers()
      } else {
        alert(data.error || 'Reset failed')
      }
    } finally {
      setResetting(false)
    }
  }

  const fetchRevokePreview = (excludeAdmins: boolean, excludeAudit: boolean, excludeIds: Set<number>) => {
    if (revokePreviewTimeout.current) clearTimeout(revokePreviewTimeout.current)
    revokePreviewTimeout.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          excludeAdmins: String(excludeAdmins),
          excludeAuditAccounts: String(excludeAudit),
          excludeUserIds: JSON.stringify(Array.from(excludeIds)),
        })
        const res = await fetch(`/api/admin/users/revoke-subscriptions?${params}`, {
          headers: { 'x-admin-password': adminPassword() },
        })
        if (res.ok) setRevokePreview(await res.json())
      } catch {}
    }, 400)
  }

  const toggleRevokeExcludeUser = (userId: number) => {
    setRevokeExcludeIds(prev => {
      const next = new Set(prev)
      next.has(userId) ? next.delete(userId) : next.add(userId)
      fetchRevokePreview(revokeExcludeAdmins, revokeExcludeAudit, next)
      return next
    })
  }

  const handleRevokeSubscriptions = async () => {
    if (revokeConfirmText !== "REVOKE") return
    setRevoking(true)
    try {
      const res = await fetch('/api/admin/users/revoke-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword() },
        body: JSON.stringify({
          excludeAdmins: revokeExcludeAdmins,
          excludeAuditAccounts: revokeExcludeAudit,
          excludeUserIds: Array.from(revokeExcludeIds),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setRevokeDone(data)
        setRevokeConfirmText("")
        await fetchUsers()
      } else {
        alert(data.error || 'Revoke failed')
      }
    } finally {
      setRevoking(false)
    }
  }

  // Filter + sort
  const now = Date.now()
  const filteredUsers = users
    .filter(user => {
      const matchesSearch = user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           user.name?.toLowerCase().includes(searchQuery.toLowerCase()) || false
      const matchesTier = filterTier === 'all' || (filterTier === 'dev' && user.hasDevTier) || (filterTier === 'free' && !user.hasDevTier)
      const age = now - new Date(user.createdAt).getTime()
      const matchesStatus =
        filterStatus === 'all'             ? true :
        filterStatus === 'hasPurchased'    ? user.totalSpent > 0 :
        filterStatus === 'neverPurchased'  ? user.totalSpent === 0 :
        filterStatus === 'hasTickets'      ? user.ticketBalance > 0 :
        filterStatus === 'noTickets'       ? user.ticketBalance === 0 :
        filterStatus === 'joinedThisWeek'  ? age < 7 * 86400_000 :
        filterStatus === 'joinedThisMonth' ? age < 30 * 86400_000 :
        true
      return matchesSearch && matchesTier && matchesStatus
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'totalSpent':    return b.totalSpent - a.totalSpent
        case 'ticketBalance': return b.ticketBalance - a.ticketBalance
        case 'totalBought':   return b.totalTicketsBought - a.totalTicketsBought
        case 'totalUsed':     return b.totalTicketsUsed - a.totalTicketsUsed
        case 'generations':   return (b.generationCount ?? 0) - (a.generationCount ?? 0)
        case 'purchases':     return b.totalPurchases - a.totalPurchases
        case 'joinedNewest':  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'joinedOldest':  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        default:              return 0
      }
    })

  // ── Login ───────────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#09090f] flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 justify-center mb-6">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <UsersIcon size={14} className="text-purple-400" />
            </div>
            <span className="text-sm font-bold text-white">User Management</span>
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
              <button type="submit" className="w-full h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 text-sm font-bold transition-colors">
                Authenticate
              </button>
            </form>
          </Section>
        </div>
      </div>
    )
  }

  // ── Main ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#09090f]">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-purple-500/[0.02] rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto px-5 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.location.href = '/admin'}
              className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.07] flex items-center justify-center hover:bg-white/[0.07] transition-colors text-slate-400 hover:text-white"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <UsersIcon size={16} className="text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">User Management</h1>
              <p className="text-[11px] text-slate-600 mt-0.5">{stats.totalUsers} accounts</p>
            </div>
          </div>
          <button
            onClick={fetchUsers}
            disabled={isLoading}
            className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.07] flex items-center justify-center hover:bg-white/[0.07] transition-colors text-slate-400 hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Total Users', value: stats.totalUsers,   color: 'text-white' },
            { label: 'Dev Tier',    value: stats.devTierUsers, color: 'text-cyan-400' },
            { label: 'Free Tier',   value: stats.freeUsers,    color: 'text-slate-400' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-3.5">
              <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-1.5">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color} leading-none`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Sort + Filter + Search */}
        <Section className="mb-4">
          {/* Search */}
          <div className="p-3 border-b border-white/[0.04]">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                type="text"
                placeholder="Search by email or name…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-sm bg-white/[0.03] border border-white/[0.06] rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-white/[0.12]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-white">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Sort */}
          <SectionLabel icon={ArrowUpDown} label="Sort By" />
          <div className="px-4 pb-3 flex flex-wrap gap-1.5">
            {([
              { key: 'totalSpent',    label: 'Total Spent',    icon: DollarSign,    color: 'green'   },
              { key: 'ticketBalance', label: 'Balance',        icon: Ticket,        color: 'yellow'  },
              { key: 'totalBought',   label: 'Tickets Bought', icon: Ticket,        color: 'cyan'    },
              { key: 'totalUsed',     label: 'Tickets Used',   icon: Ticket,        color: 'red'     },
              { key: 'generations',   label: 'Generations',    icon: Sparkles,      color: 'fuchsia' },
              { key: 'purchases',     label: 'Purchases',      icon: ShoppingCart,  color: 'orange'  },
              { key: 'joinedNewest',  label: 'Newest First',   icon: Clock,         color: 'violet'  },
              { key: 'joinedOldest',  label: 'Oldest First',   icon: Clock,         color: 'slate'   },
            ] as const).map(({ key, label, icon, color }) => (
              <Chip key={key} label={label} active={sortBy === key} color={color} icon={icon} onClick={() => setSortBy(key)} />
            ))}
          </div>

          <div className="mx-4 border-t border-white/[0.04]" />

          {/* Filter */}
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Search size={11} className="text-slate-600" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Filter</p>
            </div>
            {(filterTier !== 'all' || filterStatus !== 'all') && (
              <button onClick={() => { setFilterTier('all'); setFilterStatus('all') }}
                className="text-[11px] text-slate-600 hover:text-white transition-colors flex items-center gap-1">
                <X size={10} /> Clear
              </button>
            )}
          </div>
          <div className="px-4 pb-3 flex flex-wrap gap-1.5">
            <Chip label="Dev Tier"    active={filterTier === 'dev'}                  color="cyan"    icon={Crown}        count={filteredUsers.length} onClick={() => setFilterTier(filterTier === 'dev' ? 'all' : 'dev')} />
            <Chip label="Free Only"   active={filterTier === 'free'}                 color="slate"                       count={filteredUsers.length} onClick={() => setFilterTier(filterTier === 'free' ? 'all' : 'free')} />
            <Chip label="Has Spent"   active={filterStatus === 'hasPurchased'}        color="green"   icon={DollarSign}   count={filteredUsers.length} onClick={() => setFilterStatus(filterStatus === 'hasPurchased' ? 'all' : 'hasPurchased')} />
            <Chip label="Never Spent" active={filterStatus === 'neverPurchased'}      color="slate"                       count={filteredUsers.length} onClick={() => setFilterStatus(filterStatus === 'neverPurchased' ? 'all' : 'neverPurchased')} />
            <Chip label="Has Tickets" active={filterStatus === 'hasTickets'}          color="yellow"  icon={Ticket}       count={filteredUsers.length} onClick={() => setFilterStatus(filterStatus === 'hasTickets' ? 'all' : 'hasTickets')} />
            <Chip label="No Tickets"  active={filterStatus === 'noTickets'}           color="red"                         count={filteredUsers.length} onClick={() => setFilterStatus(filterStatus === 'noTickets' ? 'all' : 'noTickets')} />
            <Chip label="This Week"   active={filterStatus === 'joinedThisWeek'}      color="violet"  icon={Clock}        count={filteredUsers.length} onClick={() => setFilterStatus(filterStatus === 'joinedThisWeek' ? 'all' : 'joinedThisWeek')} />
            <Chip label="This Month"  active={filterStatus === 'joinedThisMonth'}     color="violet"  icon={Clock}        count={filteredUsers.length} onClick={() => setFilterStatus(filterStatus === 'joinedThisMonth' ? 'all' : 'joinedThisMonth')} />
          </div>

          {(filterTier !== 'all' || filterStatus !== 'all' || searchQuery) && (
            <div className="px-4 py-2 border-t border-white/[0.04] text-[11px] text-slate-600">
              Showing <span className="text-white font-bold">{filteredUsers.length}</span> of {users.length} users
            </div>
          )}
        </Section>

        {/* Danger Zone — Reset Tickets */}
        <div className="mb-3 rounded-xl border border-red-500/15 bg-red-500/[0.02] overflow-hidden">
          <button
            onClick={() => {
              setShowResetPanel(v => !v)
              if (!showResetPanel) fetchResetPreview(resetExcludeAdmins, resetExcludeAudit, resetExcludeIds)
            }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-red-500/[0.03] transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={12} className="text-red-400/70" />
              <span className="text-xs font-bold text-red-400/80">Reset All Ticket Balances</span>
            </div>
            {showResetPanel ? <ChevronDown size={12} className="text-red-400/40" /> : <ChevronRight size={12} className="text-red-400/40" />}
          </button>

          {showResetPanel && (
            <div className="px-4 pb-4 space-y-3 border-t border-red-500/[0.08]">
              <p className="text-[11px] text-slate-600 pt-3 leading-relaxed">
                Sets every user's ticket balance to <span className="text-white font-medium">0</span>. Cannot be undone.
              </p>

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Exclude from reset:</p>
                {[
                  { label: 'Admin accounts', state: resetExcludeAdmins, icon: ShieldCheck,   color: 'bg-cyan-500',  onToggle: () => { const n = !resetExcludeAdmins; setResetExcludeAdmins(n); fetchResetPreview(n, resetExcludeAudit, resetExcludeIds) } },
                  { label: 'Audit accounts', state: resetExcludeAudit,  icon: ClipboardCheck, color: 'bg-amber-500', onToggle: () => { const n = !resetExcludeAudit; setResetExcludeAudit(n); fetchResetPreview(resetExcludeAdmins, n, resetExcludeIds) } },
                ].map(({ label, state, icon: Icon, color, onToggle }) => (
                  <label key={label} className="flex items-center gap-2.5 cursor-pointer select-none group">
                    <div onClick={onToggle} className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${state ? color : 'bg-white/[0.08]'}`}>
                      <div className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${state ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                    <Icon size={12} className={state ? 'text-slate-400' : 'text-slate-700'} />
                    <span className="text-xs text-slate-500 group-hover:text-slate-300">{label}</span>
                  </label>
                ))}
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Exclude specific accounts:</p>
                <div className="relative mb-2">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
                  <input value={resetUserSearch} onChange={e => setResetUserSearch(e.target.value)}
                    placeholder="Search users to exclude…"
                    className="w-full pl-7 pr-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.07] rounded-lg text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-red-500/30" />
                </div>
                {resetExcludeIds.size > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {Array.from(resetExcludeIds).map(uid => {
                      const u = users.find(x => x.id === uid)
                      return u ? (
                        <span key={uid} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-slate-400">
                          {u.email}
                          <button onClick={() => toggleExcludeUser(uid)}><X size={8} className="text-slate-600 hover:text-white" /></button>
                        </span>
                      ) : null
                    })}
                  </div>
                )}
                {resetUserSearch.trim() && (
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/30 divide-y divide-white/[0.03]">
                    {users.filter(u =>
                      (u.email?.toLowerCase().includes(resetUserSearch.toLowerCase()) || u.name?.toLowerCase().includes(resetUserSearch.toLowerCase())) && !resetExcludeIds.has(u.id)
                    ).slice(0, 20).map(u => (
                      <button key={u.id} onClick={() => { toggleExcludeUser(u.id); setResetUserSearch("") }}
                        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/[0.03] text-left">
                        <span className="text-xs text-slate-400 truncate">{u.email}</span>
                        <span className="text-[10px] text-slate-600 ml-2 shrink-0">{u.ticketBalance} tickets</span>
                      </button>
                    ))}
                    {users.filter(u => u.email?.toLowerCase().includes(resetUserSearch.toLowerCase()) && !resetExcludeIds.has(u.id)).length === 0 && (
                      <p className="text-xs text-slate-700 px-3 py-2">No matching users</p>
                    )}
                  </div>
                )}
              </div>

              {resetPreview && (
                <div className="flex items-center gap-2 text-[11px] px-3 py-2 rounded-lg bg-red-500/[0.05] border border-red-500/15">
                  <RotateCcw size={11} className="text-red-400/70 shrink-0" />
                  <span className="text-red-400/80">Will reset <span className="font-bold text-white">{resetPreview.willReset}</span> account{resetPreview.willReset !== 1 ? 's' : ''}</span>
                  {resetPreview.excluded > 0 && <span className="text-slate-600 ml-auto">{resetPreview.excluded} excluded</span>}
                </div>
              )}
              {resetDone && (
                <div className="text-[11px] px-3 py-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15 text-emerald-400">
                  Done — <span className="font-bold">{resetDone.resetCount}</span> accounts zeroed, {resetDone.excludedCount} skipped.
                </div>
              )}
              <div className="flex items-center gap-2">
                <input value={resetConfirmText} onChange={e => setResetConfirmText(e.target.value)}
                  placeholder='Type "RESET" to confirm'
                  className="flex-1 px-3 py-1.5 text-xs bg-white/[0.03] border border-red-500/15 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-red-500/40" />
                <button onClick={handleResetTickets} disabled={resetConfirmText !== "RESET" || resetting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/[0.08] border border-red-500/20 text-red-400 hover:bg-red-500/[0.15] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  {resetting ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Repair Corrupted Reserved Balances */}
        <div className="mb-3 rounded-xl border border-orange-500/15 bg-orange-500/[0.02] overflow-hidden px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={12} className="text-orange-400/70" />
              <div>
                <span className="text-xs font-bold text-orange-400/80">Repair Negative Reserved Balances</span>
                <p className="text-[10px] text-slate-600 mt-0.5">Resets any user whose reserved field went negative (allows free generations). Run after resetting ticket balances.</p>
              </div>
            </div>
            <button
              onClick={async () => {
                setRepairingReserved(true)
                setRepairReservedResult(null)
                try {
                  const pass = sessionStorage.getItem('admin-password') ?? ''
                  const res = await fetch('/api/admin/repair-reserved', {
                    method: 'POST',
                    headers: pass ? { 'x-admin-password': pass } : {},
                  })
                  const data = await res.json()
                  setRepairReservedResult(data.message ?? 'Done')
                } catch {
                  setRepairReservedResult('Failed — check console')
                } finally {
                  setRepairingReserved(false)
                }
              }}
              disabled={repairingReserved}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-500/[0.08] border border-orange-500/20 text-orange-400 hover:bg-orange-500/[0.15] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0 ml-4"
            >
              {repairingReserved ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
              Repair
            </button>
          </div>
          {repairReservedResult && (
            <p className="mt-2 text-[11px] text-orange-300/70">{repairReservedResult}</p>
          )}
        </div>

        {/* Danger Zone — Revoke Subscriptions */}
        <div className="mb-5 rounded-xl border border-purple-500/15 bg-purple-500/[0.02] overflow-hidden">
          <button
            onClick={() => {
              setShowRevokePanel(v => !v)
              if (!showRevokePanel) fetchRevokePreview(revokeExcludeAdmins, revokeExcludeAudit, revokeExcludeIds)
            }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-purple-500/[0.03] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Ban size={12} className="text-purple-400/70" />
              <span className="text-xs font-bold text-purple-400/80">Revoke All Dev Tier Subscriptions</span>
            </div>
            {showRevokePanel ? <ChevronDown size={12} className="text-purple-400/40" /> : <ChevronRight size={12} className="text-purple-400/40" />}
          </button>

          {showRevokePanel && (
            <div className="px-4 pb-4 space-y-3 border-t border-purple-500/[0.08]">
              <p className="text-[11px] text-slate-600 pt-3 leading-relaxed">
                Cancels all active subscriptions immediately. Cannot be undone.
              </p>

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Exclude from revoke:</p>
                {[
                  { label: 'Admin accounts', state: revokeExcludeAdmins, icon: ShieldCheck,   color: 'bg-cyan-500',  onToggle: () => { const n = !revokeExcludeAdmins; setRevokeExcludeAdmins(n); fetchRevokePreview(n, revokeExcludeAudit, revokeExcludeIds) } },
                  { label: 'Audit accounts', state: revokeExcludeAudit,  icon: ClipboardCheck, color: 'bg-amber-500', onToggle: () => { const n = !revokeExcludeAudit; setRevokeExcludeAudit(n); fetchRevokePreview(revokeExcludeAdmins, n, revokeExcludeIds) } },
                ].map(({ label, state, icon: Icon, color, onToggle }) => (
                  <label key={label} className="flex items-center gap-2.5 cursor-pointer select-none group">
                    <div onClick={onToggle} className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${state ? color : 'bg-white/[0.08]'}`}>
                      <div className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${state ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                    <Icon size={12} className={state ? 'text-slate-400' : 'text-slate-700'} />
                    <span className="text-xs text-slate-500 group-hover:text-slate-300">{label}</span>
                  </label>
                ))}
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Exclude specific accounts:</p>
                <div className="relative mb-2">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
                  <input value={revokeUserSearch} onChange={e => setRevokeUserSearch(e.target.value)}
                    placeholder="Search dev tier users to exclude…"
                    className="w-full pl-7 pr-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.07] rounded-lg text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-purple-500/30" />
                </div>
                {revokeExcludeIds.size > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {Array.from(revokeExcludeIds).map(uid => {
                      const u = users.find(x => x.id === uid)
                      return u ? (
                        <span key={uid} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-slate-400">
                          {u.email}
                          <button onClick={() => toggleRevokeExcludeUser(uid)}><X size={8} className="text-slate-600 hover:text-white" /></button>
                        </span>
                      ) : null
                    })}
                  </div>
                )}
                {revokeUserSearch.trim() && (
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/30 divide-y divide-white/[0.03]">
                    {users.filter(u =>
                      u.hasDevTier &&
                      (u.email?.toLowerCase().includes(revokeUserSearch.toLowerCase()) || u.name?.toLowerCase().includes(revokeUserSearch.toLowerCase())) &&
                      !revokeExcludeIds.has(u.id)
                    ).slice(0, 20).map(u => (
                      <button key={u.id} onClick={() => { toggleRevokeExcludeUser(u.id); setRevokeUserSearch("") }}
                        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/[0.03] text-left">
                        <span className="text-xs text-slate-400 truncate">{u.email}</span>
                        <span className="text-[10px] text-purple-400/60 ml-2 shrink-0">Dev Tier</span>
                      </button>
                    ))}
                    {users.filter(u =>
                      u.hasDevTier && u.email?.toLowerCase().includes(revokeUserSearch.toLowerCase()) && !revokeExcludeIds.has(u.id)
                    ).length === 0 && (
                      <p className="text-xs text-slate-700 px-3 py-2">No matching Dev Tier users</p>
                    )}
                  </div>
                )}
              </div>

              {revokePreview && (
                <div className="flex items-center gap-2 text-[11px] px-3 py-2 rounded-lg bg-purple-500/[0.05] border border-purple-500/15">
                  <Ban size={11} className="text-purple-400/70 shrink-0" />
                  <span className="text-purple-400/80">Will revoke <span className="font-bold text-white">{revokePreview.willRevoke}</span> subscription{revokePreview.willRevoke !== 1 ? 's' : ''}</span>
                  {revokePreview.excluded > 0 && <span className="text-slate-600 ml-auto">{revokePreview.excluded} excluded</span>}
                </div>
              )}
              {revokeDone && (
                <div className="text-[11px] px-3 py-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15 text-emerald-400">
                  Done — <span className="font-bold">{revokeDone.revokedCount}</span> subscription{revokeDone.revokedCount !== 1 ? 's' : ''} revoked, {revokeDone.excludedCount} skipped.
                </div>
              )}
              <div className="flex items-center gap-2">
                <input value={revokeConfirmText} onChange={e => setRevokeConfirmText(e.target.value)}
                  placeholder='Type "REVOKE" to confirm'
                  className="flex-1 px-3 py-1.5 text-xs bg-white/[0.03] border border-purple-500/15 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500/40" />
                <button onClick={handleRevokeSubscriptions} disabled={revokeConfirmText !== "REVOKE" || revoking}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-500/[0.08] border border-purple-500/20 text-purple-400 hover:bg-purple-500/[0.15] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  {revoking ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />}
                  Revoke
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Users List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-600">
            <RefreshCw className="animate-spin mr-2" size={15} />
            <span className="text-sm">Loading…</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-700">
            <UsersIcon size={28} className="mb-3 opacity-40" />
            <p className="text-sm">No users match your filters</p>
          </div>
        ) : (
          <Section>
            {filteredUsers.map((user, index) => (
              <div key={user.id}>
                {index > 0 && <Divider />}

                {/* Compact user row */}
                <button
                  onClick={() => setExpandedUserId(expandedUserId === user.id ? null : user.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
                >
                  <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${
                    user.hasDevTier
                      ? 'bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-cyan-300 border border-cyan-500/20'
                      : 'bg-white/[0.05] text-slate-500 border border-white/[0.06]'
                  }`}>
                    {user.email?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-white truncate">{user.email || 'No email'}</span>
                      {user.hasDevTier && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shrink-0">DEV</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5">Joined {formatDate(user.createdAt)}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-bold text-white leading-none">{user.ticketBalance}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">tickets</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-green-400 leading-none">${user.totalSpent.toFixed(0)}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">spent</p>
                    </div>
                  </div>
                  <ChevronRight size={13} className={`shrink-0 text-slate-600 transition-transform duration-150 ${expandedUserId === user.id ? 'rotate-90' : ''}`} />
                </button>

                {/* Expanded details */}
                {expandedUserId === user.id && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/[0.04]">
                    {/* Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { label: 'Balance',  value: String(user.ticketBalance),          color: 'text-yellow-400', icon: Ticket },
                        { label: 'Spent',    value: `$${user.totalSpent.toFixed(2)}`,    color: 'text-green-400',  icon: DollarSign },
                        { label: 'Bought',   value: String(user.totalTicketsBought),     color: 'text-cyan-400',   icon: Ticket },
                        { label: 'Used',     value: String(user.totalTicketsUsed),       color: 'text-red-400',    icon: Ticket },
                      ].map(s => (
                        <div key={s.label} className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5">
                          <div className="flex items-center gap-1.5 mb-1">
                            <s.icon size={11} className={s.color} />
                            <span className="text-[10px] text-slate-600">{s.label}</span>
                          </div>
                          <p className="text-sm font-bold text-white">{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Subscription */}
                    {user.subscription && (
                      <div className="rounded-lg bg-cyan-500/[0.04] border border-cyan-500/15 p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Crown size={11} className="text-cyan-400" />
                          <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wide">Active Subscription</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          {[
                            { label: 'Plan',         value: user.subscription.billingCycle || 'Monthly' },
                            { label: 'Amount',       value: `$${user.subscription.billingAmount?.toFixed(2) || 'N/A'}` },
                            { label: 'Next Billing', value: user.subscription.nextBillingDate ? formatDate(user.subscription.nextBillingDate) : 'N/A' },
                            { label: 'Started',      value: formatDate(user.subscription.createdAt) },
                          ].map(item => (
                            <div key={item.label}>
                              <p className="text-slate-600 mb-0.5">{item.label}</p>
                              <p className="text-white font-medium capitalize">{item.value}</p>
                            </div>
                          ))}
                        </div>
                        {user.subscription.metadata?.ticketsPerCycle && (
                          <div className="mt-2 text-[11px] text-emerald-400">
                            <Ticket size={10} className="inline mr-1" />{user.subscription.metadata.ticketsPerCycle} tickets / cycle
                          </div>
                        )}
                      </div>
                    )}

                    {/* Transactions */}
                    {(user.recentPurchases.length > 0 || user.recentTicketPurchases.length > 0) && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <DollarSign size={11} className="text-slate-600" />
                          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Recent Transactions</p>
                        </div>
                        <div className="space-y-1.5">
                          {user.recentTicketPurchases.map(purchase => (
                            <div key={`t-${purchase.id}`} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs">
                              <div className="flex items-center gap-2">
                                <Ticket size={11} className="text-yellow-400 shrink-0" />
                                <span className="text-slate-300 font-medium">{purchase.tickets} Tickets</span>
                                {purchase.discountCode && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/15 text-green-400 flex items-center gap-0.5">
                                    <Tag size={8} />{purchase.discountCode}
                                  </span>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="text-green-400 font-bold">${purchase.amount.toFixed(2)}</p>
                                <p className="text-slate-600 text-[10px]">{formatDateTime(purchase.date)}</p>
                              </div>
                            </div>
                          ))}
                          {user.recentPurchases.map(purchase => (
                            <div key={`p-${purchase.id}`} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs">
                              <div className="flex items-center gap-2">
                                <DollarSign size={11} className="text-purple-400 shrink-0" />
                                <span className="text-slate-300 font-medium capitalize">{purchase.type}</span>
                              </div>
                              <div className="text-right">
                                <p className="text-green-400 font-bold">${purchase.amount.toFixed(2)}</p>
                                <p className="text-slate-600 text-[10px]">{formatDateTime(purchase.date)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </Section>
        )}

      </div>
    </div>
  )
}
