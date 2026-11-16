"use client";

import { useCallback, useEffect, useState } from "react";

const retryDelays = [600, 1_500] as const;
type ImageState = { source: string; attempt: number; retries: number; failed: boolean; retrying: boolean };

function initialState(source: string): ImageState {
  return { source, attempt: 0, retries: 0, failed: false, retrying: false };
}

function retrySource(source: string, attempt: number) {
  // Do not change signed external URLs. Local uploads can bypass a cached error.
  if (!attempt || !/^\/api\/uploads\/[a-z0-9]{20,40}(?:[?#]|$)/.test(source)) return source;
  const url = new URL(source, "https://artic.invalid");
  url.searchParams.set("_artic_retry", String(attempt));
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Retry transient image failures twice, then leave further attempts to the user. */
export function useImageRetry(imageUrl: string | null | undefined) {
  const source = imageUrl ?? "";
  const [state, setState] = useState(() => initialState(source));
  const current = state.source === source ? state : initialState(source);
  const attempt = current.attempt;

  useEffect(() => {
    setState((previous) => previous.source === source ? previous : initialState(source));
  }, [source]);

  useEffect(() => {
    if (state.source !== source || !state.failed || !state.retrying) return;
    const timer = setTimeout(() => {
      setState((previous) => previous.source === source && previous.attempt === state.attempt
        ? { ...previous, attempt: previous.attempt + 1, retries: previous.retries + 1, failed: false, retrying: false }
        : previous);
    }, retryDelays[state.retries]);
    return () => clearTimeout(timer);
  }, [source, state.source, state.attempt, state.retries, state.failed, state.retrying]);

  const onError = useCallback(() => {
    if (!source) return;
    setState((previous) => previous.source === source && previous.attempt === attempt && !previous.failed
      ? { ...previous, failed: true, retrying: previous.retries < retryDelays.length }
      : previous);
  }, [source, attempt]);

  const onLoad = useCallback(() => {
    setState((previous) => previous.source === source && previous.attempt === attempt && (previous.failed || previous.retrying)
      ? { ...previous, failed: false, retrying: false }
      : previous);
  }, [source, attempt]);

  const retry = useCallback(() => {
    if (!source) return;
    setState((previous) => previous.source === source
      ? { ...initialState(source), attempt: previous.attempt + 1 }
      : initialState(source));
  }, [source]);

  return { src: retrySource(source, attempt), imageKey: `${source}:${attempt}`, failed: current.failed, retrying: current.retrying, onError, onLoad, retry };
}
