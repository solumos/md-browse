import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { AddressBar } from "./components/AddressBar";
import { NavControls } from "./components/NavControls";
import { MarkdownView } from "./components/MarkdownView";
import { ErrorView, LoadingView } from "./components/StatusView";
import { ResubmitDialog } from "./components/ResubmitDialog";
import { Welcome } from "./components/Welcome";
import { useHistoryStack, type HistoryEntry } from "./hooks/useHistoryStack";
import { loadPage } from "./lib/browser";
import { normalizeUrl } from "./lib/url";
import { PageError, toPageError, type PageResult } from "./lib/types";

type Status = "idle" | "loading" | "ready" | "error";

function App() {
  const history = useHistoryStack();
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<PageResult | null>(null);
  const [error, setError] = useState<PageError | null>(null);
  const [address, setAddress] = useState("");
  const [dark, setDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  const reqId = useRef(0);
  /** Per-entry page cache: back/forward restore from here (bfcache-style). */
  const cache = useRef(new Map<number, PageResult>());
  /** Entries that have fetched at least once — refetching a POST one prompts. */
  const loadedOnce = useRef(new Set<number>());
  const lastHandled = useRef("");
  const seenNonce = useRef(0);
  const [resubmit, setResubmit] = useState<{
    entry: HistoryEntry;
    cleared: boolean;
  } | null>(null);

  const load = useCallback(
    async (entry: HistoryEntry) => {
      const id = ++reqId.current;
      setStatus("loading");
      setError(null);
      try {
        const page = await loadPage(entry);
        if (reqId.current !== id) return; // a newer navigation superseded this one
        loadedOnce.current.add(entry.id);
        cache.current.set(entry.id, page);
        while (cache.current.size > 50) {
          const oldest = cache.current.keys().next().value;
          if (oldest === undefined) break;
          cache.current.delete(oldest);
        }
        setResult(page);
        setAddress(page.finalUrl);
        setStatus("ready");
        // Post/Redirect/Get: once a POST lands on a redirected page, demote the
        // entry to a plain GET of that URL, so reload/back re-GET (no re-POST,
        // no resubmission prompt) — exactly what mainstream browsers do.
        if (entry.post && page.finalUrl !== entry.url) {
          history.replace({ url: page.finalUrl });
        }
      } catch (e) {
        if (reqId.current !== id) return;
        setError(toPageError(e));
        setStatus("error");
      }
    },
    [history],
  );

  // Drive loads from history. Back/forward (current changes, nonce doesn't)
  // restore from cache without re-requesting — so traversal never re-POSTs.
  // Reload (nonce bump) refetches; refetching a POST result asks first, the
  // way mainstream browsers confirm form resubmission.
  const { current, nonce } = history;
  useEffect(() => {
    if (!current) return;
    const key = `${current.id}:${nonce}`;
    if (lastHandled.current === key) return; // re-render / StrictMode re-run
    lastHandled.current = key;
    const isReload = nonce !== seenNonce.current;
    seenNonce.current = nonce;
    setResubmit(null);

    if (!isReload) {
      const cached = cache.current.get(current.id);
      if (cached) {
        reqId.current++; // supersede any in-flight load
        setResult(cached);
        setAddress(cached.finalUrl);
        setError(null);
        setStatus("ready");
        return;
      }
    }
    if (current.post && loadedOnce.current.has(current.id)) {
      if (!isReload) {
        // Traversal to a POST page whose cached result is gone (evicted): there's
        // no page to show, so clear the stale one instead of overlaying the prompt.
        reqId.current++;
        setResult(null);
        setError(null);
        setAddress(current.url);
        setStatus("loading");
      }
      setResubmit({ entry: current, cleared: !isReload });
      return;
    }
    load(current);
  }, [current, nonce, load]);

  // A live URL playing inline in the reading pane (see the live-view effect).
  const [livePlay, setLivePlay] = useState<string | null>(null);

  const navigate = useCallback(
    (input: string, opts?: { post?: string }) => {
      setLivePlay(null); // leaving the page tears down any inline player
      try {
        const url = normalizeUrl(input);
        setAddress(url);
        history.push({ url, post: opts?.post });
      } catch (e) {
        setResult(null);
        setError(toPageError(e));
        setStatus("error");
      }
    },
    [history],
  );

  const openExternal = useCallback((url: string) => {
    openUrl(url).catch(() => {
      /* opening externally is best-effort */
    });
  }, []);

  // Play a video inline (see the live-view effect below). YouTube can't be
  // embedded in our page — its player needs an HTTP Referer our tauri://localhost
  // origin can't send ("Error 153") — but loaded as a normal top-level page it's
  // just the site running its own JS, and it plays.
  const playVideo = useCallback((url: string) => setLivePlay(url), []);

  // Inline "live view": overlay a child webview on the reading pane loading the
  // live site as a top-level page (real origin → its own JS runs, videos play),
  // so playback stays inside this window rather than an iframe (blocked), a popup
  // window, or the system browser. The webview is a native layer above our HTML,
  // so its close control lives in the header (which it doesn't cover).
  const liveRef = useRef<Webview | null>(null);
  const measurePane = () => {
    const pane = document.getElementById("reading-pane");
    if (!pane) return null;
    const r = pane.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.max(1, Math.round(r.width)),
      h: Math.max(1, Math.round(r.height)),
    };
  };
  useEffect(() => {
    let disposed = false;
    const teardown = async () => {
      const wv = liveRef.current;
      liveRef.current = null;
      if (wv) {
        try {
          await wv.close();
        } catch {
          /* already gone */
        }
      }
    };
    if (livePlay) {
      teardown().then(() => {
        if (disposed) return;
        const rect = measurePane();
        if (!rect) return;
        try {
          const wv = new Webview(getCurrentWindow(), `live-${Date.now()}`, {
            url: livePlay,
            x: rect.x,
            y: rect.y,
            width: rect.w,
            height: rect.h,
          });
          if (disposed) {
            wv.close().catch(() => {});
            return;
          }
          liveRef.current = wv;
        } catch {
          /* creating the child webview failed */
        }
      });
    } else {
      teardown();
    }
    return () => {
      disposed = true;
    };
  }, [livePlay]);

  // Keep the inline player aligned to the reading pane as the window resizes.
  useEffect(() => {
    const onResize = () => {
      const wv = liveRef.current;
      const rect = measurePane();
      if (!wv || !rect) return;
      wv.setPosition(new LogicalPosition(rect.x, rect.y)).catch(() => {});
      wv.setSize(new LogicalSize(rect.w, rect.h)).catch(() => {});
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Apply dark mode to <html>.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Reflect the current page title in the OS window title bar.
  useEffect(() => {
    const title =
      status === "ready" && result?.title
        ? `${result.title} — Markdown Browser`
        : "Markdown Browser";
    getCurrentWindow()
      .setTitle(title)
      .catch(() => {
        /* title is cosmetic */
      });
  }, [result, status]);

  // Keyboard navigation: ⌘[ back, ⌘] forward.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "[") {
        e.preventDefault();
        if (history.canBack) history.back();
      } else if (e.key === "]") {
        e.preventDefault();
        if (history.canForward) history.forward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history]);

  const loading = status === "loading";

  return (
    <div className="flex h-full flex-col bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-200">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-100/80 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-800/80">
        <NavControls
          canBack={history.canBack}
          canForward={history.canForward}
          loading={loading}
          canReload={!!history.current}
          onBack={history.back}
          onForward={history.forward}
          onReload={history.reload}
        />
        <AddressBar url={address} loading={loading} onNavigate={navigate} />
        {livePlay && (
          <button
            type="button"
            onClick={() => setLivePlay(null)}
            className="shrink-0 rounded-md bg-red-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-red-500"
            title="Stop the inline video and return to the page"
          >
            ✕ Close video
          </button>
        )}
        {result && status === "ready" && <SourceBadge source={result.source} />}
        <DarkToggle dark={dark} onToggle={() => setDark((d) => !d)} />
      </header>

      <main id="reading-pane" className="min-h-0 flex-1">
        {status === "loading" && <LoadingView />}
        {status === "error" && error && (
          <ErrorView
            error={error}
            onRetry={history.current ? history.reload : undefined}
          />
        )}
        {status === "ready" && result && (
          <MarkdownView
            markdown={result.markdown}
            baseUrl={result.finalUrl}
            interactiveForms={result.source === "converted"}
            onNavigate={navigate}
            onOpenExternal={openExternal}
            onPlayVideo={playVideo}
          />
        )}
        {status === "idle" && <Welcome onNavigate={navigate} />}
      </main>

      {resubmit && (
        <ResubmitDialog
          onResubmit={() => {
            const entry = resubmit.entry;
            setResubmit(null);
            load(entry);
          }}
          onCancel={() => {
            // When we cleared the display for a traversal to an evicted POST
            // page, leave a consistent state instead of a blank loader.
            if (resubmit.cleared) {
              setError(
                new PageError("unknown", "Form not resubmitted.", {
                  url: resubmit.entry.url,
                }),
              );
              setStatus("error");
            }
            setResubmit(null);
          }}
        />
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: PageResult["source"] }) {
  const map = {
    native: { label: "Markdown", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
    converted: { label: "Converted", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
    raw: { label: "Raw", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  } as const;
  const { label, cls } = map[source];
  return (
    <span
      className={`chrome-no-select shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}
      title={
        source === "native"
          ? "This site served markdown directly"
          : source === "converted"
            ? "Converted from HTML"
            : "Shown as raw text"
      }
    >
      {label}
    </span>
  );
}

function DarkToggle({
  dark,
  onToggle,
}: {
  dark: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

export default App;
