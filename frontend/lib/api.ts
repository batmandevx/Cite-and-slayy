"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, JobEvent } from "./types";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** fetch() for our API: always sends the login cookie, and broadcasts "sign in" (401) / "upgrade" (402) events. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(path.startsWith("http") ? path : `${API}${path}`, { credentials: "include", ...init });
  if (typeof window !== "undefined") {
    if (r.status === 401) window.dispatchEvent(new CustomEvent("slayy:auth"));
    if (r.status === 402) {
      try {
        const body = await r.clone().json();
        window.dispatchEvent(new CustomEvent("slayy:upgrade", { detail: body.detail }));
      } catch { /* not JSON */ }
    }
  }
  return r;
}

/** EventSource for job progress, with cookies. */
export const jobEvents = (jobId: string) => new EventSource(`${API}/api/jobs/${jobId}/events`, { withCredentials: true });

async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const body = await r.json();
      msg = typeof body.detail === "string" ? body.detail : body.detail?.message ?? JSON.stringify(body.detail ?? body);
    } catch {}
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  get: <T,>(path: string) => apiFetch(path, { cache: "no-store" }).then((r) => handle<T>(r)),
  post: <T,>(path: string, body?: unknown) =>
    apiFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  put: <T,>(path: string, body?: unknown) =>
    apiFetch(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  upload: <T,>(path: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch(path, { method: "POST", body: fd }).then((r) => handle<T>(r));
  },
};

export type ToastTone = "good" | "crit" | "accent";
export interface ToastMsg { title: string; body?: string; tone: ToastTone }

/** Fire a toast from anywhere (rendered by <Toaster/>). */
export function toast(msg: ToastMsg) {
  window.dispatchEvent(new CustomEvent<ToastMsg>("slayy:toast", { detail: msg }));
}

export interface JobState {
  job: Job | null;
  events: JobEvent[];
  running: boolean;
  error: string | null;
}

/** Start a backend job and follow its Server-Sent Events until it ends. */
export function useJob() {
  const [state, setState] = useState<JobState>({ job: null, events: [], running: false, error: null });
  const es = useRef<EventSource | null>(null);

  useEffect(() => () => es.current?.close(), []);

  const start = useCallback(
    (begin: () => Promise<{ job_id: string }>, onDone: (resultId: string) => void, label?: string) => {
      es.current?.close();
      setState({ job: null, events: [], running: true, error: null });
      begin()
        .then(({ job_id }) => {
          let finished = false;
          const src = jobEvents(job_id);
          es.current = src;
          src.onmessage = (m) => {
            try {
              const ev = JSON.parse(m.data) as JobEvent;
              setState((s) => ({ ...s, events: [...s.events, ev].slice(-200) }));
            } catch {}
          };
          src.addEventListener("end", (m) => {
            if (finished) return;
            finished = true;
            const job = JSON.parse((m as MessageEvent).data) as Job;
            src.close();
            setState((s) => ({ ...s, job, running: false, error: job.status === "error" ? job.error ?? "Job failed" : null }));
            if (label) {
              toast(job.status === "done"
                ? { title: `${label} complete`, tone: "good" }
                : { title: `${label} failed`, body: job.error ?? undefined, tone: "crit" });
            }
            if (job.status === "done" && job.result_id) onDone(job.result_id);
          });
          src.onerror = () => {
            if (finished) return;
            // Poll job status once in case the stream dropped right as the job finished or errored.
            api.get<Job>(`/api/jobs/${job_id}`)
              .then((job) => {
                if (finished) return;
                if (job.status === "done" || job.status === "error") {
                  finished = true;
                  src.close();
                  setState((s) => ({ ...s, job, running: false, error: job.status === "error" ? job.error ?? "Job failed" : null }));
                  if (job.status === "done" && job.result_id) onDone(job.result_id);
                } else if (src.readyState === EventSource.CLOSED) {
                  finished = true;
                  setState((s) => ({ ...s, running: false, error: "Lost connection to the backend." }));
                }
              })
              .catch(() => {
                if (src.readyState === EventSource.CLOSED && !finished) {
                  finished = true;
                  setState((s) => ({ ...s, running: false, error: "Lost connection to the backend." }));
                }
              });
          };
        })
        .catch((e: Error) => {
          setState({ job: null, events: [], running: false, error: e.message });
          if (label) toast({ title: `${label} could not start`, body: e.message, tone: "crit" });
        });
    },
    [],
  );

  return { ...state, start };
}

/** Write a persistent key and notify all mounted `usePersistent` hooks in the same tab. */
export function writePersistent<T>(key: string, value: T) {
  const storageKey = `slayy:${key}`;
  const raw = JSON.stringify(value);
  localStorage.setItem(storageKey, raw);
  window.dispatchEvent(new CustomEvent("slayy:persist", { detail: { key, value } }));
}

/** localStorage-backed state synced across components in the same tab. */
export function usePersistent<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`slayy:${key}`);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    const onSync = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; value: T }>).detail;
      if (d?.key === key) setValue(d.value);
    };
    window.addEventListener("slayy:persist", onSync);
    return () => window.removeEventListener("slayy:persist", onSync);
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(`slayy:${key}`, JSON.stringify(resolved));
          queueMicrotask(() => {
            window.dispatchEvent(new CustomEvent("slayy:persist", { detail: { key, value: resolved } }));
          });
        } catch {}
        return resolved;
      });
    },
    [key],
  );

  return [value, update] as const;
}
