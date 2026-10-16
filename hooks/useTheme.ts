"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
const eventName = "artic-theme-change";

function getPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem("artic-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function applyTheme() {
  const preference = getPreference();
  document.documentElement.classList.toggle("dark", preference === "dark" ||
    (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
}

function subscribe(callback: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const update = () => { applyTheme(); callback(); };
  window.addEventListener(eventName, update);
  window.addEventListener("storage", update);
  media.addEventListener("change", update);
  applyTheme();
  return () => {
    window.removeEventListener(eventName, update);
    window.removeEventListener("storage", update);
    media.removeEventListener("change", update);
  };
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, getPreference, () => "system" as ThemePreference);
  const isDark = useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"), () => false);
  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem("artic-theme");
      else localStorage.setItem("artic-theme", next);
      window.dispatchEvent(new Event(eventName));
      return true;
    } catch {
      return false;
    }
  }, []);
  return { preference, isDark, setPreference };
}
