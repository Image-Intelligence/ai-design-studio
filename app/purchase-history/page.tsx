"use client"

import { useState, useEffect } from "react"
import { Receipt } from "lucide-react"
import { useRouter } from "next/navigation"
import { SitePageHeader, SiteBrandHero } from "@/components/SitePageHeader"

interface Purchase {
  id: number
  type: string
  description: string
  amount: number
  date: string
  status: string
  paypalOrderId: string
}

export default function PurchaseHistoryPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [purchases, setPurchases] = useState<Purchase[]>([])

  useEffect(() => {
    checkAuthAndFetch()
  }, [])

  const checkAuthAndFetch = async () => {
    try {
      const res = await fetch('/api/auth/session')
      const data = await res.json()

      if (!data.authenticated) {
        router.push('/login')
        return
      }

      // Fetch purchase history
      const purchasesRes = await fetch('/api/purchases')
      const purchasesData = await purchasesRes.json()

      if (Array.isArray(purchasesData)) {
        setPurchases(purchasesData)
      }
    } catch (error) {
      console.error('Failed to fetch:', error)
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-slate-700 border-t-white animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#050810] text-slate-100 flex flex-col">
      <SitePageHeader />

      <main className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full px-4 py-10 gap-8">
        <SiteBrandHero />

        <div>
          <h1 className="text-center text-lg font-bold text-white uppercase tracking-[0.2em] mb-1">Purchase History</h1>
          <p className="text-center text-sm text-slate-500">Every ticket and subscription transaction on your account.</p>
        </div>

        {/* Purchase List */}
        <div className="space-y-3">
          {purchases.length === 0 ? (
            <div className="text-center py-14 border border-white/10 rounded-xl bg-white/[0.03]">
              <Receipt className="mx-auto text-slate-700 mb-4" size={48} />
              <p className="text-base font-bold text-slate-300 mb-1">No purchases yet</p>
              <p className="text-sm text-slate-600">Your ticket purchase history will appear here</p>
            </div>
          ) : (
            purchases.map((purchase) => (
              <div
                key={purchase.id}
                className="p-5 rounded-xl border border-white/10 bg-white/[0.03] hover:border-white/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="text-base font-bold text-white">
                        {purchase.description}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                        purchase.status === 'completed'
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/25'
                      }`}>
                        {purchase.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 mb-1">
                      {formatDate(purchase.date)}
                    </p>
                    <p className="text-xs text-slate-600 font-mono truncate">
                      Order ID: {purchase.paypalOrderId}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-black text-white">
                      ${purchase.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-slate-500">{purchase.type}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Summary */}
        {purchases.length > 0 && (
          <div className="p-5 rounded-xl border border-white/15 bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Total Purchases</span>
              <span className="text-xl font-black text-white">
                ${purchases.reduce((sum, p) => sum + p.amount, 0).toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-2">
              {purchases.length} transaction{purchases.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}

        <p className="text-center text-xs text-slate-600">
          © {new Date().getFullYear()} Prompt &amp; Protocol LLC · Orlando, Florida, USA
        </p>
      </main>
    </div>
  )
}
