"use client"

/*
 * Image Studio - the button every AI tool runs from: the site's BrandButton
 * (silver on glass, the synced logo in its spinning ring - the mark every
 * generate button on the site wears), with the price in tickets and the exact
 * model it runs. `model` shows under the button, or inside it (`inline`) where
 * a one-line bar has no room under it.
 */
import { Ticket } from "lucide-react"
import { BrandButton } from "@/components/employees/StudioBrand"

export function TicketChip({ n }: { n: number }) {
  return (
    <span className="ml-0.5 inline-flex items-center gap-0.5 rounded-md border border-white/10 bg-black/35 px-1 py-px font-mono text-[9.5px] font-semibold text-slate-200">
      <Ticket size={9} className="text-slate-400" />{n}
    </span>
  )
}

export function AiButton({ onClick, busy, disabled, cost, model, inline, primary, size = "sm", title, className = "", children }: {
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  cost: number
  /** the model this runs ("FLUX.1 Pro Fill") */
  model?: string
  /** the model inside the button (one-line bars) rather than under it */
  inline?: boolean
  primary?: boolean
  size?: "xs" | "sm" | "md"
  title?: string
  className?: string
  children: React.ReactNode
}) {
  const button = (
    <BrandButton onClick={onClick} busy={busy} disabled={disabled || busy} primary={primary} size={size} title={title ?? (model ? `Runs ${model}` : undefined)} className={inline ? `shrink-0 ${className}` : className}>
      {children}
      {inline && model && <span className="font-medium text-slate-400">· {model}</span>}
      <TicketChip n={cost} />
    </BrandButton>
  )
  if (inline || !model) return button
  return (
    <span className={`inline-flex flex-col items-start gap-0.5 ${className.includes("w-full") ? "w-full" : ""}`}>
      {button}
      <span className="pl-0.5 text-[9px] font-mono uppercase tracking-[0.12em] text-slate-500">{model}</span>
    </span>
  )
}
