import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AddressBar } from "./components/AddressBar";
import { NavControls } from "./components/NavControls";
import { MarkdownView } from "./components/MarkdownView";
import { ErrorView, LoadingView } from "./components/StatusView";
import { Welcome } from "./components/Welcome";
import { useHistoryStack } from "./hooks/useHistoryStack";
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

  const load = useCallback(async (url: string) => {
    const id = ++reqId.current;
    setStatus("loading");
    setError(null);
    try {
      const page = await loadPage(url);
      if (reqId.current !== id) return; // a newer navigation superseded this one
      setResult(page);
      setAddress(page.finalUrl);
      setStatus("ready");
    } catch (e) {
      if (reqId.current !== id) return;
      setError(toPageError(e));
      setStatus("error");
    }
  }, []);

  // Load whenever the current history entry changes or a reload is requested.
  const { current, nonce } = history;
  useEffect(() => {
    if (current) load(current);
  }, [current, nonce, load]);

  const navigate = useCallback(
    (input: string) => {
      try {
        const url = normalizeUrl(input);
        setAddress(url);
        history.push(url);
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
        {result && status === "ready" && <SourceBadge source={result.source} />}
        <DarkToggle dark={dark} onToggle={() => setDark((d) => !d)} />
      </header>

      <main className="min-h-0 flex-1">
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
            onNavigate={navigate}
            onOpenExternal={openExternal}
          />
        )}
        {status === "idle" && <Welcome onNavigate={navigate} />}
      </main>
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
