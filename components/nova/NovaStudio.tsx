"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle, ArrowUp, Check, Menu, MessageSquarePlus, Paperclip, Pencil, PlayCircle,
  ShieldCheck, Square, Ticket, Trash2, X, Loader2, PanelRight, Clapperboard, Image as ImageIcon, FolderTree,
  UserRound, Images, Radio, Mountain, Video, AudioLines, Box, Library, Upload,
} from "lucide-react"
import { NOVA_AUTO, NOVA_MODELS, cleanRunBudget, type NovaBudget, type NovaChatSummary, type NovaMessage, type NovaSpend } from "@/lib/nova/config"
import { promptModelLabel } from "@/lib/prompt-models"
import { Dropdown } from "@/components/employees/Dropdown"
import { BrandButton, BrandTitle } from "@/components/employees/StudioBrand"
import { openLibraryPickerItems, type PickedItem } from "@/components/feed/LibraryPicker"
import { NovaMessageView, Lightbox, NovaOpenMediaContext } from "./NovaMessageView"
import { NOVA_STAGE_CSS, NovaFigure, NovaBar, NovaStudioPanel, UsageChip, deriveNovaLive, useNow } from "./NovaStage"
import { NOVA_HERO_ART } from "./novaArt"
import { SilverRimOverlay } from "@/components/home/SilverRimOverlay"
import type { NovaStep } from "@/lib/nova/config"
import { NovaBudgetPanel } from "./NovaBudgetPanel"
import { NovaRunBudget } from "./NovaRunBudget"
import { NovaAssetPicker, type PickedAsset } from "./NovaAssetPicker"
import { NovaReferences, type RefIds } from "./NovaReferences"
import { NovaError, novaApi, novaSend, upsertStep, type NovaBackground, type NovaChatDetail, type NovaChatRefs, type NovaChatBible, type NovaNote, type NovaSendBody } from "./novaApi"

/*
 * Nova Studio (2026-10-18, ADMIN ONLY while under test): a chat with Nova, a
 * Gemini agent that works on the account's own library - it searches and
 * organises My Generations and assets, makes images / video / audio / 3D with
 * the site's public models, and assembles final cuts - inside the user's
 * ticket budget. The server (app/api/nova, lib/nova) does the work and the
 * billing; this is the conversation, the step and media cards, plans to
 * approve and the budget settings.
 *
 * Renders that finish after a turn (video, audio, 3D) are polled through the
 * jobs route; when Nova asked to continue once they land, the chat carries on
 * by itself (the per-chat Auto-continue switch, on by default). The same
 * happens when a turn stopped at its step limit with an approved plan still
 * running (keepGoing) - up to the server's cap of turns in a row.
 *
 * The model menu (admins) starts with Auto: the server routes each turn
 * (lib/nova/router) and every reply shows which model answered and why.
 */

const STARTERS: { text: string; hint: string; icon: typeof ImageIcon }[] = [
  { text: "Make a 15-second ad for my product from my assets", hint: "Stills, motion, music and a final cut", icon: Clapperboard },
  { text: "Organise my last 50 generations into folders", hint: "Nova sorts your library by subject", icon: FolderTree },
  { text: "Design a character and make 3 poses", hint: "Saved as an asset to stay on-model", icon: UserRound },
  { text: "Turn my latest images into a slideshow with music", hint: "Cards, transitions and a music bed", icon: Images },
  { text: "Write and voice a 20-second radio spot", hint: "Script, voiceover and sound", icon: Radio },
  { text: "Find my best landscape pictures and make one into a short video", hint: "From your library to a clip", icon: Mountain },
]

/** What Nova can do, as chips on the welcome hero. */
const CAPABILITIES: { label: string; icon: typeof ImageIcon }[] = [
  { label: "Images", icon: ImageIcon }, { label: "Video", icon: Video }, { label: "Audio", icon: AudioLines },
  { label: "3D", icon: Box }, { label: "Final cuts", icon: Clapperboard }, { label: "Your library", icon: Library },
]

const STREAM_ID = -2
const USER_TEMP_ID = -1
const MAX_ATTACH = 6

type Overview = { isAdmin: boolean; budget: NovaBudget; spend: NovaSpend; balance: number | null }

const readAuto = (id: number) => { try { return localStorage.getItem(`nova-autocontinue-${id}`) !== "0" } catch { return true } }
const writeAuto = (id: number, on: boolean) => { try { localStorage.setItem(`nova-autocontinue-${id}`, on ? "1" : "0") } catch {} }
/* The prompt box's run budget: the last one picked on this device (none yet = the account default, budget.askAbove) */
const RUN_BUDGET_KEY = "nova-run-budget"
const readRunBudget = () => { try { return cleanRunBudget(localStorage.getItem(RUN_BUDGET_KEY)) ?? null } catch { return null } }
const writeRunBudget = (n: number) => { try { localStorage.setItem(RUN_BUDGET_KEY, String(n)) } catch {} }

/** A My Generations row as /api/my-images returns it - what the portal's feed viewers open. */
export type NovaViewerRow = { id: number; imageUrl: string; thumbnailUrl?: string | null; prompt: string; model: string; createdAt?: string; aspectRatio?: string | null; quality?: string | null; videoMetadata?: Record<string, unknown> | null }

/**
 * The page stays put while Nova Studio is open (2026-10-19, owner, iPad):
 * only the chat, the chat list and the side panel scroll. A swipe that hit
 * the end of one of them (or one too short to scroll) used to move the whole
 * page. The class locks <html>/<body> (globals.css).
 *
 * The on-screen keyboard (2026-10-19, owner: "the top gets cut off and I
 * can't scroll up"): iOS does not shrink the page for the keyboard - it
 * scrolls the page up to show the focused box, and zooms in on a box whose
 * text is under 16px. With the page locked there was no way back. So, while
 * Nova is open:
 *  - the studio is sized to the VISIBLE area (visualViewport) through
 *    --nova-vvh, which the portal's studio frame uses: with the keyboard up
 *    the studio ends just above it, the composer included, and nothing needs
 *    to scroll;
 *  - whenever iOS moves the page anyway, it is put straight back at the top;
 *  - on iPhone / iPad the viewport is pinned at scale 1 (maximum-scale=1),
 *    which stops the focus zoom - iOS still lets the user pinch-zoom.
 * Everything is undone when the studio closes.
 */
function usePageLock() {
  useEffect(() => {
    const root = document.documentElement
    const vv = window.visualViewport
    root.classList.add("nova-page-lock")

    const fit = () => {
      // Only at scale 1: a pinch-zoom also shrinks the visual viewport, and the studio must not follow that
      const h = vv && Math.abs(vv.scale - 1) < 0.01 ? vv.height : window.innerHeight
      root.style.setProperty("--nova-vvh", `${Math.round(h)}px`)
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
    }
    fit()
    // The keyboard opening/closing resizes the visual viewport; iOS scrolling the page fires scroll
    vv?.addEventListener("resize", fit)
    vv?.addEventListener("scroll", fit)
    window.addEventListener("scroll", fit)
    // After the keyboard closes iOS can settle a moment later - check again once it has
    const settle = () => { setTimeout(fit, 80); setTimeout(fit, 400) }
    window.addEventListener("focusin", settle)
    window.addEventListener("focusout", settle)

    // iPhone / iPad (iPadOS reports itself as a Mac with touch): no zoom on focus
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    const meta = ios ? document.querySelector<HTMLMetaElement>('meta[name="viewport"]') : null
    const before = meta?.getAttribute("content") ?? null
    if (meta && before !== null && !/maximum-scale/.test(before)) meta.setAttribute("content", `${before}, maximum-scale=1`)

    return () => {
      root.classList.remove("nova-page-lock")
      root.style.removeProperty("--nova-vvh")
      vv?.removeEventListener("resize", fit)
      vv?.removeEventListener("scroll", fit)
      window.removeEventListener("scroll", fit)
      window.removeEventListener("focusin", settle)
      window.removeEventListener("focusout", settle)
      if (meta && before !== null) meta.setAttribute("content", before)
    }
  }, [])
}

export function NovaStudio({ isAdmin, onBalanceChange, onOpenMedia }: {
  isAdmin: boolean
  onBalanceChange?: (b: number) => void
  /** Open a finished picture / clip in the portal's feed viewer; its arrows walk the chat's others of that kind. */
  onOpenMedia?: (kind: "image" | "video", row: NovaViewerRow, list: NovaViewerRow[]) => void
}) {
  usePageLock()
  const [chats, setChats] = useState<NovaChatSummary[]>([])
  const [ov, setOv] = useState<Overview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chatId, setChatId] = useState<number | null>(null)
  const [chat, setChat] = useState<NovaChatDetail | null>(null)
  const [messages, setMessages] = useState<NovaMessage[]>([])
  const [loadingChat, setLoadingChat] = useState(false)

  const [text, setText] = useState("")
  const [attach, setAttach] = useState<PickedItem[]>([])
  // Assets the user picked for the next message ("this is the character I mean")
  const [pickedAssets, setPickedAssets] = useState<PickedAsset[]>([])
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  // The chat's references (the studio panel): assets and My Generations items Nova uses in every message
  const [chatRefs, setChatRefs] = useState<NovaChatRefs>({ assets: [], generations: [] })
  const [refsSaving, setRefsSaving] = useState(false)
  const [refsError, setRefsError] = useState<string | null>(null)
  // The look bible Nova set for this chat (shown in the References panel; the user may clear it)
  const [chatBible, setChatBible] = useState<NovaChatBible | null>(null)
  const [busy, setBusy] = useState(false)
  /** `cont`: the server stopped a run of automatic turns - offer a Continue that sends a normal message. */
  const [error, setError] = useState<{ msg: string; needTickets: boolean; cont?: boolean } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /*
   * A chat created by sending its first message: opening it must not load its
   * (empty) saved messages - that load lands mid-stream and wipes the user's
   * message and Nova's live reply off the screen until the turn ends.
   */
  const freshChatRef = useRef<number | null>(null)

  const [drawer, setDrawer] = useState(false)
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [budgetOpen, setBudgetOpen] = useState<false | "budget" | "memory">(false)
  const [runBudget, setRunBudget] = useState<number | null>(null)
  useEffect(() => { setRunBudget(readRunBudget()) }, [])
  /** What the next request may spend without asking: the one picked in the prompt box, else the account default. */
  const runValue = runBudget ?? ov?.budget.askAbove ?? 10
  /** What Nova remembers about this user (null until loaded). */
  const [memory, setMemory] = useState<NovaNote[] | null>(null)
  const [background, setBackgroundState] = useState<NovaBackground | null>(null)
  /** Set while a turn Nova started by herself (plan carrying on) is running. */
  const [carryingOn, setCarryingOn] = useState(false)
  const [autoContinue, setAutoContinue] = useState(true)
  const [readyToContinue, setReadyToContinue] = useState(false)
  const continuedFor = useRef<Set<number>>(new Set())

  /** The Studio panel as a slide-over, below 2xl (from 2xl it is a column). */
  const [panelOpen, setPanelOpen] = useState(false)
  /** The turn that just ended, while Nova celebrates it (a few seconds). */
  const [justDone, setJustDone] = useState<NovaMessage | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const admin = isAdmin || !!ov?.isAdmin
  /*
   * Admin safety switch (2026-10-19, owner): the SAME switch as the image
   * composer's admin "Filter ON/OFF" (/api/admin/content-filter) - one
   * setting for the whole site. Off: Nova stops refusing on its own and
   * Gemini blocks only high-risk content, so admins can compare filtered and
   * unfiltered behaviour; a floor (no minors, no explicit real people) always
   * holds. Regular users are always filtered and never see it. null = loading.
   */
  const [safetyOn, setSafetyOn] = useState<boolean | null>(null)
  useEffect(() => {
    if (!admin || safetyOn !== null) return
    fetch("/api/admin/content-filter").then(r => (r.ok ? r.json() : null)).then(d => { if (d) setSafetyOn(d.adminFilterOn !== false) }).catch(() => {})
  }, [admin, safetyOn])
  const toggleSafety = async () => {
    if (safetyOn === null) return
    const next = !safetyOn
    setSafetyOn(next)
    const r = await fetch("/api/admin/content-filter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: next }) }).catch(() => null)
    if (!r?.ok) setSafetyOn(!next)
  }

  // ── loading ──
  const loadOverview = useCallback(async () => {
    try {
      const o = await novaApi.overview()
      setChats(o.chats)
      setOv({ isAdmin: o.isAdmin, budget: o.budget, spend: o.spend, balance: o.balance })
      setLoadError(null)
      return o
    } catch (e: any) {
      setLoadError(String(e?.message || e))
      return null
    }
  }, [])

  const loadChat = useCallback(async (id: number) => {
    try {
      const d = await novaApi.chat(id)
      setChat(d.chat)
      setMessages(d.messages)
      if (d.refs) setChatRefs(d.refs)
      setChatBible(d.bible ?? null)
      return d
    } catch (e: any) {
      if (e instanceof NovaError && e.status === 404) {
        setChatId(null)
        try { localStorage.removeItem("nova-chat") } catch {}
      } else setError({ msg: String(e?.message || e), needTickets: false })
      return null
    }
  }, [])

  const loadMemory = useCallback(async () => {
    try { const st = await novaApi.settings(); setMemory(st.memory ?? []); setBackgroundState(st.background ?? null) } catch { /* the panel shows nothing yet */ }
  }, [])

  useEffect(() => {
    void loadMemory()
    void (async () => {
      const o = await loadOverview()
      if (!o) return
      let last: number | null = null
      try { last = Number(localStorage.getItem("nova-chat")) || null } catch {}
      if (last && o.chats.some(c => c.id === last)) setChatId(last)
    })()
  }, [loadOverview])

  useEffect(() => {
    setRefsError(null)
    // Another chat's references never show on this one (a chat just made by the panel gets its own from the save)
    if (freshChatRef.current !== chatId) { setChatRefs({ assets: [], generations: [] }); setChatBible(null) }
    if (chatId === null) { setChat(null); setMessages([]); return }
    try { localStorage.setItem("nova-chat", String(chatId)) } catch {}
    setAutoContinue(readAuto(chatId))
    setReadyToContinue(false)
    if (freshChatRef.current === chatId) { freshChatRef.current = null; return }
    setLoadingChat(true)
    void loadChat(chatId).finally(() => setLoadingChat(false))
  }, [chatId, loadChat])

  // Keep the newest message in view while the user is at the bottom
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // A new chat's welcome starts at the top; a conversation follows its newest message
    if (!messages.length) { el.scrollTop = 0; return }
    if (nearBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])
  const onScroll = () => {
    const el = scrollRef.current
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140
  }

  // ── sending ──
  const send = useCallback(async (body: NovaSendBody, opts?: { optimisticText?: string; targetChat?: number }) => {
    const id = opts?.targetChat ?? chatId
    if (id === null || busy) return
    setBusy(true)
    setError(null)
    setReadyToContinue(false)
    nearBottom.current = true
    const ac = new AbortController()
    abortRef.current = ac

    const now = new Date().toISOString()
    const optimistic: NovaMessage[] = []
    if (opts?.optimisticText !== undefined || (body.attachmentIds?.length ?? 0) > 0 || (body.assetIds?.length ?? 0) > 0) {
      optimistic.push({
        id: USER_TEMP_ID, role: "user", content: opts?.optimisticText ?? body.text, createdAt: now,
        attachments: attach.map(a => ({ id: a.generationId ?? 0, url: a.thumb || a.url, kind: "image" as const })),
        ...(pickedAssets.length ? { assets: pickedAssets } : {}),
      })
    }
    optimistic.push({ id: STREAM_ID, role: "assistant", content: "", createdAt: now, steps: [] })
    setMessages(m => [...m.filter(x => x.id !== USER_TEMP_ID && x.id !== STREAM_ID), ...optimistic])

    const patchStream = (fn: (m: NovaMessage) => NovaMessage) =>
      setMessages(ms => ms.map(m => (m.id === STREAM_ID ? fn(m) : m)))

    let finished = false
    try {
      await novaSend(id, body, e => {
        if (e.t === "text") patchStream(m => ({ ...m, content: m.content + e.d }))
        else if (e.t === "step") patchStream(m => ({ ...m, steps: upsertStep(m.steps, e.step) }))
        else if (e.t === "plan") patchStream(m => ({ ...m, plan: e.plan }))
        else if (e.t === "done") {
          finished = true
          setMessages(ms => ms.map(m => (m.id === STREAM_ID ? e.message : m)))
          setOv(o => (o ? { ...o, spend: e.spend, balance: e.balance } : o))
          if (typeof e.balance === "number" && e.balance >= 0) onBalanceChange?.(e.balance)
          setChats(cs => cs.map(c => (c.id === id ? { ...c, spent: e.chatSpent, updatedAt: new Date().toISOString() } : c)))
        } else if (e.t === "error") {
          setError({ msg: e.error, needTickets: !!e.needTickets })
        }
      }, ac.signal)
    } catch (e: any) {
      if (e?.name === "AbortError") setError({ msg: "Stopped. Anything already made is kept in the chat.", needTickets: false })
      else {
        const msg = String(e?.message || e)
        setError({ msg, needTickets: e instanceof NovaError && e.needTickets, cont: /carried on by itself/i.test(msg) })
      }
    } finally {
      abortRef.current = null
      setBusy(false)
      setCarryingOn(false)
      // The saved rows (real ids, the user's message, any system line) replace the optimistic ones
      const d = await loadChat(id)
      if (!d && !finished) setMessages(ms => ms.filter(m => m.id !== STREAM_ID))
      void loadOverview()
      // Nova may have remembered (or forgotten) something this turn
      if (finished) void loadMemory()
    }
  }, [attach, pickedAssets, busy, chatId, loadChat, loadOverview, loadMemory, onBalanceChange])

  const submit = async (override?: string) => {
    const t = (override ?? text).trim()
    if ((!t && !attach.length && !pickedAssets.length) || busy || lastAssistant?.running) return
    let id = chatId
    if (id === null) {
      try {
        const { chat: c } = await novaApi.createChat()
        setChats(cs => [c, ...cs])
        id = c.id
        freshChatRef.current = c.id
        setChat({ ...c, plan: null })
        setMessages([])
        setChatId(c.id)
      } catch (e: any) {
        setError({ msg: String(e?.message || e), needTickets: false })
        return
      }
    }
    const body: NovaSendBody = {
      text: t,
      attachmentIds: attach.map(a => a.generationId).filter((n): n is number => typeof n === "number"),
      ...(pickedAssets.length ? { assetIds: pickedAssets.map(a => a.id) } : {}),
      runBudget: runValue,
    }
    const urls = attach.filter(a => a.generationId === null).map(a => a.url)
    if (urls.length) body.attachmentUrls = urls
    setText("")
    setAttach([])
    setPickedAssets([])
    await send(body, { optimisticText: t, targetChat: id })
  }

  // The server-side stop first: with background runs on, a dropped connection no longer stops the turn
  const stop = () => { if (chatId !== null) void novaApi.stopChat(chatId).catch(() => {}); abortRef.current?.abort() }

  /* The plan card shows its answer at once - the saved status only arrives with the reloaded chat */
  const markPlan = (messageId: number, status: "approved" | "declined", tickets?: number) =>
    setMessages(ms => ms.map(m => (m.id === messageId && m.plan ? { ...m, plan: { ...m.plan, status, ...(tickets !== undefined ? { approvedTickets: tickets } : {}) } } : m)))
  const approvePlan = (messageId: number, tickets: number) => { markPlan(messageId, "approved", tickets); void send({ text: "", approvePlan: { messageId, tickets } }) }
  const declinePlan = (messageId: number) => { markPlan(messageId, "declined"); void send({ text: "", declinePlan: { messageId } }) }

  // ── renders that finish after the turn ──
  const lastAssistant = useMemo(() => [...messages].reverse().find(m => m.role === "assistant" && m.id > 0) ?? null, [messages])
  /*
   * A reply still being written on the server (2026-10-19, owner): the page
   * was reloaded - or opened on another device - while Nova worked. The turn
   * carries on server-side, so the studio shows Nova at work and re-reads the
   * chat every few seconds until the reply lands (Stop still works: it is a
   * server-side stop). It used to show "Ready for what's next" with the steps
   * frozen on "Making the image...".
   */
  const following = !busy && !!lastAssistant?.running
  const working = busy || following
  useEffect(() => {
    if (!following || chatId === null) return
    const id = chatId
    const t = setInterval(() => { void loadChat(id) }, 3000)
    return () => clearInterval(t)
  }, [following, chatId, loadChat])
  // When a followed reply lands: the new balance, spend and anything Nova remembered
  const wasFollowing = useRef(false)
  useEffect(() => {
    if (wasFollowing.current && !following) { void loadOverview(); void loadMemory() }
    wasFollowing.current = following
  }, [following, loadOverview, loadMemory])
  const hasPending = messages.some(m => m.steps?.some(s => s.status === "pending"))
  // Ticks while renders run, so the elapsed times count up
  const nowTick = useNow(hasPending)

  useEffect(() => {
    if (chatId === null || !hasPending || working) return
    const id = chatId
    let stopped = false
    const tick = async () => {
      try {
        const r = await novaApi.jobs(id)
        if (stopped) return
        if (r.updates.length) {
          setMessages(ms => ms.map(m => {
            const mine = r.updates.filter(u => u.messageId === m.id)
            if (!mine.length) return m
            let steps = m.steps
            for (const u of mine) steps = upsertStep(steps, u.step)
            return { ...m, steps }
          }))
        }
        if (r.pending === 0 && r.readyToContinue) setReadyToContinue(true)
      } catch { /* the next tick tries again */ }
    }
    const t = setInterval(tick, 8000)
    void tick()
    return () => { stopped = true; clearInterval(t) }
  }, [chatId, hasPending, working])

  const wantsToContinue = !!(lastAssistant?.continueAfterRenders || lastAssistant?.keepGoing)

  // Carry on by itself once Nova's renders land, or straight away when she
  // stopped at her step limit mid-plan (keepGoing) - once per message
  useEffect(() => {
    if (working || !autoContinue || !lastAssistant || !wantsToContinue) return
    if (continuedFor.current.has(lastAssistant.id)) return
    const ready = readyToContinue || (lastAssistant.keepGoing && !hasPending)
    if (!ready) return
    continuedFor.current.add(lastAssistant.id)
    setCarryingOn(true)
    void send({ text: "", continue: true })
  }, [readyToContinue, working, autoContinue, lastAssistant, wantsToContinue, hasPending, send])

  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !working && lastAssistant) {
      setJustDone(lastAssistant)
      const t = setTimeout(() => setJustDone(null), 6000)
      wasBusy.current = working
      return () => clearTimeout(t)
    }
    wasBusy.current = working
  }, [working, lastAssistant])

  const continueNow = () => {
    if (lastAssistant) continuedFor.current.add(lastAssistant.id)
    setCarryingOn(true)
    void send({ text: "", continue: true })
  }

  // ── chats ──
  const newChat = async () => {
    if (busy) return
    try {
      const { chat: c } = await novaApi.createChat()
      setChats(cs => [c, ...cs])
      setChatId(c.id)
      setDrawer(false)
      setTimeout(() => taRef.current?.focus(), 50)
    } catch (e: any) { setError({ msg: String(e?.message || e), needTickets: false }) }
  }
  const saveRename = async () => {
    if (!renaming) return
    const { id, title } = renaming
    setRenaming(null)
    const t = title.trim()
    if (!t) return
    setChats(cs => cs.map(c => (c.id === id ? { ...c, title: t } : c)))
    if (chat?.id === id) setChat(c => (c ? { ...c, title: t } : c))
    try { await novaApi.patchChat(id, { title: t }) } catch (e: any) { setError({ msg: String(e?.message || e), needTickets: false }) }
  }
  const removeChat = async (id: number) => {
    setConfirmDelete(null)
    try {
      await novaApi.deleteChat(id)
      setChats(cs => cs.filter(c => c.id !== id))
      if (chatId === id) {
        setChatId(null)
        try { localStorage.removeItem("nova-chat") } catch {}
      }
    } catch (e: any) { setError({ msg: String(e?.message || e), needTickets: false }) }
  }
  const setModel = async (model: string) => {
    if (!chat) return
    setChat(c => (c ? { ...c, model } : c))
    try { await novaApi.patchChat(chat.id, { model }) } catch (e: any) { setError({ msg: String(e?.message || e), needTickets: false }) }
  }

  /*
   * Upload from the device (2026-10-19, owner): straight to storage (the
   * presign route - ID-verified accounts only), then filed as a My
   * Generations item of this chat (/api/nova/uploads) and attached like a
   * library pick, so Nova refers to it by #id. A chat is made first if needed.
   */
  const uploadInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const uploadFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, Math.max(0, MAX_ATTACH - attach.length))
    if (!list.length) return
    let id = chatId
    if (id === null) {
      try {
        const { chat: c } = await novaApi.createChat()
        setChats(cs => [c, ...cs]); id = c.id; freshChatRef.current = c.id
        setChat({ ...c, plan: null }); setMessages([]); setChatId(c.id)
      } catch (e: any) { setError({ msg: String(e?.message || e), needTickets: false }); return }
    }
    setUploading(n => n + list.length)
    for (const f of list) {
      try {
        const pre = await fetch("/api/upload-video-media/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: f.type || "application/octet-stream", size: f.size, name: f.name }) })
        const pj = await pre.json().catch(() => ({}))
        if (!pre.ok) throw new Error(pj.code === "ID_VERIFICATION_REQUIRED" ? "Verify your ID to upload files (Profile → ID verification)" : pj.error || "Could not start the upload")
        const put = await fetch(pj.uploadUrl, { method: "PUT", headers: { "Content-Type": pj.contentType }, body: f })
        if (!put.ok) throw new Error(`The upload failed (${put.status})`)
        const r = await fetch("/api/nova/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: pj.url, name: f.name, chatId: id }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || "Could not add the upload")
        setAttach(a => (a.length >= MAX_ATTACH ? a : [...a, { url: j.url, thumb: j.kind === "image" ? j.url : "", generationId: j.id }]))
      } catch (e: any) {
        setError({ msg: String(e?.message || e), needTickets: false })
      } finally {
        setUploading(n => Math.max(0, n - 1))
      }
    }
  }

  const pickAttachments = async () => {
    const room = MAX_ATTACH - attach.length
    if (room <= 0) return
    const items = await openLibraryPickerItems({ max: room, title: "Attach from your library" })
    if (items.length) setAttach(a => [...a, ...items.filter(i => !a.some(x => x.url === i.url))].slice(0, MAX_ATTACH))
  }

  /** Save the chat's references - a chat is made first when there is none yet. */
  const changeRefs = async (next: RefIds) => {
    setRefsError(null)
    let id = chatId
    if (id === null) {
      try {
        const { chat: c } = await novaApi.createChat()
        setChats(cs => [c, ...cs])
        id = c.id
        freshChatRef.current = c.id
        setChat({ ...c, plan: null })
        setMessages([])
        setChatId(c.id)
      } catch (e: any) { setRefsError(String(e?.message || e)); return }
    }
    // Removals show at once; additions once the server has resolved them
    setChatRefs(r => ({ assets: r.assets.filter(a => next.assets.includes(a.id)), generations: r.generations.filter(g => next.generations.includes(g.id)) }))
    setRefsSaving(true)
    try {
      const r = await novaApi.patchChat(id, { refs: next })
      if (r.refs) setChatRefs(r.refs)
    } catch (e: any) {
      setRefsError(String(e?.message || e))
    } finally {
      setRefsSaving(false)
    }
  }

  const toggleBackground = async (on: boolean) => {
    const r = await novaApi.setBackground(on)
    setBackgroundState(r.background ?? null)
  }
  const forgetNote = async (id: string) => {
    const r = await novaApi.forgetNote(id)
    setMemory(r.memory ?? [])
  }

  const saveBudget = async (b: NovaBudget) => {
    const r = await novaApi.saveSettings(b)
    setOv(o => (o ? { ...o, budget: r.budget, spend: r.spend, balance: r.balance } : o))
  }
  const pickRunBudget = (n: number) => { setRunBudget(n); writeRunBudget(n) }
  /** The header's usage ring: below 2xl it opens the panel; from 2xl the panel is already on screen, so its gauge is brought into view and glows. */
  const showUsage = () => {
    if (!window.matchMedia("(min-width: 1536px)").matches) { setPanelOpen(true); return }
    const g = document.querySelector<HTMLElement>("aside [data-nova-usage]")
    if (!g) return
    g.scrollIntoView({ behavior: "smooth", block: "nearest" })
    g.style.boxShadow = "0 0 0 1px rgba(226,232,240,0.45), 0 0 24px -4px rgba(217,70,239,0.45)"
    setTimeout(() => { g.style.boxShadow = "" }, 1200)
  }

  const sortedChats = useMemo(() => [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [chats])
  // Auto (the router) first; then every model an admin can pin to compare
  const modelOptions = useMemo(() => [
    { value: NOVA_AUTO, label: "Auto (recommended)" },
    ...NOVA_MODELS.map(m => ({ value: m.id, label: promptModelLabel(m, NOVA_AUTO) })),
  ], [])

  // A media card asks to open in the feed viewer: the chat's finished pictures
  // (or clips) are fetched as their My Generations rows, so the viewer shows
  // the real model, prompt and settings and its arrows step through the chat.
  // A row that does not load (deleted, still saving) opens from the card itself.
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])
  const openInViewer = useCallback((step: NovaStep): boolean => {
    if (!onOpenMedia || !step.generationId || !step.mediaUrl) return false
    const kind: "image" | "video" = step.kind === "image" ? "image" : "video"
    const same = (s: NovaStep) => s.status === "done" && !!s.generationId && !!s.mediaUrl && (kind === "image" ? s.kind === "image" : s.kind === "video" || s.kind === "cut")
    const steps = messagesRef.current.flatMap(m => m.steps ?? []).filter(same)
    const order = [...new Set(steps.map(s => s.generationId!))]
    // The viewer's list: up to 60 around the one opened (the route's cap)
    const at = Math.max(0, order.indexOf(step.generationId))
    const start = Math.max(0, Math.min(at - 30, order.length - 60))
    const ids = order.slice(start, start + 60)
    const fromStep = (s: NovaStep): NovaViewerRow => ({ id: s.generationId!, imageUrl: s.mediaUrl!, thumbnailUrl: s.posterUrl ?? null, prompt: s.prompt ?? "", model: s.model ?? s.label })
    void (async () => {
      let rows: NovaViewerRow[] = []
      try {
        const r = await fetch(`/api/my-images?ids=${ids.join(",")}`)
        if (r.ok) rows = ((await r.json()).images ?? []) as NovaViewerRow[]
      } catch {}
      const list = ids.map(id => rows.find(x => x.id === id) ?? fromStep(steps.find(s => s.generationId === id)!))
      onOpenMedia(kind, list.find(x => x.id === step.generationId) ?? fromStep(step), list)
    })()
    return true
  }, [onOpenMedia])

  if (loadError && !ov) {
    return (
      <div className="h-full flex items-center justify-center p-6 bg-[#070b14]">
        <div className="max-w-sm text-center">
          <AlertCircle size={22} className="mx-auto mb-2 text-red-400" />
          <p className="text-sm text-slate-200">{loadError}</p>
          <button onClick={() => void loadOverview()} className="mt-3 text-[12px] text-slate-400 hover:text-white underline">Try again</button>
        </div>
      </div>
    )
  }

  const chatSpent = chats.find(c => c.id === chatId)?.spent ?? chat?.spent ?? 0
  const budget = ov?.budget
  const spend = ov?.spend ?? { today: 0, month: 0 }
  const empty = !loadingChat && messages.length === 0

  // ── what Nova is doing right now (her pose + a line), for the stage, the bar and the live reply ──
  const live = deriveNovaLive({ messages, streamingId: following && lastAssistant ? lastAssistant.id : STREAM_ID, busy: working, justDone, now: nowTick })

  /** A gallery tile: a picture or clip opens in the feed viewer (else big / scrolled to); a sound or a model scrolls to where Nova made it. */
  const openMedia = (messageId: number, step: NovaStep) => {
    setPanelOpen(false)
    if ((step.kind === "image" || step.kind === "video" || step.kind === "cut") && openInViewer(step)) return
    if (step.kind === "image" && step.mediaUrl) { setViewing(step.mediaUrl); return }
    document.getElementById(`nova-msg-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const chip = "inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-slate-300 tabular-nums whitespace-nowrap"
  const balanceText = ov?.balance === null ? "Free · admin" : ov ? String(ov.balance) : "…"

  const panel = (
    <NovaStudioPanel live={live} chatTitle={chat?.title} plan={chat?.plan ?? null} chatSpent={chatSpent} spend={spend} budget={budget}
      balance={ov ? ov.balance : undefined} messages={messages} onOpenBudget={() => setBudgetOpen("budget")} onOpenMedia={openMedia}
      memoryCount={memory?.length ?? 0} onOpenMemory={() => { setPanelOpen(false); setBudgetOpen("memory") }}
      references={<NovaReferences refs={chatRefs} saving={refsSaving} error={refsError} onChange={next => void changeRefs(next)}
        bible={chatBible} onClearBible={chatId === null ? undefined : () => { const id = chatId; setChatBible(null); void novaApi.patchChat(id, { bible: null }).catch(e => setRefsError(String(e?.message || e))) }} />} />
  )

  // ── sidebar ──
  const sidebar = (
    <div className="h-full flex flex-col bg-[#070b14]">
      <div className="px-3 pt-3 pb-2.5 border-b border-white/[0.06] space-y-2.5">
        <div className="flex items-center gap-2.5">
          <NovaFigure pose="portrait" size={34} animated={false} glow={false} />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-black tracking-tight silver-shimmer-text leading-tight">Nova Studio</p>
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500">your chats</p>
          </div>
          <button onClick={() => setDrawer(false)} className="lg:hidden p-1.5 text-slate-500 hover:text-white" aria-label="Close chats"><X size={16} /></button>
        </div>
        <BrandButton primary size="sm" onClick={newChat} disabled={busy} icon={<MessageSquarePlus size={13} />} className="w-full">
          New chat
        </BrandButton>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-0.5">
        {!sortedChats.length && <p className="px-2 py-6 text-center text-[11.5px] text-slate-500">No chats yet. Start one and Nova gets to work.</p>}
        {sortedChats.map(c => {
          const on = c.id === chatId
          if (renaming?.id === c.id) {
            return (
              <div key={c.id} className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-white/[0.08]">
                <input autoFocus value={renaming.title} onChange={e => setRenaming({ id: c.id, title: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter") void saveRename(); if (e.key === "Escape") setRenaming(null) }}
                  onBlur={() => void saveRename()} maxLength={80}
                  className="flex-1 min-w-0 px-1.5 py-1 rounded bg-black/40 border border-white/15 text-[12px] text-white focus:outline-none" />
              </div>
            )
          }
          if (confirmDelete === c.id) {
            return (
              <div key={c.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/[0.08] border border-red-500/25 text-[11.5px]">
                <span className="flex-1 truncate text-red-200">Delete &ldquo;{c.title}&rdquo;?</span>
                <button onClick={() => void removeChat(c.id)} className="px-2 py-0.5 rounded bg-red-500/80 text-white font-semibold hover:bg-red-500">Delete</button>
                <button onClick={() => setConfirmDelete(null)} className="px-1.5 py-0.5 text-slate-400 hover:text-white">Keep</button>
              </div>
            )
          }
          return (
            <div key={c.id} className={`group relative flex items-center gap-1 rounded-xl transition-colors ${on ? "bg-white/[0.08] silver-edge" : "hover:bg-white/[0.04]"}`}>
              <button onClick={() => { if (!busy) { setChatId(c.id); setDrawer(false) } }} disabled={busy && !on}
                className="flex-1 min-w-0 text-left px-2.5 py-2 disabled:opacity-50">
                <p className={`text-[12.5px] truncate ${on ? "text-white font-semibold" : "text-slate-300"}`}>
                  {c.unread && !on && <span className="inline-block w-1.5 h-1.5 mr-1.5 mb-0.5 rounded-full bg-fuchsia-400 align-middle" title="Nova finished this while you were away" />}
                  {c.title}
                </p>
                <p className="text-[10px] text-slate-500 tabular-nums">{c.spent > 0 ? `${c.spent} tickets` : "No spend yet"}</p>
              </button>
              <div className="flex items-center pr-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                <button onClick={() => setRenaming({ id: c.id, title: c.title })} className="p-1.5 text-slate-500 hover:text-white" aria-label="Rename"><Pencil size={12} /></button>
                <button onClick={() => setConfirmDelete(c.id)} className="p-1.5 text-slate-500 hover:text-red-300" aria-label="Delete"><Trash2 size={12} /></button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="p-3 border-t border-white/[0.06] text-[10.5px] text-slate-500 leading-snug">
        Everything Nova makes is saved to My Generations, in a folder per chat.
      </div>
    </div>
  )

  return (
    <NovaOpenMediaContext.Provider value={onOpenMedia ? openInViewer : null}>
    <div className="relative h-full flex bg-[#070b14] text-slate-200 overflow-hidden">
      <style>{NOVA_STAGE_CSS}</style>

      {/* Chats: a column from lg, a slide-over below */}
      <aside className="hidden lg:block w-64 xl:w-72 2xl:w-[19rem] shrink-0 border-r border-white/[0.06]">{sidebar}</aside>
      {drawer && (
        <div className="lg:hidden absolute inset-0 z-40 flex">
          <div className="w-[min(19rem,86vw)] h-full border-r border-white/[0.08] shadow-2xl">{sidebar}</div>
          <button className="flex-1 bg-black/60" onClick={() => setDrawer(false)} aria-label="Close chats" />
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-white/[0.06] px-3 sm:px-4 py-2 flex items-center gap-2 bg-[#070b14]/95">
          <button onClick={() => setDrawer(true)} className="lg:hidden p-1.5 -ml-1 text-slate-400 hover:text-white" aria-label="Chats"><Menu size={17} /></button>
          <div className="min-w-0 flex-1">
            <BrandTitle title={chat?.title ?? "Nova Studio"} eyebrow="Nova · your creative partner" logo={22} size="sm" />
          </div>
          {admin && safetyOn !== null && (
            <button onClick={() => void toggleSafety()} disabled={busy}
              title={safetyOn
                ? "Safety filter ON - Nova follows the site's content rules (admin switch, shared with the composer's Filter button)"
                : "Safety filter OFF for admin accounts - Nova does not refuse on its own and defers to the models' checks (no minors, no explicit real people still holds). Shared with the composer's Filter button."}
              className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10.5px] font-semibold transition-colors disabled:opacity-50 ${safetyOn
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                : "border-amber-400/40 bg-amber-500/15 text-amber-200"}`}>
              <ShieldCheck size={11} /> Safety {safetyOn ? "ON" : "OFF"}
            </button>
          )}
          {admin && chat && (
            <div className="hidden sm:block w-44 lg:w-52 shrink-0">
              <Dropdown value={chat.model || NOVA_AUTO} options={modelOptions} onChange={v => void setModel(v)} disabled={busy} className="w-full" />
            </div>
          )}
          <div className="hidden md:flex items-center gap-1.5 text-[10.5px]">
            {/* This chat's usage as a small ring (the side panel's gauge, folded) - a tap opens the full breakdown */}
            {/* Shown before the first message too (a new chat starts at 0) */}
            <UsageChip chatSpent={chat ? chatSpent : 0} messages={chat ? messages : []} plan={chat?.plan ?? null} busy={working} onClick={showUsage} />
            <span className={chip}><Ticket size={10} /> {balanceText}</span>
          </div>
          <button onClick={() => setPanelOpen(true)} className="2xl:hidden shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06]" aria-label="Open the studio panel" title="Nova, tickets and everything made in this chat">
            <PanelRight size={17} />
          </button>
        </div>

        {/* Nova, live - below 2xl (from 2xl she has the side panel) */}
        <div className="2xl:hidden shrink-0">
          <NovaBar live={live} onOpenPanel={() => setPanelOpen(true)} chips={
            <span className={`${chip} md:hidden text-[10px]`}><Ticket size={10} /> {balanceText}</span>
          } />
        </div>

        {/* Conversation */}
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="max-w-[1500px] mx-auto px-3 sm:px-6 xl:px-10 py-5 sm:py-6 space-y-6">
            {loadingChat && (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
                <NovaFigure pose="thinking" size={72} busy />
                <span className="text-[12px]">Opening the chat…</span>
              </div>
            )}
            {empty && (
              <div className="space-y-5">
                {/* Welcome hero: Nova's studio art beside her introduction (one Nova, not two) */}
                <div className="relative rounded-3xl overflow-hidden border border-white/[0.06] bg-[radial-gradient(ellipse_at_80%_50%,rgba(99,102,241,0.16),transparent_60%),#080c17] grid md:grid-cols-[1fr_1.05fr]">
                  <SilverRimOverlay rounded="rounded-3xl" />
                  <div className="relative md:order-2 aspect-[16/9] md:aspect-auto md:min-h-[320px] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={NOVA_HERO_ART} alt="Nova in her studio, surrounded by the media she makes" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-[linear-gradient(0deg,#080c17_0%,transparent_45%)] md:bg-[linear-gradient(90deg,#080c17_0%,rgba(8,12,23,0.35)_28%,transparent_60%)]" />
                  </div>
                  <div className="relative md:order-1 flex flex-col justify-center p-5 sm:p-8 -mt-10 md:mt-0 text-center md:text-left">
                    <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-slate-400 mb-2">Nova Studio</p>
                    <h2 className="text-2xl sm:text-3xl font-black tracking-tight silver-shimmer-text leading-tight">Hi, I&apos;m Nova.</h2>
                    <p className="mt-2.5 text-[13.5px] text-slate-300 leading-relaxed max-w-md mx-auto md:mx-0">
                      Tell me what you want to make. I use your generations and assets, create with the studio&apos;s models,
                      keep it all organised, and cut it into a finished piece. Bigger jobs come to you as a plan first.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-1.5">
                      {CAPABILITIES.map(c => (
                        <span key={c.label} className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-white/[0.12] bg-black/30 text-[10.5px] text-slate-200">
                          <c.icon size={11} className="text-slate-300" /> {c.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="mb-2 px-1 text-[9.5px] font-mono uppercase tracking-[0.2em] text-slate-500">Try one of these</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {STARTERS.map(st => (
                      <button key={st.text} onClick={() => void submit(st.text)} disabled={busy}
                        className="group text-left flex gap-3 p-3.5 rounded-2xl silver-edge bg-[#0b0f1a] hover:bg-white/[0.05] transition-colors disabled:opacity-50">
                        <span className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-white/[0.12] to-white/[0.03] border border-white/[0.10] flex items-center justify-center group-hover:border-white/25">
                          <st.icon size={16} className="text-slate-200" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[12.5px] text-slate-100 leading-snug">{st.text}</span>
                          <span className="block mt-0.5 text-[10.5px] text-slate-500">{st.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {!loadingChat && messages.map(m => (
              <NovaMessageView key={m.id} message={m} streaming={m.id === STREAM_ID || (following && m.id === lastAssistant?.id)} livePose={m.id === STREAM_ID || (following && m.id === lastAssistant?.id) ? live.pose : undefined}
                isLatestAssistant={m.role === "assistant" && (m.id === STREAM_ID || m.id === lastAssistant?.id)}
                busy={working} onApprovePlan={approvePlan} onDeclinePlan={declinePlan} />
            ))}
            {following && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/[0.05] text-[11.5px] text-fuchsia-100">
                <Loader2 size={12} className="animate-spin" /> Nova is still working on this - it updates here as she goes.
              </div>
            )}
            {busy && carryingOn && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/[0.05] text-[11.5px] text-fuchsia-100">
                <Loader2 size={12} className="animate-spin" /> Nova is carrying on with the plan…
              </div>
            )}
            {!working && lastAssistant && wantsToContinue && (readyToContinue || (lastAssistant.keepGoing && !hasPending)) && !continuedFor.current.has(lastAssistant.id) && !autoContinue && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] text-[12px] text-emerald-200">
                <Check size={13} /> {lastAssistant.keepGoing ? "Nova paused mid-plan - she can carry on." : "The renders are ready."}
                <button onClick={continueNow} className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-white font-semibold">
                  <PlayCircle size={12} /> Continue
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-white/[0.06] bg-[linear-gradient(0deg,#070b14,rgba(7,11,20,0.92))] px-3 sm:px-6 pt-2.5 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-3">
          <div className="max-w-[1100px] mx-auto">
            {error && (
              <div className={`mb-2 flex items-start gap-2 px-3 py-2 rounded-lg border text-[12px] ${error.cont ? "border-sky-400/25 bg-sky-500/[0.06] text-sky-100" : error.needTickets ? "border-amber-400/30 bg-amber-500/[0.07] text-amber-100" : "border-red-500/25 bg-red-500/[0.07] text-red-200"}`}>
                {error.cont ? <PlayCircle size={13} className="shrink-0 mt-0.5" /> : <AlertCircle size={13} className="shrink-0 mt-0.5" />}
                <span className="flex-1">{error.cont ? "Nova has carried on by herself for a while and paused so you can check in." : error.msg}</span>
                {error.cont && (
                  <button onClick={() => { setError(null); void submit("Continue") }} disabled={busy}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-sky-500/20 hover:bg-sky-500/30 text-white font-semibold disabled:opacity-50">
                    Continue
                  </button>
                )}
                {error.needTickets && <a href="/buy-tickets" className="shrink-0 underline font-semibold">Get tickets</a>}
                <button onClick={() => setError(null)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss"><X size={13} /></button>
              </div>
            )}
            {!!pickedAssets.length && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pickedAssets.map(a => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-full border border-fuchsia-300/30 bg-fuchsia-500/[0.08] text-[11.5px] text-fuchsia-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {a.thumb ? <img src={a.thumb} alt="" className="w-5 h-5 rounded-full object-cover" /> : <Library size={12} className="ml-1" />}
                    <span className="max-w-[10rem] truncate">{a.name}</span>
                    <span className="text-fuchsia-300/60 capitalize">{a.kind}</span>
                    <button onClick={() => setPickedAssets(xs => xs.filter(x => x.id !== a.id))} className="p-0.5 text-fuchsia-200/70 hover:text-white" aria-label={`Remove ${a.name}`}><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}
            {!!attach.length && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attach.map(a => (
                  <div key={a.url} className="relative w-14 h-14 rounded-lg overflow-hidden border border-white/15 bg-slate-800">
                    {/* An uploaded clip or sound has no thumbnail: a still of the clip, or a sound icon */}
                    {a.thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={a.thumb} alt="" className="w-full h-full object-cover" />
                      : /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(a.url)
                        ? <video src={`${a.url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                        : /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(a.url)
                          ? <span className="w-full h-full flex items-center justify-center text-slate-300"><AudioLines size={18} /></span>
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={a.url} alt="" className="w-full h-full object-cover" />}
                    <button onClick={() => setAttach(xs => xs.filter(x => x.url !== a.url))}
                      className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/70 text-white hover:bg-black" aria-label="Remove">
                      <X size={10} />
                    </button>
                    {a.generationId && <span className="absolute bottom-0.5 left-0.5 px-1 rounded bg-black/70 text-[8.5px] font-mono text-slate-300">#{a.generationId}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl silver-edge bg-[#0b0f1a] p-2 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)]">
              <button onClick={() => void pickAttachments()} disabled={busy || attach.length >= MAX_ATTACH}
                className="shrink-0 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-40" title="Attach from My Generations or Assets" aria-label="Attach">
                <Paperclip size={17} />
              </button>
              <button onClick={() => uploadInput.current?.click()} disabled={busy || uploading > 0 || attach.length >= MAX_ATTACH}
                className="shrink-0 -ml-1 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-40" title="Upload a picture, video or sound from your device" aria-label="Upload">
                {uploading ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}
              </button>
              <input ref={uploadInput} type="file" accept="image/*,video/*,audio/*" multiple className="hidden"
                onChange={e => { void uploadFiles(e.target.files); e.target.value = "" }} />
              <button onClick={() => setAssetPickerOpen(true)} disabled={busy}
                className={`shrink-0 -ml-1 p-2 rounded-xl hover:bg-white/[0.06] disabled:opacity-40 ${pickedAssets.length ? "text-fuchsia-300" : "text-slate-400 hover:text-white"}`}
                title="Pick your Assets - tell Nova which character, product or place you mean" aria-label="Pick assets">
                <Library size={17} />
              </button>
              <textarea ref={taRef} value={text} onChange={e => setText(e.target.value)} rows={1}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit() } }}
                placeholder={working ? "Nova is working…" : chat ? "Tell Nova what to make…" : "Start a chat - tell Nova what to make…"}
                className="flex-1 min-w-0 resize-none max-h-40 min-h-[40px] px-1.5 py-2 bg-transparent text-[14px] text-white placeholder:text-slate-600 focus:outline-none field-sizing-content" />
              {/* The budget for this request - set per run, right where it is sent */}
              <NovaRunBudget value={runValue} accountDefault={ov?.budget.askAbove} onChange={pickRunBudget}
                onSaveDefault={ov ? n => saveBudget({ ...ov.budget, askAbove: n }) : undefined}
                onOpenLimits={() => setBudgetOpen("budget")} disabled={!ov} />
              {working ? (
                <BrandButton size="md" onClick={stop} icon={<Square size={12} fill="currentColor" />} title="Stop" className="shrink-0">
                  <span className="hidden sm:inline">Stop</span>
                </BrandButton>
              ) : (
                <BrandButton primary size="md" onClick={() => void submit()} disabled={!text.trim() && !attach.length && !pickedAssets.length} icon={<ArrowUp size={14} />} title="Send" className="shrink-0">
                  <span className="hidden sm:inline">Send</span>
                </BrandButton>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-slate-500">
              <span>Chat and generations cost tickets · Nova asks first if a request needs more than {runValue}</span>
              {chat && (
                <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer select-none" title="When Nova is waiting on renders or paused mid-plan, carry on by herself">
                  <input type="checkbox" checked={autoContinue} onChange={e => { setAutoContinue(e.target.checked); if (chat) writeAuto(chat.id, e.target.checked) }} className="accent-fuchsia-400" />
                  Auto-continue after renders
                </label>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* The Studio panel: a column from 2xl, a slide-over below */}
      <aside className="hidden 2xl:block w-[22rem] min-[1900px]:w-[25rem] shrink-0 border-l border-white/[0.06] overflow-y-auto overscroll-contain p-3 bg-[linear-gradient(180deg,#080c17,#070b14)]">
        {panel}
      </aside>
      {panelOpen && (
        <div className="2xl:hidden absolute inset-0 z-40 flex justify-end">
          <button className="flex-1 bg-black/60" onClick={() => setPanelOpen(false)} aria-label="Close the studio panel" />
          <div className="relative w-[min(24rem,92vw)] h-full overflow-y-auto overscroll-contain border-l border-white/[0.08] shadow-2xl p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] bg-[#070b14]">
            <button onClick={() => setPanelOpen(false)} className="absolute top-4 right-4 z-40 p-1.5 rounded-full bg-black/60 text-slate-300 hover:text-white" aria-label="Close"><X size={15} /></button>
            {panel}
          </div>
        </div>
      )}

      {budgetOpen && ov && (
        <NovaBudgetPanel budget={ov.budget} spend={spend} onClose={() => setBudgetOpen(false)} onSave={saveBudget}
          memory={memory ?? []} onForget={forgetNote} focusMemory={budgetOpen === "memory"}
          background={background} onToggleBackground={toggleBackground} />
      )}
      {viewing && <Lightbox url={viewing} onClose={() => setViewing(null)} />}
      {assetPickerOpen && <NovaAssetPicker selected={pickedAssets} onClose={() => setAssetPickerOpen(false)} onDone={a => { setPickedAssets(a); setAssetPickerOpen(false); setTimeout(() => taRef.current?.focus(), 50) }} />}
    </div>
    </NovaOpenMediaContext.Provider>
  )
}
