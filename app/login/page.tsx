"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'
import { SiteBrandHero } from '@/components/SitePageHeader'

const inputCls =
  "w-full px-3.5 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/30 focus:bg-black/40 transition-all"
const labelCls = "block text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-1.5"

export default function LoginPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!formData.email || !formData.password) {
      setError('Email and password are required')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await res.json()

      if (res.ok) {
        // Success! Redirect to dashboard
        router.push('/dashboard')
      } else {
        setError(data.error || 'Login failed')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#050810] text-white flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* Brand hero — synced logo in the silver rim + wordmark */}
          <SiteBrandHero />

          {/* Card */}
          <form
            onSubmit={handleSubmit}
            className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 sm:p-6 space-y-4"
          >
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight">Sign in</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">Welcome back — sign in to continue creating.</p>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-[12px]">
                {error}
              </div>
            )}

            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="you@example.com"
                className={inputCls}
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className={labelCls}>Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  className={`${inputCls} pr-10`}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="text-right mt-1.5">
                <Link href="/forgot-password" className="text-[11px] text-slate-500 hover:text-white transition-colors">
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="relative overflow-hidden w-full py-2.5 rounded-xl bg-white/10 border border-white/25 text-white text-sm font-bold hover:bg-white/15 hover:border-white/40 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <span
                className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none"
                style={{ animation: "sheen-sweep 2.6s infinite" }}
              />
              {loading ? 'Signing in…' : 'Sign In'} {!loading && <ArrowRight size={14} />}
            </button>

            <p className="text-center text-[12px] text-slate-500">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-white font-semibold hover:underline">
                Create one
              </Link>
            </p>
          </form>

          {/* Footer links */}
          <div className="text-center mt-6">
            <Link href="/" className="text-[12px] text-slate-600 hover:text-white transition-colors">
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
