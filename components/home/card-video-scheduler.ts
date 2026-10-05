/*
 * CARD VIDEO CYCLE - one scheduler shared by every home card.
 *
 * Every card shows its still. The scheduler hands out a few "turns" at a
 * time: a card with a turn mounts its video, plays it once through (looping a
 * short clip until MIN_PLAY_MS has passed), then fades back to its still and
 * the turn goes to the next card in view. Only cards with a turn have a
 * <video> element at all, so a phone's handful of hardware decoders is never
 * oversubscribed however many video cards the page holds.
 *
 * How many play at once starts from the device class (phones fewest) and
 * adapts: when videos keep failing to start or stall, the budget drops by one
 * for the rest of the visit. The browser refusing autoplay outright (iOS Low
 * Power Mode) pauses the cycle - cards stay on their stills - until the first
 * tap or click, when the browser allows playback again.
 *
 * Order: the least recently played card in view goes next, and a card that
 * just played rests on its still for REST_MS first; cards that have
 * never played go top-to-bottom, left-to-right, so the page wakes up in
 * reading order.
 *
 * HOLD: a viewer opened over the cards (holdCardVideos) freezes the cycle.
 * Cards mid-turn pause on the frame they are showing - no fades, nothing new
 * starts - and carry on from there when the last hold lets go. Left running,
 * eight crossfading videos behind a popup made the page shimmer and competed
 * with the popup's own video for decoders.
 */

/** A card's side of a turn: the scheduler calls these, the card renders. */
export type CardVideoHooks = {
  start: () => void
  stop: () => void
  /** Freeze on the current frame (a hold began). Cards without it keep playing. */
  pause?: () => void
  /** Carry on after a hold. */
  resume?: () => void
}

/** What a card reports back while it holds a turn. */
export type CardVideoHandle = {
  /** The video is actually playing (first frame on screen). */
  started: () => void
  /** The video is waiting for data mid-play. */
  stalled: () => void
  /** The clip ended: true = play it again (still under the minimum), false = the turn is over. */
  ended: () => boolean
  /** It could not play. `blocked` = the browser refused autoplay itself. */
  failed: (blocked?: boolean) => void
  unregister: () => void
}

const MIN_PLAY_MS = 5000 // a short clip loops until at least this long
const MAX_PLAY_MS = 30000 // a long clip is cut off here
const START_TIMEOUT_MS = 7000 // chosen but not playing by now = failed
const STALL_TIMEOUT_MS = 5000 // waiting for data mid-play this long = failed
const START_STAGGER_MS = 650 // turns never begin in the same instant
const HANDOFF_GAP_MS = 250 // a beat between one card ending and the next starting
const REST_MS = 4000 // a card that just played shows its still at least this long before its next turn
const FAILS_TO_DOWNGRADE = 2 // this many failures in a row costs one slot
const VISIBLE_RATIO = 0.35 // how much of a card must be on screen to get a turn

type Entry = {
  el: Element
  hooks: CardVideoHooks
  ratio: number
  playing: boolean
  lastAt: number // when its last turn ended (0 = never played)
  startedAt: number // when the video began playing this turn (0 = not yet)
  watchdog: ReturnType<typeof setTimeout> | null
  pausedAt: number // when a hold froze it mid-turn (0 = not frozen)
}

const entries = new Map<Element, Entry>()
let budget = -1 // resolved on first use (needs navigator)
let failStreak = 0
let blocked = false // autoplay refused: wait for a user gesture
let lastStartAt = 0
let scheduleTimer: ReturnType<typeof setTimeout> | null = null
let scheduleDue = 0
let observer: IntersectionObserver | null = null
let holds = 0 // open viewers holding the cycle still

function deviceBudget(): number {
  const ua = navigator.userAgent
  const phone = /iPhone|iPod|Android.+Mobile/i.test(ua)
  const tablet = /iPad|Android(?!.+Mobile)/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  return phone ? 3 : tablet ? 5 : 8
}

function getObserver(): IntersectionObserver {
  if (observer) return observer
  observer = new IntersectionObserver(
    list => {
      for (const e of list) {
        const entry = entries.get(e.target)
        if (!entry) continue
        entry.ratio = e.isIntersecting ? e.intersectionRatio : 0
        // Scrolled away mid-turn: hand the turn on (no penalty, it did nothing wrong).
        if (entry.playing && entry.ratio < 0.1) release(entry, false)
      }
      schedule(0)
    },
    { threshold: [0, 0.1, 0.2, VISIBLE_RATIO, 0.5, 0.75, 1] }
  )
  return observer
}

function clearWatchdog(entry: Entry) {
  if (entry.watchdog) clearTimeout(entry.watchdog)
  entry.watchdog = null
}

function arm(entry: Entry, ms: number) {
  clearWatchdog(entry)
  entry.watchdog = setTimeout(() => release(entry, true), ms)
}

function release(entry: Entry, failed: boolean) {
  if (!entry.playing) return
  clearWatchdog(entry)
  entry.playing = false
  entry.startedAt = 0
  entry.pausedAt = 0
  entry.lastAt = Date.now()
  entry.hooks.stop()
  if (failed) {
    failStreak++
    if (failStreak >= FAILS_TO_DOWNGRADE && budget > 1) {
      budget--
      failStreak = 0
    }
  }
  schedule(HANDOFF_GAP_MS)
}

function playingCount() {
  let n = 0
  for (const e of entries.values()) if (e.playing) n++
  return n
}

/**
 * The next card to get a turn: in view, idle, rested, least recently played,
 * then reading order. With nothing rested yet, `wait` says when to look again.
 */
function nextCandidate(): { next: Entry | null; wait: number } {
  const now = Date.now()
  const inView = [...entries.values()].filter(e => !e.playing && e.ratio >= VISIBLE_RATIO)
  const idle = inView.filter(e => !e.lastAt || now - e.lastAt >= REST_MS)
  if (!idle.length) {
    const soonest = Math.min(...inView.map(e => e.lastAt + REST_MS - now))
    return { next: null, wait: Number.isFinite(soonest) ? soonest : -1 }
  }
  const pos = new Map(idle.map(e => [e, e.el.getBoundingClientRect()]))
  idle.sort((a, b) => {
    if (a.lastAt !== b.lastAt) return a.lastAt - b.lastAt
    const ra = pos.get(a)!, rb = pos.get(b)!
    // Same row (within half a card): left to right; otherwise top to bottom.
    if (Math.abs(ra.top - rb.top) > Math.min(ra.height, rb.height) / 2) return ra.top - rb.top
    return ra.left - rb.left
  })
  return { next: idle[0], wait: 0 }
}

function run() {
  scheduleTimer = null
  if (typeof document === "undefined" || document.hidden || blocked || holds > 0) return
  if (budget < 0) budget = deviceBudget()
  if (playingCount() >= budget) return
  // One start per stagger window; come back for the next free slot.
  const wait = lastStartAt + START_STAGGER_MS - Date.now()
  if (wait > 0) return schedule(wait)
  const { next, wait: rest } = nextCandidate()
  if (!next) {
    if (rest >= 0) schedule(rest + 50) // the soonest card to finish resting
    return
  }
  next.playing = true
  lastStartAt = Date.now()
  arm(next, START_TIMEOUT_MS)
  next.hooks.start()
  if (playingCount() < budget) schedule(START_STAGGER_MS)
}

/** Run the scheduler after `delay` - or sooner, if a sooner run is already booked. */
function schedule(delay: number) {
  if (typeof window === "undefined") return
  const due = Date.now() + Math.max(0, delay)
  if (scheduleTimer) {
    if (scheduleDue <= due) return // an earlier run is coming; it will pick this up
    clearTimeout(scheduleTimer)
  }
  scheduleDue = due
  scheduleTimer = setTimeout(run, due - Date.now())
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    // Background tab: end every turn (the browser would pause them anyway).
    if (document.hidden) for (const e of entries.values()) release(e, false)
    else schedule(0)
  })
  // A gesture lifts an autoplay refusal (iOS Low Power Mode): resume the cycle.
  const unblock = () => {
    if (!blocked) return
    blocked = false
    failStreak = 0
    schedule(0)
  }
  document.addEventListener("pointerdown", unblock, { passive: true })
  document.addEventListener("keydown", unblock)
}

export function registerCardVideo(el: Element, hooks: CardVideoHooks): CardVideoHandle {
  const entry: Entry = { el, hooks, ratio: 0, playing: false, lastAt: 0, startedAt: 0, watchdog: null, pausedAt: 0 }
  entries.set(el, entry)
  getObserver().observe(el)
  return {
    started() {
      if (!entry.playing || entry.pausedAt) return
      if (!entry.startedAt) entry.startedAt = Date.now()
      failStreak = 0
      // The whole turn has a ceiling; a stall re-arms a shorter one.
      arm(entry, Math.max(1000, MAX_PLAY_MS - (Date.now() - entry.startedAt)))
    },
    stalled() {
      if (entry.playing && entry.startedAt && !entry.pausedAt) arm(entry, STALL_TIMEOUT_MS)
    },
    ended() {
      if (!entry.playing) return false
      if (entry.startedAt && Date.now() - entry.startedAt < MIN_PLAY_MS) return true
      release(entry, false)
      return false
    },
    failed(wasBlocked) {
      if (wasBlocked) {
        // Not this card's fault, and no other card will fare better: stop the
        // cycle until the user interacts.
        blocked = true
        if (!entry.playing) return
        clearWatchdog(entry)
        entry.playing = false
        entry.lastAt = Date.now()
        entry.hooks.stop()
        return
      }
      release(entry, true)
    },
    unregister() {
      clearWatchdog(entry)
      const wasPlaying = entry.playing
      entries.delete(el)
      observer?.unobserve(el)
      if (wasPlaying) schedule(HANDOFF_GAP_MS)
    },
  }
}

/**
 * Freeze the cycle while something sits on top of the cards (a media viewer).
 * Returns the release; holds stack, and the cycle carries on when the last
 * one lets go.
 */
export function holdCardVideos(): () => void {
  holds++
  if (holds === 1) {
    if (scheduleTimer) { clearTimeout(scheduleTimer); scheduleTimer = null }
    const now = Date.now()
    for (const e of entries.values()) {
      if (!e.playing || !e.hooks.pause) continue
      clearWatchdog(e) // a frozen turn must not time out
      e.pausedAt = now
      e.hooks.pause()
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    holds = Math.max(0, holds - 1)
    if (holds > 0) return
    const now = Date.now()
    for (const e of entries.values()) {
      if (!e.playing || !e.pausedAt) continue
      // The frozen time doesn't count against the turn
      if (e.startedAt) e.startedAt += now - e.pausedAt
      e.pausedAt = 0
      arm(e, e.startedAt ? Math.max(1000, MAX_PLAY_MS - (now - e.startedAt)) : START_TIMEOUT_MS)
      e.hooks.resume?.()
    }
    schedule(START_STAGGER_MS)
  }
}
