import type { PageError } from "../lib/types";

export function LoadingView() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse px-6 py-8" aria-busy="true">
      <div className="mb-6 h-8 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="space-y-3">
        {[
          "w-full",
          "w-11/12",
          "w-10/12",
          "w-full",
          "w-9/12",
          "w-full",
          "w-8/12",
        ].map((w, i) => (
          <div
            key={i}
            className={`h-4 ${w} rounded bg-slate-200 dark:bg-slate-700`}
          />
        ))}
      </div>
    </div>
  );
}

const TITLES: Record<string, string> = {
  "invalid-url": "Invalid address",
  "unsupported-scheme": "Unsupported address",
  network: "Can't reach the site",
  timeout: "The site timed out",
  "http-status": "The site returned an error",
  "unsupported-content": "Unsupported content",
  "too-large": "Page too large",
  empty: "Nothing to show",
  unknown: "Something went wrong",
};

export function ErrorView({
  error,
  onRetry,
}: {
  error: PageError;
  onRetry?: () => void;
}) {
  const title = TITLES[error.kind] ?? TITLES.unknown;
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-500 dark:bg-rose-950 dark:text-rose-400">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h2 className="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
        {title}
      </h2>
      <p className="mb-1 text-sm text-slate-600 dark:text-slate-400">
        {error.message}
      </p>
      {error.url && (
        <p className="mb-6 break-all font-mono text-xs text-slate-400 dark:text-slate-500">
          {error.url}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-sky-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-sky-600"
        >
          Try again
        </button>
      )}
    </div>
  );
}
