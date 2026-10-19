"use client";

import { useState, useTransition } from "react";

type Props = {
  /** compact = nagłówek; panel = Ustawienia z opisem */
  variant?: "compact" | "panel";
};

export function FreeModelsButton({ variant = "compact" }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function onClick() {
    setMessage(null);
    setFailed(false);
    startTransition(async () => {
      try {
        const res = await fetch("/api/comfy/free", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setFailed(true);
          setMessage(data.error ?? "Nie udało się zwolnić modeli");
          return;
        }
        setFailed(false);
        setMessage("Modele zwolnione (soft unload — bez restartu Comfy).");
      } catch {
        setFailed(true);
        setMessage("Błąd sieci przy zwalnianiu modeli");
      }
    });
  }

  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={[
        "min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold transition disabled:opacity-60",
        variant === "panel"
          ? "bg-teal-400 px-4 py-2.5 text-studio-cta-fg hover:bg-teal-300"
          : "border border-studio-border-strong bg-studio-surface text-stone-200 hover:bg-studio-surface-hover hover:text-stone-50",
      ].join(" ")}
      title="Soft unload wag z VRAM/RAM Comfy (POST /free) — bez restartu procesu"
    >
      {pending ? "Zwalniam…" : "Zwolnij modele"}
    </button>
  );

  if (variant === "panel") {
    return (
      <div className="space-y-3 rounded-lg border border-studio-border bg-studio-surface/40 px-4 py-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-stone-100">Pamięć Comfy</h2>
          <p className="max-w-2xl text-sm text-stone-400">
            Soft unload wag (Flux / Wan) z VRAM i RAM — bez restartu procesu.
            Studio też zwalnia automatycznie przy zmianie Obraz↔Wideo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {button}
          {message ? (
            <p
              className={
                failed
                  ? "text-sm text-rose-200"
                  : "text-sm text-teal-100/90"
              }
              role="status"
            >
              {message}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      {button}
      {message ? (
        <p
          className={[
            "max-w-[14rem] text-right text-[11px] leading-snug",
            failed ? "text-rose-300" : "text-teal-200/80",
          ].join(" ")}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
