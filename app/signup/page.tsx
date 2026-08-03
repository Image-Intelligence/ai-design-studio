"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'
import { SiteBrandHero } from '@/components/SitePageHeader'

const inputCls =
  "w-full px-3.5 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/30 focus:bg-black/40 transition-all"
const labelCls = "block text-[10px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-1.5"

export default function SignupPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [tosAgreed, setTosAgreed] = useState(false)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (!formData.email || !formData.password) {
      setError('Email and password are required')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (!tosAgreed || !ageConfirmed) {
      setError('You must agree to the Terms and certify that you are 18 years of age or older')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          name: formData.name,
          tosAgreed,
          ageConfirmed,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        // Success! Redirect to dashboard
        router.push('/dashboard')
      } else {
        setError(data.error || 'Signup failed')
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
              <h1 className="text-sm font-bold text-white tracking-tight">Create your account</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">Join the studio and start creating.</p>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-[12px]">
                {error}
              </div>
            )}

            <div>
              <label className={labelCls}>Name <span className="text-slate-700 normal-case tracking-normal">(optional)</span></label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Your name"
                className={inputCls}
                autoComplete="name"
              />
            </div>

            <div>
              <label className={labelCls}>Email <span className="text-slate-400">*</span></label>
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
              <label className={labelCls}>Password <span className="text-slate-400">*</span></label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  className={`${inputCls} pr-10`}
                  autoComplete="new-password"
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
              <p className="text-[10.5px] text-slate-600 mt-1.5 leading-relaxed">
                8+ characters with uppercase, lowercase, and a number.
              </p>
            </div>

            <div>
              <label className={labelCls}>Confirm Password <span className="text-slate-400">*</span></label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                placeholder="••••••••"
                className={inputCls}
                autoComplete="new-password"
                required
              />
            </div>

            {/* Agreements */}
            <div className="rounded-xl bg-black/20 border border-white/[0.06] p-3 space-y-2.5">
              <label className="flex items-start gap-2.5 text-[11.5px] text-slate-400 leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={tosAgreed}
                  onChange={(e) => setTosAgreed(e.target.checked)}
                  className="mt-0.5 accent-white"
                />
                <span>
                  I agree to the{' '}
                  <Link href="/terms" className="text-white hover:underline">Terms of Service</Link>{' '}
                  and{' '}
                  <Link href="/privacy" className="text-white hover:underline">Privacy Policy</Link>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-[11.5px] text-slate-400 leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={ageConfirmed}
                  onChange={(e) => setAgeConfirmed(e.target.checked)}
                  className="mt-0.5 accent-white"
                />
                <span>I certify that I am at least 18 years of age</span>
              </label>
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
              {loading ? 'Creating account…' : 'Create Account'} {!loading && <ArrowRight size={14} />}
            </button>

            <p className="text-center text-[12px] text-slate-500">
              Already have an account?{' '}
              <Link href="/login" className="text-white font-semibold hover:underline">
                Sign in
              </Link>
            </p>
          </form>

          {/* Footer links */}
          <div className="text-center mt-6 space-y-1.5">
            <Link href="/" className="block text-[12px] text-slate-600 hover:text-white transition-colors">
              ← Back to home
            </Link>
            <Link href="/report" className="block text-[11px] text-slate-700 hover:text-white transition-colors">
              Report Content
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
