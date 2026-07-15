import { useCallback, useEffect, useRef, useState } from "react";

/** The current state of an in-flight or completed async load. */
export interface AsyncState<T> {
  /** The last successfully loaded value, if any. */
  data: T | undefined;
  /** The error from the most recent failed load, if any. */
  error: Error | undefined;
  /** True while a load is in flight. */
  loading: boolean;
  /** Re-run the loader, e.g. after a mutation elsewhere in the UI. */
  reload: () => void;
}

/**
 * Run an async loader on mount (and whenever `deps` change), tracking loading/error/data state.
 * Guards against setting state after the component unmounts or after a newer load has started,
 * so a slow, stale request can never clobber a faster, newer one.
 *
 * @param loader - Function producing the value to load. Re-created on every render is fine;
 *   only `deps` controls when it actually re-runs.
 * @param deps - Dependency list; the loader re-runs when any entry changes, same as `useEffect`.
 * @returns The current {@link AsyncState}, including a `reload` function for manual refresh.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, ...deps]);

  return { data, error, loading, reload };
}
