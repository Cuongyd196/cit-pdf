# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BentoPDF is a client-side PDF toolkit: every tool runs in the browser, no server processing. It is a **multi-page Vite app in vanilla TypeScript** (no UI framework; Tailwind v4, Handlebars partials), not an SPA. This checkout additionally carries an in-progress **Electron desktop wrapper** (`desktop/`, `src/js/desktop/`, `scripts/build-desktop.mjs`, `electron-builder.json`, `DESKTOP.md`) that is not yet committed.

Licence is AGPL-3.0 with a commercial dual licence; contributions require a signed CLA (`ICLA.md` / `CCLA.md`).

## Commands

```bash
npm run dev                 # Vite dev server, http://localhost:5173
npm run test:run            # Vitest, single pass (npm test = watch-capable CLI)
npx vitest run src/tests/rotate-pdf-page.test.ts   # one file
npx vitest run -t "name of the test"           # one test by name
npm run test:coverage       # 80% thresholds enforced
npx tsc --noEmit            # typecheck (CI runs this before tests)
npm run lint                # eslint; lint:fix to autofix
npm run format              # prettier --write .
npm run security:audit      # npm audit + lint:security + security-patterns-check
npm run docs:dev            # VitePress docs in docs/

npm run desktop             # build desktop bundle and launch Electron
npm run desktop:build       # build only (dist/ -> desktop/dist-web, desktop/src -> desktop/dist)
npm run desktop:dist        # + electron-builder --win  -> release/
npm run desktop:dist:all    # + electron-builder -mwl
```

- CI (`.github/workflows/tests.yml`) runs `npx tsc --noEmit` then `npm run test:run` on Node 20. Lint is not in CI; it runs via husky `lint-staged` on commit (eslint --fix + prettier).
- **Windows caveat:** `npm run build` and the `build:*` / `serve*` scripts use POSIX inline env syntax (`NODE_OPTIONS='…' node …`, `COMPRESSION_MODE=g npm run build`) and do not work under cmd/PowerShell. Use Git Bash/WSL, or run the steps individually. The `desktop*` scripts are cross-platform because `scripts/build-desktop.mjs` sets env vars itself and calls `npx vite build` directly.
- `npm run build` is a long pipeline, not just `vite build`: generate blog → generate static tool links → `tsc` → `vite build` → SEO enhancement → per-language static pages → sitemap → security headers → SEO audit. `build:docker` and the desktop build run plain `vite build` and skip the rest.
- `vitest.config.ts` is the effective test config (jsdom, globals, `src/tests/setup.ts`, includes `src/**/*.{test,spec}.{js,ts}`); the `test` block in `vite.config.ts` is shadowed by it.

## Architecture

### One HTML entry per tool

Each tool is its own page: `src/pages/<tool>.html` + `src/js/logic/<tool>-page.ts`. The HTML pulls in shared chrome via Handlebars partials (`{{> navbar }}`, `{{> footer }}` from `src/partials/`) and loads, as separate module scripts, its page logic plus `src/js/main.ts` (shared init: i18n, runtime config, disabled-tool gate, simple-mode tweaks). Marketing pages (`index.html`, `about.html`, hub pages, `blog/`) live at the repo root.

Adding a tool touches several places that are not linked by the type system:

1. `src/pages/<tool>.html` and `src/js/logic/<tool>-page.ts`
2. `build.rollupOptions.input` in `vite.config.ts` — the entry list is hand-maintained; a page missing here works in dev but is absent from the build
3. `src/js/config/tools.ts` — the category/tool registry that drives the home grid and search
4. `public/locales/en/tools.json` (and other locales) for the `tools:<key>.name/subtitle` strings

`flattenPagesPlugin` moves built `src/pages/*.html` to the dist root, so tool URLs are `/<tool>.html` (clean URLs `/<tool>` handled by routing middleware / host rewrites). Always build links with `import.meta.env.BASE_URL` — subdirectory deployment (`BASE_URL=/x/`) is supported and `rewriteHtmlPathsPlugin` rewrites absolute `href`/`src` in HTML.

### Build-time flags

`vite.config.ts` injects globals declared in `src/types/globals.d.ts`:

| Global | Source env | Effect |
| --- | --- | --- |
| `__SIMPLE_MODE__` | `SIMPLE_MODE=true` (forced on for desktop) | Uses `simple-index.html` as the index, hides marketing/branding |
| `__DESKTOP__` | `VITE_DESKTOP=true` | Electron build: no service worker, no gzip/brotli copies, blog and web-only pages dropped from inputs (`WEB_ONLY_ENTRIES`) |
| `__DISABLED_TOOLS__` | `DISABLE_TOOLS=a,b` | Tools hidden/blocked (also overridable at runtime via `public/config.json`, see `utils/disabled-tools.ts`) |
| `__DISABLE_GITHUB_STARS__`, `__BRAND_NAME__` | `DISABLE_GITHUB_STARS`, `VITE_BRAND_*`, `VITE_FOOTER_TEXT` | Branding |
| `__ENGINE_VERSION__` | hash of `node_modules/bentopdf-pdfium` | Cache-busting for the edit engine |

`VITE_USE_CDN`, `VITE_WASM_*_URL`, `VITE_CORS_PROXY_URL`, `VITE_TESSERACT_*` configure where heavy assets load from; see `.env.example`.

### PDF engines and lazy WASM

Light operations use `pdf-lib` / `pdfjs-dist` directly. Heavy engines are AGPL WASM packages loaded at runtime, never bundled:

- **PyMuPDF**, **Ghostscript**, **CoherentPDF (cpdf)** — base URLs resolved by `src/js/utils/wasm-provider.ts` (user override in localStorage → `VITE_WASM_*_URL` → jsDelivr defaults; URLs are host-allowlisted). Loaded through `utils/pymupdf-loader.ts`, `ghostscript-loader.ts`, `ghostscript-dynamic-loader.ts`, `cpdf-helper.ts`.
- **LibreOffice** (`utils/libreoffice-loader.ts`, assets in `public/libreoffice-wasm/`) for Office → PDF.
- **PDFium edit engine** — `bentopdf-pdfium` and `bentopdf-viewer` are installed from tarballs in `vendor/`; `src/js/editcore/` (plain JS, relaxed lint rules) drives in-place text editing.

SharedArrayBuffer-based engines need cross-origin isolation, so dev/preview servers, `nginx.conf`, and the Electron protocol handler all send `COOP: same-origin` + `COEP: require-corp`. Any new way of serving the app must do the same.

### Desktop (Electron)

- `desktop/src/main.ts` — single-instance window loading `app://bentopdf/index.html`; external links go to the OS browser.
- `desktop/src/protocol.ts` — custom privileged `app://` scheme serving `desktop/dist-web`, replicating clean-URL and `/<lang>/…` fallbacks and the COOP/COEP headers. It first asks `ModulesManager.resolveMountedFile`, so `/modules/<name>/…` and `/libreoffice-wasm/…` are served from installed modules.
- `desktop/src/modules-manager.ts` + `desktop/app/modules-manifest.json` — heavy engines are **not in the installer**. On first use they are downloaded from the npm registry / upstream repo, hash-verified (SHA-512 integrity or per-file SHA-256), and cached in `userData/modules`. cpdf is pre-bundled in `desktop/bundled-modules/`.
- `desktop/src/preload.ts` exposes `window.bentoDesktop`; `src/js/desktop/bridge.ts` wraps it. The web-side contract is: **each WASM loader calls `await ensureDesktopModules([...])` before fetching engine files** (a no-op on the web). In desktop builds `wasm-provider.ts` points defaults at `/modules/<name>/` instead of the CDN. A new heavy engine needs a manifest entry, a mount, and that call in its loader.
- The desktop build is branded **CIT-PDF** (defaults set in `scripts/build-desktop.mjs`: `VITE_BRAND_NAME`, `VITE_BRAND_LOGO`, `VITE_DEFAULT_LANGUAGE=vi`). The upstream name stays in page titles/locales; `main.ts` rewrites window titles.
- Desktop UI shell: when the Handlebars context has `desktop`, `navbar-simple`/`footer-simple` render `partials/desktop-sidebar.html` and `desktop-statusbar.html` instead. `src/js/desktop/shell.ts` (dynamically imported from `src/js/main.ts` under `__DESKTOP__`) fills the sidebar (search, favorites, recent, tool groups) and handles files opened from the OS: it injects them into the tool page's `#file-input`. Desktop-only strings live in `src/js/desktop/strings.ts` (vi/en), not in the locale files. Desktop-only pages `cit-about.html` and `cit-settings.html` sit at the repo root.
- Icons are rendered from `public/images/cit-pdf-logo.svg` by `npx electron scripts/generate-desktop-icons.mjs`; the PNG outputs are committed.
- Inside VS Code terminals `ELECTRON_RUN_AS_NODE=1` is set, which makes `electron` run as plain Node (imports from `'electron'` fail). Unset it before launching Electron.
- `desktop/dist/`, `desktop/dist-web/`, and `release/` are build output (gitignored). `desktop/` has its own `tsconfig.json` (NodeNext) and `package.json` (`electron-builder` uses `desktop/` as the app dir).

### i18n

i18next with two namespaces, `common` and `tools`, in `public/locales/<lang>/`. HTML uses `data-i18n="key"` / `data-i18n="tools:mergePdf.name"`; TS uses `t()` from `src/js/i18n`. Language is a URL prefix (`/de/merge-pdf`); `languageRouterPlugin` handles this in dev/preview and `scripts/generate-i18n-pages.mjs` emits static per-language pages at build. The supported-language list is duplicated in `vite.config.ts` (`SUPPORTED_LANGUAGES`) and `src/js/i18n/i18n.ts` (`supportedLanguages`) — keep them in sync. `node scripts/check-translations.js` reports missing keys; full procedure in `TRANSLATION.md`.

### Other subsystems

- `src/js/workflow/` — Rete.js node editor for the PDF Workflow Builder; nodes in `workflow/nodes/`.
- `src/js/compare/` — PDF compare engine and reporting.
- `src/js/utils/` — shared helpers; `public/workers/` and `src/js/pdf.worker.ts` hold web workers.
- `cloudflare/` — CORS proxy worker used by digital signing/timestamping (dev server emulates it at `/cors-proxy?url=` with a host allowlist).
- `chart/`, `Dockerfile*`, `nginx.conf`, `vercel.json`, `.htaccess` — deployment targets; `scripts/generate-security-headers.mjs` produces CSP for them.

## Conventions

- Path aliases: `@/` → `src/`, `@/types` → `src/js/types/index.ts`. Relative imports use `.js` extensions for `.ts` sources.
- TypeScript is non-strict except `noImplicitAny: true`.
- `innerHTML` with interpolated values trips `no-unsanitized` (warn in lint, error in `lint:security`); use `escapeHtml` from `utils/helpers.ts`, DOMPurify, or DOM APIs.
- Use `utils/safe-storage.ts` rather than raw `localStorage`.
- Tests live in `src/tests/*.test.ts` with fixtures/builders under `src/tests/helpers/`.
- Releases go through `npm run release[:minor|:major]` (`scripts/release.js`, see `RELEASE.md`); pushing a `v*` tag triggers `.github/workflows/desktop-release.yml`.
