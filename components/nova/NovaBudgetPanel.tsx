"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Bookmark, Check, KeyRound, Loader2, Pencil, Plus, ShieldCheck, X } from "lucide-react"
import { DEFAULT_NOVA_BUDGET, sanitizeNovaBudget, type NovaBudget, type NovaSpend } from "@/lib/nova/config"
import { BrandButton } from "@/components/employees/StudioBrand"
import type { NovaBackground, NovaNote } from "./novaApi"
import { usePersona } from "./persona"

/*
 * The user's own Nova spending limits (2026-10-18): per chat, per day, per
 * month, and how much Nova may spend in one turn before it must ask with a
 * plan. 0 means no limit. Saved to /api/nova/settings; the server enforces them.
 *
 * Also "What Nova remembers" (2026-10-19): the preferences and brand rules
 * Nova saved with its remember tool - the user can read them and remove any
 * (DELETE /api/nova/settings?note=<id>). Nova follows them in every chat.
 * Since 2026-10-21 the user can also write them here - add one, or edit one
 * in place (PUT /api/nova/settings { note } / { editNote }).
 */
const FIELDS: { key: keyof NovaBudget; label: string; help: string }[] = [
  { key: "askAbove", label: "Default run budget", help: "Where the budget in the prompt box starts: how much it may spend on one request without asking. You can change it for each run in the prompt box. Anything bigger comes to you as a plan to approve." },
  { key: "perChat", label: "Per chat", help: "The most one chat may spend in total, chat and generations together." },
  { key: "daily", label: "Per day", help: "The most that may be spent across all your chats in one day (UTC)." },
  { key: "monthly", label: "Per month", help: "The most that may be spent in one calendar month." },
]

export function NovaBudgetPanel({ budget, spend, onClose, onSave, memory, onForget, onAddNote, onEditNote, focusMemory, background, onToggleBackground }: {
  budget: NovaBudget
  spend: NovaSpend
  onClose: () => void
  onSave: (b: NovaBudget) => Promise<void>
  memory?: NovaNote[]
  onForget?: (id: string) => Promise<void>
  /** Write a note yourself / rewrite one */
  onAddNote?: (text: string) => Promise<void>
  onEditNote?: (id: string, text: string) => Promise<void>
  /** Opened from "What Nova remembers": scroll straight to it. */
  focusMemory?: boolean
  /** Background runs: a revocable API key of the user's own that lets a production carry on with the tab closed. */
  background?: NovaBackground | null
  onToggleBackground?: (on: boolean) => Promise<void>
}) {
  const { name } = usePersona()
  const [bgBusy, setBgBusy] = useState(false)
  const toggleBg = async (on: boolean) => {
    if (!onToggleBackground) return
    setBgBusy(true); setError(null)
    try { await onToggleBackground(on) } catch (e: any) { setError(String(e?.message || e)) } finally { setBgBusy(false) }
  }
  const [error, setError] = useState<string | null>(null)
  const [confirmForget, setConfirmForget] = useState<string | null>(null)
  const [forgetting, setForgetting] = useState<string | null>(null)
  const memRef = useRef<HTMLDivElement>(null)
  // A note being written, and one being edited in place
  const [newNote, setNewNote] = useState("")
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const addNote = async () => {
    const t = newNote.trim()
    if (!t || !onAddNote) return
    setAdding(true); setError(null)
    try { await onAddNote(t); setNewNote("") } catch (e: any) { setError(String(e?.message || e)) } finally { setAdding(false) }
  }
  const saveEdit = async () => {
    if (!editing || !onEditNote) return
    const t = editing.text.trim()
    if (!t) return
    setSavingEdit(true); setError(null)
    try { await onEditNote(editing.id, t); setEditing(null) } catch (e: any) { setError(String(e?.message || e)) } finally { setSavingEdit(false) }
  }
  useEffect(() => { if (focusMemory) memRef.current?.scrollIntoView({ block: "start" }) }, [focusMemory])
  const forget = async (id: string) => {
    if (!onForget) return
    setConfirmForget(null)
    setForgetting(id)
    try { await onForget(id) } catch (e: any) { setError(String(e?.message || e)) } finally { setForgetting(null) }
  }
  const [draft, setDraft] = useState<Record<keyof NovaBudget, string>>(() => ({
    perChat: String(budget.perChat), daily: String(budget.daily), monthly: String(budget.monthly), askAbove: String(budget.askAbove),
  }))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [onClose])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(sanitizeNovaBudget(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v) || 0]))))
      onClose()
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally { setSaving(false) }
  }

  if (typeof document === "undefined") return null
  return createPortal(
    <div data-prism-modal className="fixed inset-0 z-[10055] flex items-start justify-center bg-black/70 backdrop-blur-sm p-3 pt-[6dvh]" onClick={onClose}>
      <div className="w-full max-w-md max-h-[88dvh] overflow-y-auto overscroll-contain rounded-2xl silver-edge bg-[#070b14] p-4 sm:p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={16} className="text-emerald-300" />
          <p className="text-sm font-bold text-white">{name} budget</p>
          <button onClick={onClose} className="ml-auto p-1 text-slate-500 hover:text-white" aria-label="Close"><X size={16} /></button>
        </div>
        <p className="text-[11.5px] text-slate-400 leading-relaxed mb-4">
          Limits in tickets. <span className="text-slate-300">0 means no limit.</span> The per chat, day and month limits are hard stops: Nova stops and tells you when one is reached, even inside an approved plan.{name === "Prism" ? " Quick questions that come out of your free daily allowance do not count." : ""}
        </p>
        <div className="space-y-3.5">
          {FIELDS.map(f => (
            <div key={f.key}>
              <div className="flex items-center gap-3">
                <label htmlFor={`nova-b-${f.key}`} className="flex-1 text-[12.5px] font-semibold text-slate-200">{f.label}</label>
                <input id={`nova-b-${f.key}`} type="number" min={0} inputMode="numeric" value={draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  className="w-24 px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-[13px] text-white text-right tabular-nums focus:outline-none focus:border-white/30" />
                <span className="w-10 text-[11px] text-slate-500">tickets</span>
              </div>
              <p className="mt-1 text-[10.5px] text-slate-500 leading-snug">{f.help}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <p className="text-slate-500">Spent today</p>
            <p className="text-white font-bold tabular-nums">{spend.today} tickets</p>
          </div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <p className="text-slate-500">Spent this month</p>
            <p className="text-white font-bold tabular-nums">{spend.month} tickets</p>
          </div>
        </div>
        {background && onToggleBackground && (
          <div className="mt-5 pt-4 border-t border-white/[0.07]">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound size={14} className="text-sky-300" />
              <p className="text-[13px] font-bold text-white">Run in background</p>
              <button role="switch" aria-checked={background.enabled} disabled={bgBusy || !background.available}
                onClick={() => toggleBg(!background.enabled)}
                className={`ml-auto relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${background.enabled ? "bg-emerald-500/80" : "bg-white/15"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${background.enabled ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            <p className="text-[10.5px] text-slate-500 leading-snug">
              Lets a production carry on after you close the tab - {name} finishes the renders, assembles the cut and marks the chat as new.
              It works with an API key of your own (spending tickets, making images and video) that only the server holds, encrypted. Turn it off to delete the key.
            </p>
            {background.enabled && background.keyPrefix && (
              <p className="mt-1.5 text-[10.5px] text-emerald-300/80">On · key {background.keyPrefix}… since {background.since ? new Date(background.since).toLocaleDateString() : "today"}</p>
            )}
            {!background.available && <p className="mt-1.5 text-[10.5px] text-amber-300/80">Not available on this server yet.</p>}
          </div>
        )}
        {memory && (
          <div ref={memRef} className="mt-5 pt-4 border-t border-white/[0.07] scroll-mt-2">
            <div className="flex items-center gap-2 mb-1">
              <Bookmark size={14} className="text-violet-300" />
              <p className="text-[13px] font-bold text-white">What {name} remembers</p>
              {!!memory.length && <span className="ml-auto text-[10.5px] text-slate-500 tabular-nums">{memory.length}</span>}
            </div>
            <p className="text-[10.5px] text-slate-500 leading-snug mb-2.5">{name} follows these in every chat. Add your own, edit, or remove anything that is wrong or out of date.</p>
            {onAddNote && (
              <div className="mb-2.5 flex items-start gap-1.5">
                <textarea value={newNote} onChange={e => setNewNote(e.target.value)} rows={2} maxLength={240}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void addNote() } }}
                  placeholder={`Something ${name} should always remember - e.g. "My brand colours are navy and gold" or "Never show prices"`}
                  className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-black/40 border border-white/10 text-[12px] text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30 resize-none" />
                <BrandButton size="sm" onClick={() => void addNote()} disabled={adding || !newNote.trim()} busy={adding} icon={adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}>
                  Add
                </BrandButton>
              </div>
            )}
            {memory.length ? (
              <ul className="space-y-1.5">
                {memory.map(n => (
                  <li key={n.id} className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-violet-400/15 bg-violet-500/[0.04]">
                    {editing?.id === n.id ? (
                      <span className="flex-1 min-w-0 flex items-start gap-1.5">
                        <textarea value={editing.text} onChange={e => setEditing({ id: n.id, text: e.target.value })} rows={2} maxLength={240} autoFocus
                          // the cursor at the end, ready to add to it
                          onFocus={e => { const l = e.currentTarget.value.length; e.currentTarget.setSelectionRange(l, l) }}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit() } if (e.key === "Escape") setEditing(null) }}
                          className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-black/40 border border-white/15 text-[12px] text-white focus:outline-none focus:border-white/35 resize-none" />
                        {savingEdit
                          ? <Loader2 size={13} className="shrink-0 mt-1 animate-spin text-slate-400" />
                          : <>
                              <button onClick={() => void saveEdit()} className="shrink-0 p-0.5 mt-0.5 text-emerald-300 hover:text-emerald-200" aria-label="Save" title="Save"><Check size={14} /></button>
                              <button onClick={() => setEditing(null)} className="shrink-0 p-0.5 mt-0.5 text-slate-500 hover:text-white" aria-label="Cancel" title="Cancel"><X size={13} /></button>
                            </>}
                      </span>
                    ) : (<>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12px] text-slate-200 leading-snug break-words">{n.text}</span>
                      <span className="block mt-0.5 text-[9.5px] text-slate-500">{(() => { const d = new Date(n.at); return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) })()}</span>
                    </span>
                    {confirmForget === n.id ? (
                      <span className="shrink-0 flex items-center gap-1 text-[10.5px]">
                        <button onClick={() => void forget(n.id)} className="px-1.5 py-0.5 rounded bg-red-500/80 text-white font-semibold hover:bg-red-500">Remove</button>
                        <button onClick={() => setConfirmForget(null)} className="px-1 py-0.5 text-slate-400 hover:text-white">Keep</button>
                      </span>
                    ) : forgetting === n.id ? (
                      <Loader2 size={13} className="shrink-0 mt-0.5 animate-spin text-slate-400" />
                    ) : (
                      <span className="shrink-0 flex items-center gap-0.5">
                        {onEditNote && <button onClick={() => { setConfirmForget(null); setEditing({ id: n.id, text: n.text }) }} className="p-0.5 text-slate-500 hover:text-white" aria-label="Edit" title="Edit"><Pencil size={12} /></button>}
                        <button onClick={() => setConfirmForget(n.id)} className="p-0.5 text-slate-500 hover:text-red-300" aria-label="Remove" title="Remove"><X size={13} /></button>
                      </span>
                    )}
                    </>)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2.5 py-3 rounded-lg border border-dashed border-white/10 text-[11px] text-slate-500 leading-snug">
                Nothing yet. Write one above, or tell {name} in a chat (e.g. &lsquo;remember: never show prices&rsquo;) and it is saved here.
              </p>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-[11px] text-red-300">{error}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => setDraft({ perChat: String(DEFAULT_NOVA_BUDGET.perChat), daily: String(DEFAULT_NOVA_BUDGET.daily), monthly: String(DEFAULT_NOVA_BUDGET.monthly), askAbove: String(DEFAULT_NOVA_BUDGET.askAbove) })}
            className="px-3 py-1.5 rounded-lg text-[12px] text-slate-400 hover:text-white hover:bg-white/[0.06]">
            Reset
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12px] text-slate-400 hover:text-white">Cancel</button>
            <BrandButton primary size="sm" busy={saving} disabled={saving} onClick={save} icon={saving ? <Loader2 size={13} className="animate-spin" /> : undefined}>
              Save limits
            </BrandButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
