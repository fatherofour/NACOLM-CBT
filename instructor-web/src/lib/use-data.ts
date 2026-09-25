'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data when `key` changes; `reload` refetches. `key` should capture
 * everything the loader depends on (e.g. a session id).
 */
export function useData<T>(load: () => Promise<T>, deps: unknown[]) {
  const key = JSON.stringify(deps);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (d) => {
        if (cancelled) return;
        setData(d);
        setError('');
        setLoading(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const reload = useCallback(() => {
    setLoading(true);
    setTick((t) => t + 1);
    return Promise.resolve();
  }, []);

  return { data, error, loading, reload, setData };
}
