"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ArrowLeft, CreditCard, AlertCircle, CheckCircle, XCircle, ToggleLeft, ToggleRight, Trash2, DollarSign, Calendar, User, Mail, RefreshCw, Gift, UserPlus, CalendarClock, Search, CloudLightning, ShieldCheck, MinusCircle, AlertTriangle } from "lucide-react"
import { useRouter } from "next/navigation"

interface SubscriptionTransaction {
  id: number
  subscriptionId: number
  userId: number
  type: string // 'payment' | 'ticket_distribution'
  amount: number | null
  paypalTransactionId: string | null
  ticketsAdded: number | null
  previousBalance: number | null
  newBalance: number | null
  description: string | null
  metadata: any
  createdAt: string
}

interface Subscription {
  id: number
  userId: number
  tier: string
  status: string
  startDate: string
  endDate: string | null
  nextBillingDate: string | null
  billingAmount: number | null
  billingCycle: string | null
  autoRenew: boolean
  cancelledAt: string | null
  paypalSubscriptionId: string | null
  paypalOrderId: string | null
  paypalCaptureId: string | null
  lsSubscriptionId: string | null
  lsCurrentPeriodEnd: string | null
  metadata: any
  createdAt: string
  updatedAt: string
  user: {
    id: number
    email: string
    name: string | null
    createdAt: string
  }
  transactions: SubscriptionTransaction[]
}

export default function DevTierAnalytics() {
  const router = useRouter()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ synced: number; skipped: number; failed: number; discovered: number; results: any[] } | null>(null)

  // Grant access state (top form — by email)
  const [grantEmail, setGrantEmail] = useState('')
  const [grantCycle, setGrantCycle] = useState('monthly')
  const [grantEndDate, setGrantEndDate] = useState('')
  const [grantTickets, setGrantTickets] = useState(true)
  const [granting, setGranting] = useState(false)
  const [grantResult, setGrantResult] = useState<{ success: boolean; message: string } | null>(null)

  // Per-card inline grant form
  const [cardGrantId, setCardGrantId]       = useState<number | null>(null)
  const [cardGrantCycle, setCardGrantCycle] = useState('monthly')
  const [cardGrantEndDate, setCardGrantEndDate] = useState('')
  const [cardGrantTickets, setCardGrantTickets] = useState(true)
  const [cardGranting, setCardGranting]     = useState(false)

  // Per-card sync
  const [syncingSubId, setSyncingSubId]     = useState<number | null>(null)
  const [syncSingleResults, setSyncSingleResults] = useState<Record<number, { success: boolean; message: string }>>({})

  // Duplicate detection
  const [duplicateCount, setDuplicateCount] = useState<number | null>(null)
  const [duplicateDetails, setDuplicateDetails] = useState<{ email: string; count: number; canAutoResolve: boolean }[]>([])
  const [resolvingDuplicates, setResolvingDuplicates] = useState(false)
  const [resolveResult, setResolveResult] = useState<{ count: number; deleted: any[] } | null>(null)

  // Search
  const [searchQuery, setSearchQuery] = useState('')

  // Edit end date state
  const [editingEndDateId, setEditingEndDateId] = useState<number | null>(null)
  const [editEndDateValue, setEditEndDateValue] = useState('')
  const [savingEndDate, setSavingEndDate] = useState(false)

  const fetchSubscriptions = async () => {
    setLoading(true)
    setError(null)
    try {
      const pw = sessionStorage.getItem('admin-password') || ''
      const [response, dupRes] = await Promise.all([
        fetch('/api/admin/subscriptions', { headers: { 'x-admin-password': pw } }),
        fetch('/api/admin/subscriptions/resolve-duplicates', { headers: { 'x-admin-password': pw } }),
      ])

      if (!response.ok) throw new Error('Failed to fetch subscriptions')

      const data = await response.json()
      setSubscriptions(data.subscriptions || [])

      if (dupRes.ok) {
        const dupData = await dupRes.json()
        setDuplicateCount(dupData.duplicateUserCount ?? 0)
        setDuplicateDetails(dupData.duplicates ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }

  const resolveDuplicates = async (force = false) => {
    setResolvingDuplicates(true)
    setResolveResult(null)
    try {
      const res = await fetch('/api/admin/subscriptions/resolve-duplicates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': sessionStorage.getItem('admin-password') || '',
        },
        body: JSON.stringify({ force }),
      })
      const data = await res.json()
      if (data.success) {
        setResolveResult({ count: data.count, deleted: data.deleted })
        await fetchSubscriptions()
      } else {
        alert(data.error || 'Failed to resolve duplicates')
      }
    } catch {
      alert('Request failed')
    } finally {
      setResolvingDuplicates(false)
    }
  }

  useEffect(() => {
    fetchSubscriptions()
  }, [])

  // Auto end-date from billing cycle
  function calcEndDateLocal(cycle: string): string {
    const d = new Date()
    if (cycle === 'biweekly') d.setDate(d.getDate() + 14)
    else if (cycle === 'monthly') d.setMonth(d.getMonth() + 1)
    else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  }

  // Auto-fill top form end date when cycle changes
  useEffect(() => {
    setGrantEndDate(calcEndDateLocal(grantCycle))
  }, [grantCycle])

  // Init top form end date on mount
  useEffect(() => {
    setGrantEndDate(calcEndDateLocal('monthly'))
  }, [])

  const deleteRecord = async (subscriptionId: number, userEmail: string) => {
    if (!confirm(`⚠️ Permanently delete this subscription record for ${userEmail}?\n\nThis removes it from the database entirely. The user's active subscription (if any) is not affected.`)) return
    setProcessingId(subscriptionId)
    try {
      const res = await fetch(
        `/api/admin/subscriptions?id=${subscriptionId}&password=${encodeURIComponent(sessionStorage.getItem('admin-password') || '')}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to delete')
      }
      await fetchSubscriptions()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete record')
    } finally {
      setProcessingId(null)
    }
  }

  const toggleAutoRenew = async (subscriptionId: number, currentAutoRenew: boolean) => {
    if (!confirm(`Are you sure you want to ${currentAutoRenew ? 'disable' : 'enable'} auto-renew for this subscription?`)) {
      return
    }

    setProcessingId(subscriptionId)
    try {
      const response = await fetch('/api/admin/subscriptions/toggle-auto-renew', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': sessionStorage.getItem('admin-password') || ''
        },
        body: JSON.stringify({
          subscriptionId,
          autoRenew: !currentAutoRenew
        })
      })

      if (!response.ok) {
        throw new Error('Failed to toggle auto-renew')
      }

      await fetchSubscriptions()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to toggle auto-renew')
    } finally {
      setProcessingId(null)
    }
  }

  const revokeAccess = async (subscriptionId: number, userEmail: string) => {
    if (!confirm(`⚠️ WARNING: This will IMMEDIATELY revoke Dev Tier access for ${userEmail}.\n\nThis will:\n- Set status to 'cancelled'\n- End their subscription access now\n- They will lose all Dev Tier features immediately\n\nAre you absolutely sure?`)) {
      return
    }

    setProcessingId(subscriptionId)
    try {
      const response = await fetch('/api/admin/subscriptions/revoke-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': sessionStorage.getItem('admin-password') || ''
        },
        body: JSON.stringify({ subscriptionId })
      })

      if (!response.ok) {
        throw new Error('Failed to revoke access')
      }

      await fetchSubscriptions()
      alert('Access revoked successfully')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke access')
    } finally {
      setProcessingId(null)
    }
  }

  const distributeTickets = async (subscriptionId: number, userEmail: string) => {
    const ticketAmount = prompt(`How many tickets would you like to distribute to ${userEmail}?`)
    if (!ticketAmount) return

    const tickets = parseInt(ticketAmount)
    if (isNaN(tickets) || tickets <= 0) {
      alert('Please enter a valid positive number')
      return
    }

    const description = prompt(`Optional: Add a description for this distribution\n(e.g., "Bonus tickets", "Compensation", etc.)`) || undefined

    setProcessingId(subscriptionId)
    try {
      const response = await fetch('/api/admin/subscriptions/distribute-tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': sessionStorage.getItem('admin-password') || ''
        },
        body: JSON.stringify({ subscriptionId, ticketAmount: tickets, description })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to distribute tickets')
      }

      const data = await response.json()
      await fetchSubscriptions()
      alert(`✅ Distributed ${tickets} tickets!\n\nPrevious: ${data.transaction.previousBalance} → New: ${data.transaction.newBalance}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to distribute tickets')
    } finally {
      setProcessingId(null)
    }
  }

  const revokeTickets = async (subscriptionId: number, userEmail: string) => {
    const ticketAmount = prompt(`How many tickets would you like to REVOKE from ${userEmail}?\n(Balance will not go below 0)`)
    if (!ticketAmount) return

    const tickets = parseInt(ticketAmount)
    if (isNaN(tickets) || tickets <= 0) {
      alert('Please enter a valid positive number')
      return
    }

    const description = prompt(`Optional: Add a reason for this revocation`) || undefined

    setProcessingId(subscriptionId)
    try {
      const response = await fetch('/api/admin/subscriptions/revoke-tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': sessionStorage.getItem('admin-password') || ''
        },
        body: JSON.stringify({ subscriptionId, ticketAmount: tickets, description })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to revoke tickets')
      }

      const data = await response.json()
      await fetchSubscriptions()
      alert(`⚠️ Revoked ${data.transaction.ticketsRevoked} tickets!\n\nPrevious: ${data.transaction.previousBalance} → New: ${data.transaction.newBalance}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke tickets')
    } finally {
      setProcessingId(null)
    }
  }

  const syncLsCancellations = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/admin/subscriptions/sync-ls-cancellations', {
        method: 'POST',
        headers: { 'x-admin-password': sessionStorage.getItem('admin-password') || '' },
      })
      const data = await res.json()
      if (data.success) {
        setSyncResult({ synced: data.synced, skipped: data.skipped ?? 0, failed: data.failed, discovered: data.discovered ?? 0, results: data.results })
      } else {
        alert(data.error || 'Sync failed')
      }
    } catch {
      alert('Sync request failed')
    } finally {
      setSyncing(false)
    }
  }

  const grantAccess = async () => {
    if (!grantEmail.trim()) return
    setGranting(true)
    setGrantResult(null)
    try {
      const res = await fetch('/api/admin/subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: sessionStorage.getItem('admin-password') || '',
          userEmail: grantEmail.trim().toLowerCase(),
          tier: 'prompt-studio-dev',
          billingCycle: grantCycle,
          deliverTickets: grantTickets,
          endDate: grantEndDate || null,
        }),
      })
      const data = await res.json()
      if (data.success) {
        const ticketMsg = data.ticketsDelivered > 0 ? ` + ${data.ticketsDelivered} tickets delivered` : ''
        setGrantResult({ success: true, message: `Access granted to ${grantEmail}${ticketMsg}` })
        setGrantEmail('')
        await fetchSubscriptions()
      } else {
        setGrantResult({ success: false, message: data.error || 'Failed to grant access' })
      }
    } catch {
      setGrantResult({ success: false, message: 'Request failed' })
    } finally {
      setGranting(false)
    }
  }

  const openCardGrant = (subId: number) => {
    setCardGrantId(subId)
    setCardGrantCycle('monthly')
    setCardGrantEndDate(calcEndDateLocal('monthly'))
    setCardGrantTickets(true)
  }

  // Re-activates the specific subscription record in place (avoids "already has active" conflict)
  const grantAccessByCard = async (subscriptionId: number) => {
    setCardGranting(true)
    try {
      const res = await fetch('/api/admin/subscriptions/reactivate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': sessionStorage.getItem('admin-password') || '',
        },
        body: JSON.stringify({
          subscriptionId,
          billingCycle: cardGrantCycle,
          deliverTickets: cardGrantTickets,
          endDate: cardGrantEndDate || null,
        }),
      })
      const data = await res.json()
      if (data.success) {
        const ticketMsg = data.ticketsDelivered > 0 ? ` + ${data.ticketsDelivered} tickets` : ''
        setGrantResult({ success: true, message: `Access granted${ticketMsg}` })
        setCardGrantId(null)
        await fetchSubscriptions()
      } else {
        alert(data.error || 'Failed to grant access')
      }
    } catch {
      alert('Request failed')
    } finally {
      setCardGranting(false)
    }
  }

  const syncSingle = async (subId: number) => {
    setSyncingSubId(subId)
    setSyncSingleResults(prev => { const n = { ...prev }; delete n[subId]; return n })
    try {
      const res = await fetch('/api/admin/subscriptions/sync-ls-single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': sessionStorage.getItem('admin-password') || '',
        },
        body: JSON.stringify({ subscriptionId: subId }),
      })
      const data = await res.json()
      if (data.success) {
        setSyncSingleResults(prev => ({ ...prev, [subId]: { success: true, message: `LS: ${data.lsStatus} → DB: ${data.ourStatus}` } }))
        await fetchSubscriptions()
      } else {
        setSyncSingleResults(prev => ({ ...prev, [subId]: { success: false, message: data.error || 'Sync failed' } }))
      }
    } catch {
      setSyncSingleResults(prev => ({ ...prev, [subId]: { success: false, message: 'Request failed' } }))
    } finally {
      setSyncingSubId(null)
    }
  }

  const saveEndDate = async (subscriptionId: number) => {
    setSavingEndDate(true)
    try {
      const res = await fetch('/api/admin/subscriptions', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: sessionStorage.getItem('admin-password') || '',
          id: subscriptionId,
          endDate: editEndDateValue || null,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setEditingEndDateId(null)
        setEditEndDateValue('')
        await fetchSubscriptions()
      } else {
        alert(data.error || 'Failed to update end date')
      }
    } catch {
      alert('Request failed')
    } finally {
      setSavingEndDate(false)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatCurrency = (amount: number | null) => {
    if (amount === null) return 'N/A'
    return `$${amount.toFixed(2)}`
  }

  const GRANDFATHER_CUTOFF = new Date('2026-04-23T00:00:00Z')

  const getDiscountInfo = (sub: Subscription) => {
    const state = getSubState(sub)
    if (state !== 'active-renewing' && state !== 'active-cancelled') return null
    const createdBefore = new Date(sub.createdAt) < GRANDFATHER_CUTOFF
    const periodEnd = sub.lsCurrentPeriodEnd ? new Date(sub.lsCurrentPeriodEnd) : null
    const endDate   = sub.endDate ? new Date(sub.endDate) : null
    const activeUntil = periodEnd ?? endDate
    const stillInPeriod = !activeUntil || activeUntil > new Date()
    const isGrandfathered = createdBefore && stillInPeriod
    return { isGrandfathered, periodEnd: activeUntil }
  }

  const getSubState = (sub: Subscription): 'active-renewing' | 'active-cancelled' | 'cancelled-expired' | 'expired' | 'other' => {
    const now = new Date()
    if (sub.status === 'active' && !sub.cancelledAt) return 'active-renewing'
    if (sub.status === 'active' && sub.cancelledAt) return 'active-cancelled'
    if (sub.status === 'cancelled') {
      const periodEnd = sub.lsCurrentPeriodEnd ? new Date(sub.lsCurrentPeriodEnd) : null
      const endDate   = sub.endDate ? new Date(sub.endDate) : null
      const hasTimeLeft = (periodEnd && periodEnd > now) || (endDate && endDate > now)
      return hasTimeLeft ? 'active-cancelled' : 'cancelled-expired'
    }
    if (sub.status === 'expired') return 'expired'
    return 'other'
  }

  const getStatusBadge = (sub: Subscription) => {
    const state = getSubState(sub)
    switch (state) {
      case 'active-renewing':
        return <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-xs font-bold border border-green-500/50">ACTIVE · RENEWING</span>
      case 'active-cancelled':
        return (
          <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/50">
            ACTIVE · CANCELLED
          </span>
        )
      case 'cancelled-expired':
        return <span className="px-3 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold border border-red-500/50">CANCELLED · EXPIRED</span>
      case 'expired':
        return <span className="px-3 py-1 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold border border-orange-500/50">EXPIRED</span>
      default:
        return <span className="px-3 py-1 rounded-full bg-slate-500/20 text-slate-400 text-xs font-bold border border-slate-500/50">{sub.status.toUpperCase()}</span>
    }
  }

  const getTotalRevenue = () => {
    return subscriptions.reduce((total, sub) => {
      return total + (sub.billingAmount || 0)
    }, 0)
  }

  const getActiveCount = () => {
    return subscriptions.filter(sub => sub.status === 'active').length
  }

  const getCancelledCount = () => {
    return subscriptions.filter(sub => sub.status === 'cancelled').length
  }

  return (
    <div className="min-h-screen bg-[#050810] relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(0,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      <div className="fixed top-20 left-20 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
      <div className="fixed bottom-20 right-20 w-96 h-96 bg-teal-500/5 rounded-full blur-3xl" />

      <div className="relative z-10 p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors mb-4"
          >
            <ArrowLeft size={20} />
            Back to Admin Terminal
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-500 flex items-center gap-3">
                <CreditCard size={40} /> Dev Tier Analytics
              </h1>
              <p className="text-slate-500 text-sm mt-2">Manage subscriptions and view user analytics</p>
            </div>
            <button
              onClick={fetchSubscriptions}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white rounded-lg font-bold transition-colors"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="p-6 rounded-xl border-2 border-green-500/30 bg-green-500/5 backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="text-green-400" size={24} />
              <div className="text-2xl font-black text-green-400">{getActiveCount()}</div>
            </div>
            <div className="text-sm text-slate-400">Active Subscriptions</div>
          </div>

          <div className="p-6 rounded-xl border-2 border-red-500/30 bg-red-500/5 backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-2">
              <XCircle className="text-red-400" size={24} />
              <div className="text-2xl font-black text-red-400">{getCancelledCount()}</div>
            </div>
            <div className="text-sm text-slate-400">Cancelled Subscriptions</div>
          </div>

          <div className="p-6 rounded-xl border-2 border-emerald-500/30 bg-emerald-500/5 backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-2">
              <DollarSign className="text-emerald-400" size={24} />
              <div className="text-2xl font-black text-emerald-400">{formatCurrency(getTotalRevenue())}</div>
            </div>
            <div className="text-sm text-slate-400">Total Revenue (Initial Payments)</div>
          </div>
        </div>

        {/* Manual Grant Access */}
        <div className="mb-6 p-5 rounded-xl border border-cyan-500/30 bg-cyan-500/5">
          <div className="flex items-center gap-2 mb-3">
            <UserPlus size={16} className="text-cyan-400" />
            <h2 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">Manually Grant Dev Tier Access</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">Use this to fix customers who paid but didn't receive access. Enter their account email exactly as they registered.</p>

          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[220px]">
              <label className="text-xs text-slate-400 mb-1 block">User Email</label>
              <input
                type="email"
                value={grantEmail}
                onChange={e => setGrantEmail(e.target.value)}
                placeholder="customer@email.com"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Plan</label>
              <select
                value={grantCycle}
                onChange={e => setGrantCycle(e.target.value)}
                className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-cyan-500"
              >
                <option value="biweekly">Biweekly ($20 · 250 tickets)</option>
                <option value="monthly">Monthly ($40 · 500 tickets)</option>
                <option value="yearly">Yearly ($480 · 6000 tickets)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">End Date <span className="text-slate-600">(optional)</span></label>
              <input
                type="datetime-local"
                value={grantEndDate}
                onChange={e => setGrantEndDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <input
                type="checkbox"
                id="grantTickets"
                checked={grantTickets}
                onChange={e => setGrantTickets(e.target.checked)}
                className="w-4 h-4 accent-cyan-500"
              />
              <label htmlFor="grantTickets" className="text-xs text-slate-300 cursor-pointer">Deliver initial tickets</label>
            </div>
            <button
              onClick={grantAccess}
              disabled={granting || !grantEmail.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-900 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
            >
              <UserPlus size={14} />
              {granting ? 'Granting...' : 'Grant Access'}
            </button>
          </div>

          {grantResult && (
            <div className={`mt-3 px-4 py-2 rounded-lg text-sm font-medium ${grantResult.success ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
              {grantResult.success ? '✓' : '✗'} {grantResult.message}
            </div>
          )}
        </div>

        {/* Duplicate Subscriptions Banner */}
        {duplicateCount !== null && duplicateCount > 0 && (
          <div className="mb-6 p-5 rounded-xl border border-yellow-500/40 bg-yellow-500/5">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={16} className="text-yellow-400" />
                  <h2 className="text-sm font-bold text-yellow-400 uppercase tracking-wider">
                    {duplicateCount} User{duplicateCount > 1 ? 's' : ''} with Duplicate Subscriptions
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  Auto-resolve removes expired/cancelled duplicates. Force-resolve handles cases where both records still have active access — keeps the newer one.
                </p>
                {/* Show which users are affected and whether they can be auto-resolved */}
                <div className="flex flex-wrap gap-2 mb-2">
                  {duplicateDetails.map(d => (
                    <span key={d.email} className={`text-[11px] px-2 py-0.5 rounded-full font-mono border ${
                      d.canAutoResolve
                        ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                        : 'bg-red-500/10 border-red-500/30 text-red-400'
                    }`}>
                      {d.email} ({d.count} records){!d.canAutoResolve && ' · needs force'}
                    </span>
                  ))}
                </div>
                {resolveResult && (
                  <p className="text-xs text-green-400 font-medium">
                    ✓ Resolved {resolveResult.count} record{resolveResult.count !== 1 ? 's' : ''}.
                    {resolveResult.deleted.map(d => ` ${d.email}`).join(',')}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => resolveDuplicates(false)}
                  disabled={resolvingDuplicates}
                  className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-900 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
                >
                  <RefreshCw size={14} className={resolvingDuplicates ? 'animate-spin' : ''} />
                  {resolvingDuplicates ? 'Resolving...' : 'Auto-Resolve'}
                </button>
                {duplicateDetails.some(d => !d.canAutoResolve) && (
                  <button
                    onClick={() => resolveDuplicates(true)}
                    disabled={resolvingDuplicates}
                    className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-red-900 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
                    title="Keeps the newer record, retires the older one (preserves history)"
                  >
                    <AlertTriangle size={14} />
                    Force Resolve
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* LemonSqueezy Sync Tool */}
        <div className="mb-8 p-5 rounded-xl border border-orange-500/30 bg-orange-500/5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-bold text-orange-400 uppercase tracking-wider mb-1">Bidirectional LemonSqueezy Sync</h2>
              <p className="text-xs text-slate-500">Pulls LS cancellations into DB · Updates renewal dates · Pushes our cancellations to LS. Manual admin overrides are preserved unless the user acts on LS after.</p>
            </div>
            <button
              onClick={syncLsCancellations}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-orange-900 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>

          {syncResult && (
            <div className="mt-4 pt-4 border-t border-orange-500/20">
              <div className="flex items-center gap-4 mb-3 flex-wrap">
                {syncResult.discovered > 0 && <span className="text-sm text-cyan-400 font-bold">★ {syncResult.discovered} recovered (missed webhooks)</span>}
                <span className="text-sm text-green-400 font-bold">✓ {syncResult.synced} synced</span>
                {syncResult.skipped > 0 && <span className="text-sm text-yellow-400 font-bold">⊘ {syncResult.skipped} skipped (manual override)</span>}
                {syncResult.failed > 0 && <span className="text-sm text-red-400 font-bold">✗ {syncResult.failed} failed</span>}
                {syncResult.discovered === 0 && syncResult.synced === 0 && syncResult.failed === 0 && syncResult.skipped === 0 && (
                  <span className="text-sm text-slate-400">Nothing to sync.</span>
                )}
              </div>
              {syncResult.results.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {syncResult.results.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs font-mono flex-wrap">
                      <span className={r.status === 'discovered' ? 'text-cyan-400' : r.status === 'synced' ? 'text-green-400' : r.status === 'skipped' ? 'text-yellow-400' : 'text-red-400'}>
                        {r.status === 'discovered' ? '★' : r.status === 'synced' ? '✓' : r.status === 'skipped' ? '⊘' : '✗'}
                      </span>
                      <span className="text-slate-400">{r.email}</span>
                      <span className="text-slate-600">{r.action}</span>
                      {r.error && <span className="text-red-400">{r.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-emerald-500 mx-auto mb-4" />
            <p className="text-slate-400">Loading subscriptions...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="p-6 rounded-xl border-2 border-red-500/30 bg-red-500/5 backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-2">
              <AlertCircle className="text-red-400" size={24} />
              <h3 className="text-lg font-bold text-red-400">Error Loading Subscriptions</h3>
            </div>
            <p className="text-slate-400 text-sm">{error}</p>
          </div>
        )}

        {/* Search */}
        {!loading && !error && subscriptions.length > 0 && (
          <div className="mb-4 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by email..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-500 placeholder-slate-600"
            />
          </div>
        )}

        {/* Subscriptions Table */}
        {!loading && !error && subscriptions.length === 0 && (
          <div className="p-12 text-center rounded-xl border-2 border-slate-700 bg-slate-900/60 backdrop-blur-sm">
            <CreditCard className="mx-auto text-slate-600 mb-4" size={48} />
            <h3 className="text-xl font-bold text-slate-400 mb-2">No Subscriptions Yet</h3>
            <p className="text-slate-500 text-sm">Dev Tier subscriptions will appear here once users subscribe.</p>
          </div>
        )}

        {!loading && !error && subscriptions.length > 0 && (
          <div className="space-y-4">
            {(() => {
              // Detect users with multiple subscription records
              const userSubCounts: Record<number, number> = {}
              subscriptions.forEach(s => { userSubCounts[s.userId] = (userSubCounts[s.userId] || 0) + 1 })

              return subscriptions
                .filter(sub => !searchQuery || sub.user.email.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((sub) => {
                  const isDuplicate = userSubCounts[sub.userId] > 1
                  const subState = getSubState(sub)
                  const cardBorder =
                    subState === 'active-renewing'  ? 'border-green-700/60 hover:border-green-600/60' :
                    subState === 'active-cancelled' ? 'border-amber-700/60 hover:border-amber-600/60' :
                    subState === 'cancelled-expired'? 'border-red-900/60 hover:border-red-800/60' :
                    'border-slate-700 hover:border-slate-600'
                  return <div
                key={sub.id}
                className={`p-6 rounded-xl border-2 bg-slate-900/60 backdrop-blur-sm transition-all ${cardBorder}`}
              >
                {/* User Info Header */}
                <div className="flex items-start justify-between mb-4 pb-4 border-b border-slate-700">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <User className="text-cyan-400" size={20} />
                      <h3 className="text-lg font-bold text-white">
                        {sub.user.name || 'Unknown User'}
                      </h3>
                      {getStatusBadge(sub)}
                      {isDuplicate && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-bold border border-yellow-500/40">
                          <AlertTriangle size={11} /> DUPLICATE SUB
                        </span>
                      )}
                      {(() => {
                        const disc = getDiscountInfo(sub)
                        if (!disc) return null
                        // Dev Tier discount unified at 10% for all members (2026-07-29)
                        return (
                          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold border border-purple-500/40">
                            10% OFF
                          </span>
                        )
                      })()}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400 mb-1">
                      <Mail size={14} />
                      {sub.user.email}
                    </div>
                    <div className="text-xs text-slate-500 mb-3">
                      User ID: {sub.userId} • Subscription ID: {sub.id}
                    </div>

                    {/* Transaction Summary */}
                    {sub.transactions && sub.transactions.length > 0 && (
                      <div className="flex gap-4 mt-3">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30">
                          <DollarSign size={14} className="text-green-400" />
                          <div>
                            <div className="text-xs text-slate-500">Total Paid</div>
                            <div className="text-sm font-bold text-green-400">
                              {formatCurrency(
                                sub.transactions.filter(tx => tx.type === 'ticket_distribution').length
                                * (sub.billingAmount || 0)
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
                          <CreditCard size={14} className="text-blue-400" />
                          <div>
                            <div className="text-xs text-slate-500">Total Tickets</div>
                            <div className="text-sm font-bold text-blue-400">
                              {sub.transactions
                                .filter(tx => tx.type === 'ticket_distribution')
                                .reduce((sum, tx) => sum + (tx.ticketsAdded || 0), 0)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/30">
                          <Calendar size={14} className="text-purple-400" />
                          <div>
                            <div className="text-xs text-slate-500">Transactions</div>
                            <div className="text-sm font-bold text-purple-400">
                              {sub.transactions.length}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-2 items-end">

                    {/* Row 1: status-specific actions */}
                    <div className="flex gap-2 flex-wrap justify-end">
                      {/* Give Tickets — all cards */}
                      <button
                        onClick={() => distributeTickets(sub.id, sub.user.email)}
                        disabled={processingId === sub.id}
                        className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
                        title="Manually distribute tickets"
                      >
                        <Gift size={15} />
                        Give Tickets
                      </button>

                      {/* Revoke Tickets — all cards */}
                      <button
                        onClick={() => revokeTickets(sub.id, sub.user.email)}
                        disabled={processingId === sub.id}
                        className="flex items-center gap-2 px-3 py-1.5 bg-rose-700 hover:bg-rose-600 disabled:bg-rose-900 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
                        title="Deduct tickets from user"
                      >
                        <MinusCircle size={15} />
                        Revoke Tickets
                      </button>

                      {/* Sync LS — only if has lsSubscriptionId */}
                      {sub.lsSubscriptionId && (
                        <button
                          onClick={() => syncSingle(sub.id)}
                          disabled={syncingSubId === sub.id}
                          className="flex items-center gap-2 px-3 py-1.5 bg-orange-700 hover:bg-orange-600 disabled:bg-orange-900 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
                          title="Force-sync this subscription from LemonSqueezy"
                        >
                          <CloudLightning size={15} className={syncingSubId === sub.id ? 'animate-pulse' : ''} />
                          {syncingSubId === sub.id ? 'Syncing…' : 'Sync LS'}
                        </button>
                      )}

                      {/* Has access (renewing or cancelled-but-within-period) */}
                      {(subState === 'active-renewing' || subState === 'active-cancelled') && (
                        <>
                          {subState === 'active-renewing' && (
                            <button
                              onClick={() => toggleAutoRenew(sub.id, sub.autoRenew)}
                              disabled={processingId === sub.id}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-sm transition-all ${
                                sub.autoRenew
                                  ? 'bg-green-600 hover:bg-green-500 text-white'
                                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              {sub.autoRenew ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                              {processingId === sub.id ? 'Processing...' : sub.autoRenew ? 'Auto-Renew ON' : 'Auto-Renew OFF'}
                            </button>
                          )}

                          <button
                            onClick={() => revokeAccess(sub.id, sub.user.email)}
                            disabled={processingId === sub.id}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
                          >
                            <Trash2 size={15} />
                            Revoke Access
                          </button>
                        </>
                      )}

                      {/* No access: Grant Access + Delete Record */}
                      {(subState === 'cancelled-expired' || subState === 'expired' || subState === 'other') && (
                        <>
                          <button
                            onClick={() => cardGrantId === sub.id ? setCardGrantId(null) : openCardGrant(sub.id)}
                            disabled={cardGranting}
                            className="flex items-center gap-2 px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:bg-cyan-900 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
                          >
                            <ShieldCheck size={15} />
                            Grant Access
                          </button>
                          <button
                            onClick={() => deleteRecord(sub.id, sub.user.email)}
                            disabled={processingId === sub.id}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 hover:text-white rounded-lg font-bold text-sm transition-colors"
                            title="Permanently delete this subscription record"
                          >
                            <Trash2 size={15} />
                            Delete Record
                          </button>
                        </>
                      )}
                    </div>

                    {/* Per-card sync result */}
                    {syncSingleResults[sub.id] && (
                      <div className={`text-xs px-3 py-1.5 rounded-lg font-mono ${syncSingleResults[sub.id].success ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                        {syncSingleResults[sub.id].success ? '✓' : '✗'} {syncSingleResults[sub.id].message}
                      </div>
                    )}

                    {/* Inline Grant Access form */}
                    {cardGrantId === sub.id && (
                      <div className="mt-2 p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5 w-full max-w-md">
                        <p className="text-xs font-bold text-cyan-400 mb-3 uppercase tracking-wider">Grant Dev Tier Access</p>
                        <div className="flex flex-wrap gap-2 items-end">
                          <div>
                            <label className="text-xs text-slate-400 mb-1 block">Plan</label>
                            <select
                              value={cardGrantCycle}
                              onChange={e => { setCardGrantCycle(e.target.value); setCardGrantEndDate(calcEndDateLocal(e.target.value)) }}
                              className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-cyan-500"
                            >
                              <option value="biweekly">Biweekly · 250 tickets</option>
                              <option value="monthly">Monthly · 500 tickets</option>
                              <option value="yearly">Yearly · 6000 tickets</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-slate-400 mb-1 block">End Date</label>
                            <input
                              type="datetime-local"
                              value={cardGrantEndDate}
                              onChange={e => setCardGrantEndDate(e.target.value)}
                              className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-cyan-500"
                            />
                          </div>
                          <div className="flex items-center gap-2 pb-1">
                            <input
                              type="checkbox"
                              id={`cardTickets-${sub.id}`}
                              checked={cardGrantTickets}
                              onChange={e => setCardGrantTickets(e.target.checked)}
                              className="w-4 h-4 accent-cyan-500"
                            />
                            <label htmlFor={`cardTickets-${sub.id}`} className="text-xs text-slate-300 cursor-pointer">Deliver tickets</label>
                          </div>
                          <button
                            onClick={() => grantAccessByCard(sub.id)}
                            disabled={cardGranting}
                            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-900 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors"
                          >
                            <UserPlus size={14} />
                            {cardGranting ? 'Granting...' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setCardGrantId(null)}
                            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm font-bold transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Set End Date — available for all subscriptions */}
                    {editingEndDateId === sub.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="datetime-local"
                          value={editEndDateValue}
                          onChange={e => setEditEndDateValue(e.target.value)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-500 text-white text-sm focus:outline-none focus:border-cyan-500"
                        />
                        <button
                          onClick={() => saveEndDate(sub.id)}
                          disabled={savingEndDate}
                          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-900 text-white rounded-lg text-sm font-bold transition-colors"
                        >
                          {savingEndDate ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditingEndDateId(null); setEditEndDateValue('') }}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm font-bold transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingEndDateId(sub.id)
                          // Pre-fill with current end date if set
                          if (sub.endDate) {
                            const d = new Date(sub.endDate)
                            const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                              .toISOString().slice(0, 16)
                            setEditEndDateValue(local)
                          } else {
                            setEditEndDateValue('')
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg text-sm font-bold transition-colors"
                      >
                        <CalendarClock size={14} />
                        {sub.endDate ? 'Change End Date' : 'Set End Date'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Subscription Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Billing Amount */}
                  <div className="p-4 rounded-lg bg-slate-800/50">
                    <div className="text-xs text-slate-500 mb-1">Billing Amount</div>
                    <div className="text-lg font-bold text-emerald-400">
                      {formatCurrency(sub.billingAmount)}
                      {sub.billingCycle && <span className="text-xs text-slate-400 ml-1">/ {sub.billingCycle}</span>}
                    </div>
                  </div>

                  {/* Start Date */}
                  <div className="p-4 rounded-lg bg-slate-800/50">
                    <div className="text-xs text-slate-500 mb-1">Start Date</div>
                    <div className="text-sm font-bold text-white">{formatDate(sub.startDate)}</div>
                  </div>

                  {/* Next Billing */}
                  <div className="p-4 rounded-lg bg-slate-800/50">
                    <div className="text-xs text-slate-500 mb-1">Next Billing</div>
                    <div className="text-sm font-bold text-white">{formatDate(sub.nextBillingDate)}</div>
                  </div>

                  {/* End Date */}
                  <div className="p-4 rounded-lg bg-slate-800/50">
                    <div className="text-xs text-slate-500 mb-1">End Date</div>
                    <div className="text-sm font-bold text-white">{formatDate(sub.endDate)}</div>
                  </div>

                  {/* LemonSqueezy Subscription ID */}
                  <div className={`p-4 rounded-lg ${sub.lsSubscriptionId ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-slate-800/50'}`}>
                    <div className="text-xs text-slate-500 mb-1">LemonSqueezy Sub ID</div>
                    <div className="text-xs font-mono text-emerald-400 truncate" title={sub.lsSubscriptionId || 'N/A'}>
                      {sub.lsSubscriptionId || 'N/A'}
                    </div>
                  </div>

                  {/* PayPal Subscription ID */}
                  <div className="p-4 rounded-lg bg-slate-800/50">
                    <div className="text-xs text-slate-500 mb-1">PayPal Subscription ID</div>
                    <div className="text-xs font-mono text-cyan-400 truncate" title={sub.paypalSubscriptionId || 'N/A'}>
                      {sub.paypalSubscriptionId || 'N/A'}
                    </div>
                  </div>

                  {/* PayPal Order ID */}
                  <div className="p-4 rounded-lg bg-slate-800/50">
                    <div className="text-xs text-slate-500 mb-1">PayPal Order ID</div>
                    <div className="text-xs font-mono text-cyan-400 truncate" title={sub.paypalOrderId || 'N/A'}>
                      {sub.paypalOrderId || 'N/A'}
                    </div>
                  </div>

                  {/* Created At */}
                  <div className="p-4 rounded-lg bg-slate-800/50">
                    <div className="text-xs text-slate-500 mb-1">Created At</div>
                    <div className="text-sm font-bold text-white">{formatDate(sub.createdAt)}</div>
                  </div>

                  {/* Cancelled At */}
                  {sub.cancelledAt && (
                    <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                      <div className="text-xs text-red-500 mb-1">Cancelled At</div>
                      <div className="text-sm font-bold text-red-400">{formatDate(sub.cancelledAt)}</div>
                    </div>
                  )}
                </div>

                {/* Metadata */}
                {sub.metadata && (
                  <div className="mt-4 p-4 rounded-lg bg-slate-800/30 border border-slate-700">
                    <div className="text-xs text-slate-500 mb-2">Plan Metadata</div>
                    <pre className="text-xs text-slate-300 font-mono overflow-x-auto">
                      {JSON.stringify(sub.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Transaction History */}
                {sub.transactions && sub.transactions.length > 0 && (
                  <div className="mt-6 p-6 rounded-lg bg-slate-800/50 border-2 border-emerald-500/30">
                    <h4 className="text-lg font-bold text-emerald-400 mb-4 flex items-center gap-2">
                      <Calendar size={20} />
                      Transaction History ({sub.transactions.length})
                    </h4>
                    <div className="space-y-3">
                      {sub.transactions.map((tx) => (
                        <div
                          key={tx.id}
                          className={`p-4 rounded-lg border-2 ${
                            tx.type === 'payment'
                              ? 'bg-green-500/5 border-green-500/30'
                              : 'bg-blue-500/5 border-blue-500/30'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                {tx.type === 'payment' ? (
                                  <DollarSign className="text-green-400" size={18} />
                                ) : (
                                  <CreditCard className="text-blue-400" size={18} />
                                )}
                                <span className={`text-sm font-bold ${
                                  tx.type === 'payment' ? 'text-green-400' : 'text-blue-400'
                                }`}>
                                  {tx.type === 'payment' ? 'PAYMENT RECEIVED' : 'TICKETS DISTRIBUTED'}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {formatDate(tx.createdAt)}
                                </span>
                              </div>
                              {tx.description && (
                                <p className="text-sm text-slate-300 mb-2">{tx.description}</p>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {tx.type === 'payment' ? (
                              <>
                                <div className="p-3 rounded bg-slate-900/50">
                                  <div className="text-xs text-slate-500 mb-1">Amount</div>
                                  <div className="text-lg font-bold text-green-400">
                                    {formatCurrency(tx.amount)}
                                  </div>
                                </div>
                                {tx.paypalTransactionId && (
                                  <div className="p-3 rounded bg-slate-900/50 col-span-3">
                                    <div className="text-xs text-slate-500 mb-1">PayPal Transaction ID</div>
                                    <div className="text-xs font-mono text-cyan-400 truncate" title={tx.paypalTransactionId}>
                                      {tx.paypalTransactionId}
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="p-3 rounded bg-slate-900/50">
                                  <div className="text-xs text-slate-500 mb-1">Tickets Added</div>
                                  <div className="text-lg font-bold text-blue-400">
                                    +{tx.ticketsAdded}
                                  </div>
                                </div>
                                <div className="p-3 rounded bg-slate-900/50">
                                  <div className="text-xs text-slate-500 mb-1">Previous Balance</div>
                                  <div className="text-sm font-bold text-slate-400">
                                    {tx.previousBalance !== null ? tx.previousBalance : 'N/A'}
                                  </div>
                                </div>
                                <div className="p-3 rounded bg-slate-900/50">
                                  <div className="text-xs text-slate-500 mb-1">New Balance</div>
                                  <div className="text-sm font-bold text-emerald-400">
                                    {tx.newBalance !== null ? tx.newBalance : 'N/A'}
                                  </div>
                                </div>
                                <div className="p-3 rounded bg-slate-900/50">
                                  <div className="text-xs text-slate-500 mb-1">Change</div>
                                  <div className="text-sm font-bold text-blue-400">
                                    {tx.previousBalance !== null && tx.newBalance !== null
                                      ? `+${tx.newBalance - tx.previousBalance}`
                                      : 'N/A'}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>

                          {tx.metadata && (
                            <div className="mt-3 p-3 rounded bg-slate-900/30 border border-slate-700">
                              <div className="text-xs text-slate-500 mb-1">Transaction Metadata</div>
                              <pre className="text-xs text-slate-400 font-mono overflow-x-auto">
                                {JSON.stringify(tx.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No Transactions */}
                {(!sub.transactions || sub.transactions.length === 0) && (
                  <div className="mt-6 p-6 rounded-lg bg-slate-800/30 border border-slate-700 text-center">
                    <Calendar className="mx-auto text-slate-600 mb-2" size={32} />
                    <p className="text-sm text-slate-500">No transaction history yet</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Payment and ticket distribution records will appear here
                    </p>
                  </div>
                )}
              </div>
          })})()}
          </div>
        )}
      </div>
    </div>
  )
}
