import { useEffect, useRef, useState } from "react";

interface Props {
  /** The current address to show (e.g. the resolved final URL). */
  url: string;
  loading: boolean;
  onNavigate: (input: string) => void;
}

/**
 * The address/URL bar. Holds local edit state while typing, but resyncs to the
 * authoritative `url` whenever navigation completes.
 */
export function AddressBar({ url, loading, onNavigate }: Props) {
  const [value, setValue] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resync when the loaded page changes (and we're not mid-edit on it).
  useEffect(() => {
    setValue(url);
  }, [url]);

  // Expose ⌘L / Ctrl+L to focus + select the address bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      className="flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) onNavigate(trimmed);
        inputRef.current?.blur();
      }}
    >
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          name="md-url-bar"
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-autocomplete="none"
          data-1p-ignore
          data-lpignore="true"
          inputMode="url"
          placeholder="Enter a URL — e.g. example.com"
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="w-full rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:bg-slate-900 dark:focus:ring-sky-900"
          aria-label="Address bar"
        />
        {loading && (
          <span className="pointer-events-none absolute right-4 text-xs text-slate-400">
            loading…
          </span>
        )}
      </div>
    </form>
  );
}
