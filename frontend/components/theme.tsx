"use client";

import { Moon, Sun } from "lucide-react";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

type Theme = "light" | "dark";
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (typeof document !== "undefined" && (document.documentElement.getAttribute("data-theme") as Theme)) || "light",
  );
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("slayy-theme", next);
    setTheme(next);
  };
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

const noop = () => () => {};

export function ThemeToggle() {
  const { theme: chosen, toggle } = useTheme();
  // The server can't know the saved theme; render the light icon until hydrated so the markup matches.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const theme = hydrated ? chosen : "light";
  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="btn-brut grid size-9 place-items-center rounded-xl bg-surface text-ink"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
