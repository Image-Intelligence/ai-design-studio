"use client"

import { memo, useMemo } from "react"
import { Marked } from "marked"

/*
 * Nova's replies as markdown (2026-10-18). Same rules as the Chat Hub's
 * renderer (components/chat-hub.tsx): raw HTML in model text is escaped, and
 * markdown images become links - real media renders from the message's steps,
 * and a hallucinated src would draw a broken box. Links only open http(s) and
 * mailto, so a model can never write a javascript: link into the page.
 */
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

const safeHref = (href: string) => (/^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : "")

const engine = new Marked({ gfm: true, breaks: true })
engine.use({
  renderer: {
    html(token: any) {
      const raw = typeof token === "string" ? token : (token?.text ?? token?.raw ?? "")
      return escapeHtml(String(raw))
    },
    image(token: any) {
      const href = safeHref(String(token?.href ?? ""))
      const label = escapeHtml(String(token?.text || token?.title || "image link"))
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>` : label
    },
    link(token: any) {
      const href = safeHref(String(token?.href ?? ""))
      const text = this.parser.parseInline(token.tokens ?? [])
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${text}</a>` : text
    },
  } as any,
})

function render(text: string): string {
  try { return engine.parse(text, { async: false }) as string } catch { return escapeHtml(text).replace(/\n/g, "<br/>") }
}

export const NovaMarkdown = memo(function NovaMarkdown({ text }: { text: string }) {
  const html = useMemo(() => render(text), [text])
  return <div className="chat-md text-[13.5px] leading-relaxed text-slate-200 break-words" dangerouslySetInnerHTML={{ __html: html }} />
})
