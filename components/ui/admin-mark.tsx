import { cn } from "@/lib/utils"

/*
 * Admin-only features are RED (2026-10-20, owner: "make that button red along
 * with any other admin features, they should be marked as such accordingly so
 * I can keep track of them all"). One look everywhere, so a red control always
 * means "only admin accounts see this":
 *
 * - ADMIN_BUTTON  a button / chip / toggle that only admins get (the feed
 *   viewer's Live, batch mode, safety switches, news editing...). Use it in
 *   place of the control's own colours; keep its size and layout classes.
 * - ADMIN_TEXT    a label, heading or menu row that is admin-only.
 * - ADMIN_BORDER  a panel, card or section that is admin-only as a whole.
 * - <AdminTag />  the small red "Admin" chip, beside a title or menu entry
 *   (the admin model menus started it).
 *
 * A feature behind a site-wide admin switch (PRISM_ADMIN_ONLY,
 * CONNECTOR_ADMIN_ONLY, admin-only models and studios) is marked while that
 * switch keeps it admin-only - once it goes public the red comes off with it.
 */

export const ADMIN_BUTTON = "border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:border-red-500/60"
export const ADMIN_TEXT = "text-red-300"
export const ADMIN_BORDER = "border-red-500/35"

export function AdminTag({ className, label = "Admin" }: { className?: string; label?: string }) {
  return (
    <span title="Only admin accounts see this"
      className={cn("shrink-0 inline-flex items-center px-1 py-px rounded bg-red-500/15 border border-red-500/30 text-[8px] font-bold uppercase tracking-wider text-red-300 leading-tight", className)}>
      {label}
    </span>
  )
}
