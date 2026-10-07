/**
 * Which Employees are released to everyone, and which are still admin-only.
 *
 * One flag per employee, so they ship one at a time as each is finished and
 * priced. The Employees picker shows an admin-only employee to admins alone,
 * with a red "Admin model" badge, and the taskbar's Employees entry appears
 * for everyone as soon as any one of them is released.
 *
 * Deliberately a plain module, not the client component, so server routes can
 * import the same flags. Releasing an employee here opens its UI; the routes
 * its workspace calls are gated separately (the chat-hub routes for Movie
 * Studio, Face Swap and Character Design, /api/admin/threed for 3D Studio,
 * /api/admin/frames-clips for Frames, /api/employees/storyboards for
 * Storyboard, /api/employees/image-studio for Image Studio) and must be
 * opened with it.
 */
export type EmployeeId = "movie-studio" | "face-swap" | "character-design" | "3d-studio" | "frames" | "storyboard" | "image-studio"

export const EMPLOYEE_ADMIN_ONLY: Record<EmployeeId, boolean> = {
  "movie-studio": true,
  "face-swap": true,
  "character-design": true,
  "3d-studio": true,
  "frames": false, // public 2026-10-07 - the Frame Extractor
  // Public 2026-10-07: stills, cuts and shots are charged; public moderation
  "storyboard": false,
  // Public 2026-10-07: AI tools charged + public moderation; layer management is Dev Tier
  "image-studio": false,
}

export const EMPLOYEE_IDS = Object.keys(EMPLOYEE_ADMIN_ONLY) as EmployeeId[]

export function isEmployeeId(v: unknown): v is EmployeeId {
  return typeof v === "string" && (EMPLOYEE_IDS as string[]).includes(v)
}

/** Can this account open this employee? */
export function employeeVisibleTo(id: EmployeeId, isAdmin: boolean): boolean {
  return isAdmin || !EMPLOYEE_ADMIN_ONLY[id]
}

/** True once at least one employee is released to everyone. */
export const ANY_PUBLIC_EMPLOYEE = EMPLOYEE_IDS.some(id => !EMPLOYEE_ADMIN_ONLY[id])
