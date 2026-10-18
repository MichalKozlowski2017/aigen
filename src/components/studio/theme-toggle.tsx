"use client";

import { useSyncExternalStore } from "react";
import {
  THEME_STORAGE_KEY,
  applyStudioTheme,
  resolveStudioTheme,
  type StudioTheme,
} from "./theme";

function subscribe(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  window.addEventListener("storage", onStoreChange);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onStoreChange);
  };
}

function getThemeSnapshot(): StudioTheme {
  return resolveStudioTheme(
    document.documentElement.getAttribute("data-theme"),
  );
}

function getServerSnapshot(): StudioTheme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    getThemeSnapshot,
    getServerSnapshot,
  );

  function setAndPersist(next: StudioTheme) {
    applyStudioTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode / quota — theme still applies for this session */
    }
  }

  return (
    <div
      className="inline-flex items-stretch rounded-lg border border-studio-border-strong bg-studio-surface p-0.5"
      role="group"
      aria-label="Motyw panelu"
    >
      {(
        [
          { id: "light", label: "Jasny" },
          { id: "dark", label: "Ciemny" },
        ] as const
      ).map((opt) => {
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => setAndPersist(opt.id)}
            className={[
              "min-h-11 min-w-[4.5rem] rounded-md px-3 text-sm font-semibold transition-colors",
              active
                ? "bg-teal-400 text-studio-cta-fg"
                : "text-stone-400 hover:bg-studio-surface-hover hover:text-stone-100",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
