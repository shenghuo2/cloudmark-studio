import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "cloudmark-theme";

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(mode: ThemeMode) {
  const isDark = mode === "dark" || (mode === "system" && getSystemDark());
  document.documentElement.classList.toggle("dark", isDark);
}

export function useDarkMode() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved as ThemeMode) || "system";
  });

  useEffect(() => {
    applyTheme(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (mode === "system") applyTheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  const setTheme = useCallback((m: ThemeMode) => setMode(m), []);

  return { mode, setTheme };
}
