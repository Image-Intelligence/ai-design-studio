'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageSquare, Send, CheckCircle, Bug, Lightbulb, Clock, Inbox } from 'lucide-react';
import { SitePageHeader, SiteBrandHero } from '@/components/SitePageHeader';

interface MyFeedback {
  id: number
  type: string
  subject: string
  message: string
  status: string
  adminNotes: string | null
  createdAt: string
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    bug: 'bg-red-500/10 text-red-300 border-red-500/25',
    request: 'bg-white/[0.06] text-slate-200 border-white/15',
    feedback: 'bg-white/[0.06] text-slate-200 border-white/15',
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
    pending: 'bg-white/[0.06] text-slate-400 border border-white/10',
    reviewed: 'bg-amber-500/10 text-amber-300 border border-amber-500/25',
    resolved: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] ?? styles.pending}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  })
}

export default function FeedbackPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [activeTab, setActiveTab] = useState<'submit' | 'my'>('submit');

  // My submissions state
  const [myFeedbacks, setMyFeedbacks] = useState<MyFeedback[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [myLoaded, setMyLoaded] = useState(false);

  const [formData, setFormData] = useState({
    type: 'feedback',
    subject: '',
    message: '',
  });

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/session');
        const data = await res.json();

        if (!data.authenticated) {
          router.push('/');
          return;
        }

        setUser(data.user);
      } catch (err) {
        router.push('/');
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, [router]);

  const fetchMyFeedbacks = async () => {
    setMyLoading(true);
    try {
      const res = await fetch('/api/feedback/my');
      const data = await res.json();
      if (data.success) {
        setMyFeedbacks(data.feedbacks);
      }
    } catch {
      // silent
    } finally {
      setMyLoading(false);
      setMyLoaded(true);
    }
  };

  const handleTabChange = (tab: 'submit' | 'my') => {
    setActiveTab(tab);
    if (tab === 'my' && !myLoaded) {
      fetchMyFeedbacks();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.subject.trim() || !formData.message.trim()) {
      alert('Please fill in all fields');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          userEmail: user?.email,
          type: formData.type,
          subject: formData.subject,
          message: formData.message,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSubmitted(true);
        setFormData({ type: 'feedback', subject: '', message: '' });
        // Invalidate cached submissions so next view is fresh
        setMyLoaded(false);
      } else {
        alert('Failed to submit feedback: ' + data.error);
      }
    } catch (error) {
      alert('Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-slate-700 border-t-white animate-spin" />
      </div>
    );
  }

  const typeCards = [
    { value: 'feedback', label: 'Feedback', icon: MessageSquare },
    { value: 'request', label: 'Feature Request', icon: Lightbulb },
    { value: 'bug', label: 'Bug Report', icon: Bug },
  ]

  return (
    <div className="min-h-screen bg-[#050810] text-slate-100 flex flex-col">
      <SitePageHeader />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-10 flex flex-col gap-8">
        <SiteBrandHero />

        <div>
          <h1 className="text-center text-lg font-bold text-white uppercase tracking-[0.2em] mb-1">Feedback &amp; Requests</h1>
          <p className="text-center text-sm text-slate-500">Share your thoughts, report bugs, or request features.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/10 w-fit mx-auto">
          <button
            onClick={() => handleTabChange('submit')}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'submit'
                ? 'bg-white text-black shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Send size={13} className="inline mr-1.5 -mt-0.5" />
            Submit Feedback
          </button>
          <button
            onClick={() => handleTabChange('my')}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'my'
                ? 'bg-white text-black shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Inbox size={13} className="inline mr-1.5 -mt-0.5" />
            My Submissions
          </button>
        </div>

        {/* ── SUBMIT TAB ── */}
        {activeTab === 'submit' && (
          <>
            {submitted ? (
              <div className="p-8 rounded-xl border border-emerald-500/25 bg-white/[0.03] text-center">
                <CheckCircle size={48} className="mx-auto text-emerald-300 mb-4" />
                <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2">Thank You</h2>
                <p className="text-sm text-slate-400 mb-6">
                  Your feedback has been submitted successfully. We appreciate you taking the time to help us improve.
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                  <Button
                    onClick={() => setSubmitted(false)}
                    className="bg-white text-black font-bold hover:bg-slate-200"
                  >
                    Submit Another
                  </Button>
                  <Button
                    onClick={() => handleTabChange('my')}
                    className="bg-white/[0.06] border border-white/15 text-slate-200 hover:bg-white/10 hover:text-white"
                  >
                    View My Submissions
                  </Button>
                  <Button
                    onClick={() => router.push('/dashboard')}
                    className="bg-white/[0.06] border border-white/15 text-slate-200 hover:bg-white/10 hover:text-white"
                  >
                    Back to Dashboard
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-5 sm:p-6 rounded-xl border border-white/10 bg-white/[0.03]">
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Type Selection */}
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Type</label>
                    <div className="grid grid-cols-3 gap-3">
                      {typeCards.map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setFormData({ ...formData, type: value })}
                          className={`p-4 rounded-xl border transition-all ${
                            formData.type === value
                              ? 'border-white/40 bg-white/[0.08]'
                              : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                          }`}
                        >
                          <Icon size={22} className={`mx-auto mb-2 ${formData.type === value ? 'text-white' : 'text-slate-500'}`} />
                          <span className={`text-xs font-bold ${formData.type === value ? 'text-white' : 'text-slate-400'}`}>
                            {label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Subject</label>
                    <Input
                      value={formData.subject}
                      onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                      placeholder="Brief summary of your feedback..."
                      required
                      className="bg-slate-950 border-white/10 text-white focus-visible:ring-white/20"
                    />
                  </div>

                  {/* Message */}
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Message</label>
                    <textarea
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      placeholder="Describe your feedback, request, or bug in detail..."
                      required
                      rows={6}
                      className="w-full px-4 py-3 bg-slate-950 border border-white/10 rounded-lg text-white placeholder-slate-600 focus:border-white/25 focus:outline-none resize-none text-sm"
                    />
                  </div>

                  {/* User Info */}
                  <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10">
                    <p className="text-xs text-slate-500">
                      Submitting as: <span className="text-slate-200 font-medium">{user?.email}</span>
                    </p>
                  </div>

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-white text-black font-bold hover:bg-slate-200 h-12"
                  >
                    {submitting ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent mr-2" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Send size={18} className="mr-2" />
                        Submit Feedback
                      </>
                    )}
                  </Button>
                </form>
              </div>
            )}

            {/* Info Card */}
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">What happens next?</h3>
              <ul className="text-xs text-slate-400 space-y-1">
                <li>Your feedback will be reviewed by our team</li>
                <li>Bug reports are prioritized for quick fixes</li>
                <li>Feature requests help shape our roadmap</li>
                <li>We read every submission — thank you for your input!</li>
              </ul>
            </div>
          </>
        )}

        {/* ── MY SUBMISSIONS TAB ── */}
        {activeTab === 'my' && (
          <div>
            {myLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-8 h-8 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-500 text-sm">Loading your submissions…</p>
              </div>
            ) : myFeedbacks.length === 0 ? (
              <div className="p-12 rounded-xl border border-white/10 bg-white/[0.03] text-center">
                <Inbox size={48} className="mx-auto text-slate-700 mb-3" />
                <p className="text-slate-300 font-medium mb-1">No submissions yet</p>
                <p className="text-sm text-slate-500">Your submitted feedback and requests will appear here.</p>
                <Button
                  onClick={() => setActiveTab('submit')}
                  className="mt-5 bg-white text-black font-bold hover:bg-slate-200 text-sm"
                >
                  Submit your first feedback
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {myFeedbacks.map(fb => (
                  <div
                    key={fb.id}
                    className="p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:border-white/20 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <TypeBadge type={fb.type} />
                      <StatusBadge status={fb.status} />
                      <span className="text-xs text-slate-500 flex items-center gap-1 ml-auto">
                        <Clock size={11} />
                        {formatDate(fb.createdAt)}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-white mb-1">{fb.subject}</h3>

                    <p className="text-sm text-slate-400 leading-relaxed line-clamp-2">{fb.message}</p>

                    {fb.adminNotes && (
                      <div className="mt-3 px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/15">
                        <p className="text-xs font-semibold text-white mb-1">Response from the team:</p>
                        <p className="text-sm text-slate-300 leading-relaxed">{fb.adminNotes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-center text-xs text-slate-600">
          © {new Date().getFullYear()} Prompt &amp; Protocol LLC · Orlando, Florida, USA
        </p>
      </main>
    </div>
  );
}
