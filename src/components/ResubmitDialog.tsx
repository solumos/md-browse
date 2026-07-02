import { useEffect, useRef } from "react";

interface Props {
  onResubmit: () => void;
  onCancel: () => void;
}

/**
 * "Confirm form resubmission" — shown when a reload would re-send a POST
 * (mainstream-browser behavior). Back/forward never trigger this; those
 * restore the cached page instead.
 */
export function ResubmitDialog({ onResubmit, onCancel }: Props) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="resubmit-title"
        aria-describedby="resubmit-desc"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="resubmit-title"
          className="mb-2 text-base font-semibold text-slate-800 dark:text-slate-100"
        >
          Confirm form resubmission
        </h2>
        <p id="resubmit-desc" className="mb-5 text-sm text-slate-600 dark:text-slate-300">
          This page was reached by submitting a form. Reloading it will resubmit
          the form, which might repeat an action you took (like a login or a
          purchase). Continue?
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={onResubmit}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-700"
          >
            Resubmit
          </button>
        </div>
      </div>
    </div>
  );
}
