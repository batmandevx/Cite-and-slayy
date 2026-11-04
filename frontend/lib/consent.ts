// Cookie / storage consent. Essential storage (sign-in cookie, theme, saved drafts) is always on; analytics
// (our own anonymous conversion counts) only runs after the visitor says yes.

export interface Consent { essential: true; analytics: boolean; decidedAt: string; v: 1 }

const KEY = "slayy-consent";
export const CONSENT_EVENT = "slayy:consent";
export const OPEN_PREFS_EVENT = "slayy:cookie-prefs";

export function readConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Consent;
    return c && c.v === 1 ? c : null;
  } catch { return null; }
}

export function saveConsent(analytics: boolean): Consent {
  const c: Consent = { essential: true, analytics, decidedAt: new Date().toISOString(), v: 1 };
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode: the choice lasts for this visit */ }
  window.dispatchEvent(new CustomEvent<Consent>(CONSENT_EVENT, { detail: c }));
  return c;
}

export const analyticsAllowed = () => readConsent()?.analytics === true;

/** Opens the cookie preferences panel from anywhere (e.g. a footer link). */
export const openCookiePrefs = () => window.dispatchEvent(new Event(OPEN_PREFS_EVENT));
