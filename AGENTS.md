# AGENTS.md — AI Design Studio

Guidance for AI coding agents working in this repo. Read this before making changes.

## What this is

A Next.js **App Router** web app (AI image/video generation studio) with user accounts,
a ticket/credit economy, payments, and a background generation queue. Deployed on Vercel.

## Stack

- **Next.js 16.1.1** (App Router, React Server Components) · **React 19.2** · **TypeScript** (`strict: true`)
- **Tailwind CSS v4** — CSS-based config, there is **no `tailwind.config.js`**. Theme tokens and
  variants live in `app/globals.css` (`@theme`, `@custom-variant dark`). Edit CSS there, not a JS config.
- **shadcn/ui** (style: new-york, base: slate) over **Radix UI**. Primitives live in `components/ui/`.
  Compose classes with `cn()` from `@/lib/utils` (clsx + tailwind-merge); variants via `class-variance-authority`.
- **Prisma 6 + PostgreSQL + Prisma Accelerate**. Media/AI via Vercel AI SDK v7 (`ai@7`, `@ai-sdk/*`),
  `@fal-ai/client`, `replicate`, Google/Vertex. Storage: Cloudflare R2 (`@aws-sdk/client-s3`) + Vercel Blob.
- Package manager: **npm** (`package-lock.json`).

## Commands

- **Dev**: `npm run dev` → http://localhost:3000
- **Verify a change**: `npm run build` — this runs `prisma generate --no-engine && next build` and is the
  de-facto **type + lint gate**. Always run it after non-trivial changes.
- **Lint**: `npm run lint` · **Typecheck only**: `npx tsc --noEmit`
- **Prisma**: `npx prisma migrate dev` (new migration) · `npx prisma generate` · `npx prisma studio`
- **There is no test suite.** Do not invent one or add test tooling unless asked. Verify via `npm run build`
  and by exercising the dev server.

## Layout

- `app/` — routes (App Router). Pages are `page.tsx`; layouts `layout.tsx`. Root layout is `app/layout.tsx`.
- `app/api/**/route.ts` — ~229 route handlers. They import `prisma` from `@/lib/prisma`, auth helpers from
  `@/lib/api-key-auth`, storage from `@/lib/r2`, and model config from `@/config/ai-models.config`.
  Auth is enforced per-route (defense-in-depth alongside `middleware.ts`).
- `components/` — shared React components. `components/ui/` — shadcn primitives (add new ones here).
- `lib/` — server logic and utilities: `prisma.ts`, auth (`auth.ts`, `admin-auth.ts`, `api-key-auth.ts`),
  the generation queue (`queue-worker.ts`, `fal-queue.ts`), storage (`r2.ts`), `utils.ts` (`cn()`).
- `config/` — `ai-models.config.ts` (model registry + ticket costs; `getModelById`, `getTicketCost`) and
  `subscription-plans.config.ts`.
- `prisma/` — `schema.prisma` + `migrations/`.
- `middleware.ts` — gates `/admin/*` page routes on a `session` cookie.

## Conventions

- **Import alias**: `@/*` maps to the project root. Use `@/lib/...`, `@/components/...`, `@/config/...`.
- **Prisma access**: use the `prisma` singleton for normal queries. Use **`prismaDirectDb`** (also from
  `@/lib/prisma`) for large payloads (canvas layers, base64) that exceed Accelerate's ~5MB response cap.
- **Styling**: Tailwind utilities composed via `cn()`; component variants via `class-variance-authority`.
  For dark mode use the `dark:` variant (wired through `@custom-variant dark` in `globals.css`).
- **Server config**: `next.config.ts` sets `serverActions.bodySizeLimit: '50mb'` (large image uploads) and an
  `images.remotePatterns` allowlist — add new external image hosts there.
- Match the existing **detailed-comment style** — explain non-obvious decisions.
- The generation queue is documented in `QUEUE_SYSTEM_GUIDE.md` (relates to `lib/queue-worker.ts`,
  `lib/fal-queue.ts`, `/api/cron/drain-queue`, `/api/queue`). Read it before touching generation flow.

## Guardrails

- **Edit only the canonical sources**: `app/`, `components/`, `lib/`, `config/`, `prisma/`.
- **Never edit** `*.backup` / `*.old` / `*-legacy*` files, root-level throwaway scripts
  (e.g. `delete-echo.js`, `test-*.js`), or the `AI/` directory (a separate Python/ML worker subtree).
- **Secrets** live in `.env.local` (gitignored) — there is no `.env.example`. Never print, log, or commit
  secret values. Required env includes: `DATABASE_URL`, `PRISMA_DATABASE_URL`, `APP_URL`, `ADMIN_PASSWORD`,
  `FAL_KEY`, `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, R2 keys (`R2_*`), `BLOB_READ_WRITE_TOKEN`, and payment
  keys (PayPal / LemonSqueezy). If a change needs a new env var, add it to `.env.local` and note it here.
- **Database migrations** change production data — propose the schema change and the `prisma migrate` command,
  don't run destructive migrations unprompted.
- Deployment is on **Vercel** (`vercel.json` defines a per-minute cron → `/api/cron/drain-queue`). Changing
  code does not deploy; deploying is a separate, explicit step.
