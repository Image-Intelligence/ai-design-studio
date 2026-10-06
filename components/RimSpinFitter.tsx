"use client"

import { useEffect } from "react"

/**
 * Keeps every spinning silver rim (`.rim-spin`) only as big as it needs to be.
 *
 * The rims are a conic gradient on a square that rotates behind a card, shown
 * through the card's thin padding band. The square used to be `w-[300%]` of
 * the card's width (so it covered a tall card's corners while turning) - on a
 * wide feed card that is a 7,700 px square, and a feed of them plus a popup
 * came to ~200 megapixels of animated GPU layers (~1.8 GB at 1.5x display
 * scaling). Chrome ran out of tile memory and kept dropping and re-drawing
 * tiles: parts of the page flickered, even while nothing changed (2026-10-06).
 *
 * A conic gradient's colour depends only on the angle from its centre, so a
 * square exactly as wide as the card's DIAGONAL covers it at every angle and
 * looks identical - 5-7x less area on a wide card. This sizes each one to its
 * parent's diagonal and follows the parent's size (ResizeObserver); new rims
 * are picked up as they mount (MutationObserver). Mounted once in the root
 * layout, so every page's rims (portal, shop, age gate, dataset) get it.
 */
export function RimSpinFitter() {
  useEffect(() => {
    const parents = new Map<Element, Set<HTMLElement>>()
    const size = (spin: HTMLElement, p: Element) => {
      const d = Math.ceil(Math.hypot(p.clientWidth, p.clientHeight)) + 4
      if (d < 8) return
      const px = `${d}px`
      if (spin.style.width !== px) { spin.style.width = px; spin.style.height = px }
    }
    const ro = new ResizeObserver(entries => {
      for (const e of entries) for (const s of parents.get(e.target) ?? []) size(s, e.target)
    })
    const track = (spin: HTMLElement) => {
      const p = spin.parentElement
      if (!p) return
      let set = parents.get(p)
      if (!set) { set = new Set(); parents.set(p, set); ro.observe(p) }
      set.add(spin)
      size(spin, p)
    }
    const untrack = (spin: HTMLElement) => {
      const p = spin.parentElement
      const set = p ? parents.get(p) : undefined
      if (!p || !set) return
      set.delete(spin)
      if (!set.size) { parents.delete(p); ro.unobserve(p) }
    }
    const each = (n: Node, fn: (s: HTMLElement) => void) => {
      if (!(n instanceof HTMLElement)) return
      if (n.classList.contains("rim-spin")) fn(n)
      n.querySelectorAll<HTMLElement>(".rim-spin").forEach(fn)
    }
    document.querySelectorAll<HTMLElement>(".rim-spin").forEach(track)
    const mo = new MutationObserver(ms => {
      for (const m of ms) {
        m.removedNodes.forEach(n => each(n, untrack))
        m.addedNodes.forEach(n => each(n, track))
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { mo.disconnect(); ro.disconnect(); parents.clear() }
  }, [])
  return null
}
