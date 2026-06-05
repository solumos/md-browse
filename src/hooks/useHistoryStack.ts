import { useCallback, useMemo, useState } from "react";

interface HistoryState {
  entries: string[];
  index: number;
}

export interface HistoryStack {
  /** The URL at the current position, or null if history is empty. */
  current: string | null;
  canBack: boolean;
  canForward: boolean;
  /** A monotonically increasing token; bump it to force a reload of `current`. */
  nonce: number;
  /** Navigate to a new URL, truncating any forward history. */
  push: (url: string) => void;
  back: () => void;
  forward: () => void;
  /** Re-trigger a load of the current URL. */
  reload: () => void;
}

/**
 * An in-memory back/forward history stack, modeling browser navigation.
 * `current` + `nonce` together drive page loads in the shell.
 */
export function useHistoryStack(): HistoryStack {
  const [state, setState] = useState<HistoryState>({ entries: [], index: -1 });
  const [nonce, setNonce] = useState(0);

  const push = useCallback((url: string) => {
    setState((s) => {
      const kept = s.entries.slice(0, s.index + 1);
      if (kept[kept.length - 1] === url) {
        // Navigating to the same URL = reload; keep the stack, bump nonce.
        return s;
      }
      const entries = [...kept, url];
      return { entries, index: entries.length - 1 };
    });
    setNonce((n) => n + 1);
  }, []);

  const back = useCallback(() => {
    setState((s) => (s.index > 0 ? { ...s, index: s.index - 1 } : s));
    setNonce((n) => n + 1);
  }, []);

  const forward = useCallback(() => {
    setState((s) =>
      s.index < s.entries.length - 1 ? { ...s, index: s.index + 1 } : s,
    );
    setNonce((n) => n + 1);
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return useMemo<HistoryStack>(
    () => ({
      current: state.index >= 0 ? state.entries[state.index] : null,
      canBack: state.index > 0,
      canForward: state.index >= 0 && state.index < state.entries.length - 1,
      nonce,
      push,
      back,
      forward,
      reload,
    }),
    [state, nonce, push, back, forward, reload],
  );
}
