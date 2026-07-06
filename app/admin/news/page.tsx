"use client"

// Admin news page — auth gate + the shared NewsManager component.
// The full management UI lives in components/NewsManager.tsx, shared with the
// portal-v2 News dropdown's admin modal.

import { useState, useEffect } from "react"
import { Terminal, Loader2 } from "lucide-react"
import { NewsManager } from "@/components/NewsManager"

export default function AdminNewsPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState("")
  const [authError, setAuthError] = useState("")
  const [authLoading, setAuthLoading] = useState(false)

  useEffect(() => {
    const authStatus = localStorage.getItem("multiverse-admin-auth")
    const savedPassword = sessionStorage.getItem("admin-password")
    if (authStatus === "true" && savedPassword) {
      setIsAuthenticated(true)
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError("")
    setAuthLoading(true)
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
      } else {
        setAuthError("Invalid password")
      }
    } catch {
      setAuthError("Authentication failed")
    } finally {
      setAuthLoading(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#09090f] flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-fuchsia-500/20 border border-white/10 flex items-center justify-center mx-auto mb-4">
              <Terminal size={22} className="text-cyan-400" />
            </div>
            <h1 className="text-xl font-bold text-white">Admin Access</h1>
            <p className="text-sm text-slate-500 mt-1">Authorized personnel only</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full h-11 bg-white/[0.04] border border-white/10 rounded-xl px-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 text-sm"
              autoFocus
            />
            {authError && <p className="text-xs text-red-400">{authError}</p>}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-70 flex items-center justify-center gap-2"
            >
              {authLoading && <Loader2 size={14} className="animate-spin" />}
              Authenticate
            </button>
          </form>
        </div>
      </div>
    )
  }

  return <NewsManager />
}
