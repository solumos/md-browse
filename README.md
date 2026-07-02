# Markdown Browser

A small, fast desktop web browser that requests pages with an
`Accept: text/markdown` header and renders the result as clean, readable markdown.

When a site honors content negotiation it serves markdown directly; for the ~85%
of the web that doesn't, the page's HTML is converted to markdown on the fly
(Mozilla Readability extracts the main content, Turndown converts it).

Built with **Tauri 2** (Rust shell) + **React + TypeScript** (UI). The network
request happens natively in Rust, so there's no CORS limitation and the `Accept`
header is fully under our control.

## Features

- Address bar with URL normalization (`example.com` → `https://example.com`)
- Native `Accept: text/markdown` content negotiation, with automatic
  HTML → Markdown fallback
- Markdown rendering with GFM (tables, task lists, strikethrough) via
  `react-markdown` (no raw HTML / `dangerouslySetInnerHTML`, so it's XSS-safe)
- **Working forms.** Each `<form>` is preserved through conversion (serialized
  into a fenced ` ```md-form ` block) and rendered as a real form — text fields,
  selects, checkboxes, radios, textareas. GET forms submit as an in-app
  navigation (site search boxes work); POST forms submit an urlencoded body.
- **Sessions.** The Rust HTTP client keeps a persistent, disk-backed cookie jar
  (a `tauri-plugin-http` default), so logging in via a plain HTML form
  establishes a real session that survives restarts — votes, replies, and other
  logged-in actions work on sites like Hacker News.
- **Mainstream history semantics.** Back/forward restore pages from an in-memory
  cache (never re-requesting, so traversal never re-POSTs a form); a redirected
  POST (Post/Redirect/Get) becomes a plain GET of the result page; reloading a
  page that came from a non-redirected form submission asks "Confirm form
  resubmission" first.
- **Submission safeguards.** Because the cookie jar can't enforce SameSite,
  submitting a form to a *different* site (a CSRF surface) or a password over
  plain HTTP asks for confirmation first. Forms only go live on pages we
  converted from HTML — a site served as markdown can't hand-forge one.
- Standalone buttons/inputs outside any form (JS-driven UI) appear as inert
  `[ label ]` badges instead of being silently dropped
- In-app link navigation (relative links resolved to absolute), with
  Back / Forward / Reload history
- Loading, error, and empty states; light & dark themes
- Content-Security-Policy locked to the app bundle — remote pages can only
  contribute text and images, never scripts or styles
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
| `src/lib/forms.ts` | Form preservation: `<form>` → JSON spec → ` ```md-form ` block, and submit-URL building |
| `src/lib/url.ts` | URL normalization / validation / resolution |
| `src/lib/browser.ts` | `loadPage()` — normalize → fetch → convert |
| `src/hooks/useHistoryStack.ts` | In-memory back/forward history |
| `src/components/` | Address bar, nav controls, markdown view, rendered forms, status/welcome screens |
| `tests/` | Unit tests for the conversion pipeline and form preservation |

## Known limitations

- **No JavaScript execution.** Single-page apps and pages that build their
  content client-side will show little or nothing; the browser detects this and
  explains it rather than rendering a blank page. Buttons that need JS are shown
  but inert. This includes **JS-driven logins** (OAuth popups, SPA login flows) —
  only plain HTML form logins work.
- **File uploads don't submit** (multipart forms aren't supported yet).
- Conversion fidelity is inherently imperfect for complex layouts (merged-cell
  tables, heavily styled pages).
