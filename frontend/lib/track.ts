// First-party conversion events. Sends only an event name and the page path to our own API, which keeps daily
// totals: no cookies, no third-party scripts, no user id. Does nothing until the visitor allows analytics.
import { API } from "./api";
import { analyticsAllowed } from "./consent";

export type ConversionEvent =
  | "cta_open_app" | "cta_pricing" | "video_play" | "signup" | "login" | "checkout_start" | "checkout_success"
  | "upi_claim" | "pack_purchase" | "paper_started" | "paper_generated" | "export" | "contact_submit";

const sentOnce = new Set<string>();

export function track(name: ConversionEvent, opts: { once?: boolean } = {}) {
  if (typeof window === "undefined" || !analyticsAllowed()) return;
  if (opts.once) { if (sentOnce.has(name)) return; sentOnce.add(name); }
  const body = JSON.stringify({ name, path: window.location.pathname });
  const url = `${API}/api/events`;
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through */ }
  void fetch(url, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
}
