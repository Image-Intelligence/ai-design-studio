"use client"

// The portal's animated silver rim, as a drop-in overlay: masked to a thin band
// hugging the card edge (same treatment as the prompt card / popup rings), so
// cards keep their existing layout — just render this inside any relative,
// rounded, overflow-hidden root.
export const SILVER_RIM_CONIC =
  "conic-gradient(from 0deg, rgba(226,232,240,0.1), #f8fafc, #94a3b8, rgba(226,232,240,0.15), #cbd5e1, #64748b, rgba(226,232,240,0.1))"

export function SilverRimOverlay({ rounded = "rounded-2xl" }: { rounded?: string }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 ${rounded} overflow-hidden pointer-events-none z-30`}
      style={{
        padding: "1.5px",
        WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
        WebkitMaskComposite: "xor",
        mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
        maskComposite: "exclude",
      } as React.CSSProperties}
    >
      <span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 aspect-square w-[300%] animate-spin"
        style={{ background: SILVER_RIM_CONIC, animationDuration: "5s" }}
      />
    </div>
  )
}
