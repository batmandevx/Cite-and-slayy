"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, apiFetch } from "@/lib/api";

export interface Me {
  uid: string; email: string; name?: string; picture?: string | null; plan: "free" | "pro" | "max"; plan_name: string;
  is_owner?: boolean; is_paid?: boolean;
  limits: Record<string, number>; usage: Record<string, number>; renews_at?: string | null; cancel_at_period_end?: boolean;
  engine: string; ai_budget_used: number; pack?: { credits: Record<string, number>; expires: number } | null;
}
export interface AuthConfig { auth_required: boolean; google_client_id?: string | null; email_login: boolean; payments: boolean }
export interface UpgradeReason { code: string; feature: string; label: string; limit: number; plan: string; message: string }

interface Ctx {
  me: Me | null; config: AuthConfig | null; loading: boolean;
  refresh: () => Promise<void>; logout: () => Promise<void>;
  upgrade: UpgradeReason | "open" | null; openUpgrade: (r?: UpgradeReason) => void; closeUpgrade: () => void;
}
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrade, setUpgrade] = useState<Ctx["upgrade"]>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>("/api/auth/me"));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.get<AuthConfig>("/api/auth/config").then(setConfig).catch(() => setConfig({ auth_required: false, email_login: false, payments: false }));
    // Initial load: the promise resolves after mount, so state updates happen in a callback.
    api.get<Me>("/api/auth/me").then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
    const onAuth = () => { refresh(); };
    const onUpgrade = (e: Event) => setUpgrade((e as CustomEvent<UpgradeReason>).detail ?? "open");
    window.addEventListener("slayy:auth", onAuth);
    window.addEventListener("slayy:upgrade", onUpgrade);
    return () => { window.removeEventListener("slayy:auth", onAuth); window.removeEventListener("slayy:upgrade", onUpgrade); };
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    window.location.href = "/";
  }, []);

  return (
    <AuthCtx.Provider value={{ me, config, loading, refresh, logout, upgrade,
      openUpgrade: (r) => setUpgrade(r ?? "open"), closeUpgrade: () => setUpgrade(null) }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

const PAID_LABEL: Record<string, string> = {
  exports: "Word, LaTeX & PDF downloads", decks: "presentation slides", vision: "image understanding in Azora AI", kits: "submission kits",
  integrity_scans: "AI & plagiarism reports", humanize_fixes: "AI & plagiarism reducer", reviews: "reviewer verdicts", fixes: "originality fixes",
  drafts: "drafting runs", latex: "the live LaTeX / Overleaf view",
};

/** Paid features: `paid` is true for Pro, Max, Paper Pack and the owner (and everyone when login is off). `gate()` opens the upgrade screen. */
export function usePaid() {
  const { me, config, openUpgrade } = useAuth();
  const paid = !config?.auth_required || Boolean(me?.is_paid || me?.is_owner);
  const gate = (feature: string): boolean => {
    if (paid) return true;
    const label = PAID_LABEL[feature] ?? feature;
    openUpgrade({ code: "paid_only", feature, label, limit: 0, plan: me?.plan ?? "free",
      message: `${label[0].toUpperCase() + label.slice(1)} ${label.endsWith("s") && !label.endsWith("ss") ? "are" : "is"} included with Pro, Max and the Paper Pack.` });
    return false;
  };
  return { paid, gate };
}
