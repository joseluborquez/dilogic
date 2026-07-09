# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project context

This app is **Dilogic — Automatización de Guías de Despacho**: Dilogic SPA (food logistics for salmon farming) currently generates ~25k dispatch documents/year by hand-typing SKU + quantity into Relbase's web UI, per client order Excel. This app replaces that: an operator uploads an Excel/CSV of an already-cleaned order, the app validates it against a per-company product catalog, and on explicit confirmation creates the guides via the Relbase API.

The full PRD lives one directory up: `../PRD_Dilogic_Automatizacion.md (1).pdf`. Read it before implementing any Relbase integration or data-model work — it is the source of truth for business rules. Key constraints from it that shape the architecture:

- **Three client companies**, each with its own product catalog and its own Relbase `company` token: `CERQ` (Cermaq), `MTX` (Multiexport), `YDR` (Yadran). Codes/names to seed `productos_catalogo` come from `../CODIGOS DILOGIC.xlsx` (one sheet per company, clean sequential SKUs, no duplicates — treat as source of truth). `../SOLICITUD CERMAQ.xlsx` is only a sample of a raw customer order file, useful for shaping the upload parser — it is *not* a clean catalog (the same SKU maps to different products across its own sheets).
- **Validation must never write to Relbase.** Only `GET` calls (e.g. `/api/v1/productos`) are allowed during the preview/validation step. Guide creation (`POST /api/v1/dtes`, `type_document: 52`) only happens after an explicit user confirmation — these are SII electronic tax documents and cannot be created "by accident."
- **Products are matched by Relbase's numeric `product_id`, not by the SKU Hugo uses.** Maintain a `sku -> product_id` mapping per company, synced via `GET /api/v1/productos` (paginated, 12/page).
- **Rate limit: 7 req/s** on the Relbase v1 API. Any batch generation must throttle and use backoff on 403. Because Vercel serverless functions have execution time limits, generate guides in small batches driven by repeated client calls (not one long-running request), persisting progress after each row so retries never re-create an already-folioed guide.
- **Relbase credentials (`token_empresa`, `token_usuario_integrador`) belong in the database** (`credenciales_relbase` table, encrypted) or environment variables — never hardcoded, never in the frontend bundle, never committed. Adding a new client company must be possible without a code change.
- Interface language is Spanish; the primary user (Hugo) is non-technical — prioritize clarity over advanced functionality.

## Commands

```bash
npm run dev      # start dev server (Turbopack) at localhost:3000
npm run build    # production build
npm run start    # run the production build
npm run lint     # eslint (flat config: eslint-config-next core-web-vitals + typescript)
```

No test runner is configured yet.

## Architecture

- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript** (strict), **Tailwind CSS v4**. Source lives under `src/app`; import alias `@/*` → `src/*`.
- ⚠️ Next.js 16 postdates most training data — its APIs/conventions may differ from what you expect. Check `node_modules/next/dist/docs/` before writing framework-specific code (routing, data fetching, config), per `AGENTS.md`.
- No backend/data layer exists yet. Per the PRD, the intended stack is **Supabase (Postgres)** for `empresas`, `credenciales_relbase`, `productos_catalogo`, `corridas`, `guias_generadas`, with all Relbase calls made server-side (Next.js route handlers / server actions), and **Vercel** for hosting — deploy must fit within Supabase/Vercel free-tier limits.

## Skills

Installed under `.agents/skills/` (symlinked for Claude Code):

- **frontend-design** — use when building or reshaping any UI screen (upload, validation preview, generation, history) to get a considered visual identity rather than templated defaults.
- **vercel-react-best-practices** — 70 categorized performance rules (`rules/`) for React/Next.js; consult when writing or reviewing data fetching, bundling, or rendering code.
- **find-skills** — use to discover/install additional skills when a task calls for capability not already covered here.
