"use client";

import { useTheme } from "@/hooks/useTheme";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { isDark, setPreference } = useTheme();

  function toggle() {
    setPreference(isDark ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      className={`flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--page-text)] transition hover:bg-[var(--chip-bg)] ${className}`}
    >
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.4" />
          <path
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            d="M8 0.75v1.5M8 13.75v1.5M15.25 8h-1.5M2.25 8H0.75M13.07 2.93l-1.06 1.06M3.99 12.01l-1.06 1.06M13.07 13.07l-1.06-1.06M3.99 3.99 2.93 2.93"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            fill="currentColor"
            d="M14 9.5A6.5 6.5 0 0 1 6.5 2a6.5 6.5 0 1 0 7.5 7.5Z"
          />
        </svg>
      )}
    </button>
  );
}
