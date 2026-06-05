# Markdown Browser

A small, fast desktop web browser that requests pages with an
`Accept: text/markdown` header and renders the result as clean, readable markdown.

When a site honors content negotiation it serves markdown directly; for the ~85%
of the web that doesn't, the page's HTML is converted to markdown on the fly
(Mozilla Readability extracts the main content, Turndown converts it).

Built with **Tauri 2** (Rust shell) + **React + TypeScript** (UI). The network
request happens natively in Rust, so there's no CORS limitation and the `Accept`
header is fully under our control.

## Features (v1 — simple browsing)

- Address bar with URL normalization (`example.com` → `https://example.com`)
- Native `Accept: text/markdown` content negotiation, with automatic
  HTML → Markdown fallback
- Markdown rendering with GFM (tables, task lists, strikethrough) via
  `react-markdown` (no raw HTML / `dangerouslySetInnerHTML`, so it's XSS-safe)
- In-app link navigation (relative links resolved to absolute), with
  Back / Forward / Reload history
- Loading, error, and empty states; light & dark themes
- Keyboard: ⌘L focus address bar · ⌘[ back · ⌘] forward

## Develop

```bash
npm install
npm run tauri dev      # launch the desktop app (hot-reloaded)
```

## Test

```bash
npm test               # vitest — unit tests for the conversion pipeline
npx tsc --noEmit       # typecheck
```

## Build a distributable app

```bash
npm run tauri build    # produces a .app / .dmg under src-tauri/target/release/bundle
```

## Architecture

| Path | Role |
| --- | --- |
| `src-tauri/` | Rust shell; registers `tauri-plugin-http` (native fetch, no CORS) |
| `src/lib/fetchPage.ts` | Native fetch with the `Accept` header, timeout, size cap |
| `src/lib/convert.ts` | Content negotiation + Readability→Turndown HTML→markdown pipeline |
| `src/lib/url.ts` | URL normalization / validation / resolution |
| `src/lib/browser.ts` | `loadPage()` — normalize → fetch → convert |
| `src/hooks/useHistoryStack.ts` | In-memory back/forward history |
| `src/components/` | Address bar, nav controls, markdown view, status/welcome screens |
| `tests/convert.test.ts` | Unit tests for the conversion pipeline |

## Known limitations (v1)

- **No JavaScript execution.** Single-page apps and login-gated pages that build
  their content client-side will show little or nothing; the browser detects this
  and explains it rather than rendering a blank page.
- Conversion fidelity is inherently imperfect for complex layouts (merged-cell
  tables, heavily styled pages).
