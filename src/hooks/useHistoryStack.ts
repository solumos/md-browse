import { useCallback, useMemo, useRef, useState } from "react";
import type { NavRequest } from "../lib/types";

/** A history entry: the request plus a stable identity for per-page caching. */
export interface HistoryEntry extends NavRequest {
  id: number;
}

interface HistoryState {
  entries: HistoryEntry[];
  index: number;
}

export interface HistoryStack {
  /** The entry at the current position, or null if history is empty. */
  current: HistoryEntry | null;
  canBack: boolean;
  canForward: boolean;
  /**
   * Bumped ONLY when the current entry must be re-fetched (reload, or
   * re-entering the same GET URL). Back/forward change `current` without
   * touching the nonce, so the shell can restore those pages from cache
   * instead of re-requesting — the way mainstream browsers treat history
   * traversal (and the reason going Back never re-POSTs a form).
   */
  nonce: number;
  /** Navigate to a new request, truncating any forward history. */
  push: (req: NavRequest) => void;
  back: () => void;
  forward: () => void;
  /** Re-trigger a fetch of the current entry. */
  reload: () => void;
  /**
   * Replace the current entry in place, keeping its id (and cache). Used for
   * Post/Redirect/Get: once a POST lands on a redirected page, the entry
   * becomes a plain GET of that URL, so reload/back re-GET instead of re-POST.
   */
  replace: (req: NavRequest) => void;
}

/**
 * An in-memory back/forward history stack, modeling browser navigation.
 * `current` + `nonce` together drive page loads in the shell.
 */
export function useHistoryStack(): HistoryStack {
  const [state, setState] = useState<HistoryState>({ entries: [], index: -1 });
  const [nonce, setNonce] = useState(0);
  const nextId = useRef(1);
  // Mirror of `state` so push() can branch on the latest entries without
  // stale-closure issues (events always fire after the render that set it).
  const stateRef = useRef(state);
  stateRef.current = state;

  const push = useCallback((req: NavRequest) => {
    const s = stateRef.current;
    const last = s.index >= 0 ? s.entries[s.index] : undefined;
    // Re-entering the current GET URL is a reload. A POST is always a new
    // navigation (mainstream: each form submission gets its own entry, and an
    // explicit re-submit never prompts).
    if (last && !req.post && !last.post && last.url === req.url) {
      setNonce((n) => n + 1);
      return;
    }
    setState((prev) => {
      const kept = prev.entries.slice(0, prev.index + 1);
      const entries = [...kept, { ...req, id: nextId.current++ }];
      return { entries, index: entries.length - 1 };
    });
  }, []);

  const back = useCallback(() => {
    setState((s) => (s.index > 0 ? { ...s, index: s.index - 1 } : s));
  }, []);

  const forward = useCallback(() => {
    setState((s) =>
      s.index < s.entries.length - 1 ? { ...s, index: s.index + 1 } : s,
    );
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const replace = useCallback((req: NavRequest) => {
    setState((s) => {
      if (s.index < 0) return s;
      const entries = s.entries.slice();
      entries[s.index] = { ...req, id: entries[s.index].id };
      return { ...s, entries };
    });
  }, []);

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
      replace,
    }),
    [state, nonce, push, back, forward, reload, replace],
  );
}
