"use client";

import { BarChart3, Cookie, Lock, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CONSENT_EVENT, OPEN_PREFS_EVENT, readConsent, saveConsent } from "@/lib/consent";

const subscribe = (cb: () => void) => {
  window.addEventListener(CONSENT_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(CONSENT_EVENT, cb); window.removeEventListener("storage", cb); };
};
// "unknown" on the server and before hydration, so the banner never flashes for people who already chose.
const snapshot = () => { const c = readConsent(); return c ? (c.analytics ? "yes" : "no") : "unset"; };
const serverSnapshot = () => "unknown";

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange?.(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full border-[2.5px] border-edge transition-colors ${on ? "bg-lime" : "bg-surface-2"} ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <span className={`absolute top-0.5 size-[18px] rounded-full border-2 border-edge bg-white transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Cookie banner (first visit) and preferences panel (any time, via the footer "Cookie settings" link). */
export function CookieConsent() {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    const open = () => { setAnalytics(readConsent()?.analytics ?? false); setPrefsOpen(true); };
    window.addEventListener(OPEN_PREFS_EVENT, open);
    return () => window.removeEventListener(OPEN_PREFS_EVENT, open);
  }, []);

  useEffect(() => {
    if (!prefsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPrefsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefsOpen]);

  const decide = (a: boolean) => { saveConsent(a); setPrefsOpen(false); };

  return (
    <>
      {state === "unset" && !prefsOpen && (
        <div role="region" aria-label="Cookie consent"
          className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-[760px] sm:inset-x-5 sm:bottom-5">
          <div className="card flex flex-col gap-4 bg-surface p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border-2 border-edge bg-yellow text-[#121212]"><Cookie className="size-5" /></span>
              <p className="text-sm leading-snug text-ink-2">
                We use essential cookies to keep you signed in. With your OK we also count anonymous visits and sign-ups
                to improve the site. No ads, no third-party trackers. <Link href="/privacy#cookies" className="font-bold underline">Learn more</Link>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => { setAnalytics(false); setPrefsOpen(true); }} className="btn-brut rounded-xl bg-surface px-3 py-2 text-sm font-extrabold">Preferences</button>
              <button type="button" onClick={() => decide(false)} className="btn-brut rounded-xl bg-surface px-3 py-2 text-sm font-extrabold">Essential only</button>
              <button type="button" onClick={() => decide(true)} className="btn-brut rounded-xl bg-lime px-3 py-2 text-sm font-extrabold text-[#121212]">Accept all</button>
            </div>
          </div>
        </div>
      )}

      {prefsOpen && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4" onClick={() => setPrefsOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="cookie-prefs-title" onClick={(e) => e.stopPropagation()}
            className="card w-full max-w-[480px] bg-surface p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 id="cookie-prefs-title" className="font-display text-2xl font-extrabold">Cookie settings</h2>
              <button type="button" onClick={() => setPrefsOpen(false)} aria-label="Close" className="grid size-9 place-items-center rounded-xl border-2 border-edge"><X className="size-4" /></button>
            </div>
            <p className="mt-2 text-sm text-ink-2">Choose what this browser may store. You can change this any time from the footer.</p>

            <div className="mt-5 space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border-2 border-edge p-4">
                <Lock className="mt-0.5 size-5 shrink-0" />
                <div className="flex-1">
                  <div className="font-extrabold">Essential</div>
                  <p className="text-sm text-ink-2">Your sign-in session, security checks, theme and unsaved drafts. The site can&apos;t work without these.</p>
                </div>
                <Toggle on disabled label="Essential cookies (always on)" />
              </div>
              <div className="flex items-start gap-3 rounded-2xl border-2 border-edge p-4">
                <BarChart3 className="mt-0.5 size-5 shrink-0" />
                <div className="flex-1">
                  <div className="font-extrabold">Analytics</div>
                  <p className="text-sm text-ink-2">Anonymous daily counts of events such as &ldquo;opened the app&rdquo; or &ldquo;signed up&rdquo;, sent only to our own server. No cookies, no profile of you.</p>
                </div>
                <Toggle on={analytics} onChange={setAnalytics} label="Analytics" />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => decide(false)} className="btn-brut rounded-xl bg-surface px-4 py-2 text-sm font-extrabold">Essential only</button>
              <button type="button" onClick={() => decide(analytics)} className="btn-brut rounded-xl bg-pink px-4 py-2 text-sm font-extrabold text-[#121212]">Save choices</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Footer link that reopens the preferences panel. */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button type="button" className={className ?? "hover:underline"} onClick={() => window.dispatchEvent(new Event(OPEN_PREFS_EVENT))}>
      Cookie settings
    </button>
  );
}
