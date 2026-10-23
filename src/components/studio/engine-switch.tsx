"use client";

import { useCallback, useEffect, useState } from "react";
import type { EngineSwitchTarget, EngineSwitchView } from "@/lib/studio/types";

const SIDE_LABEL: Record<NonNullable<EngineSwitchView["side"]>, string> = {
  comfy: "Działa ComfyUI",
  coder: "Działa koder Qwen",
  neither: "Oba wyłączone",
  both: "Oba włączone",
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function EngineSwitch({ initial }: { initial: EngineSwitchView }) {
  const [status, setStatus] = useState(initial);
  const [pending, setPending] = useState(initial.switching);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(initial.switchError);
  const [failed, setFailed] = useState(Boolean(initial.switchError || initial.unreachable));

  const poll = useCallback(async () => {
    const started = Date.now();
    while (Date.now() - started < 240_000) {
      await sleep(2000);
      try {
        const res = await fetch("/api/engine-switch", { cache: "no-store" });
        const data = (await res.json()) as EngineSwitchView;
        if (!data.ok) continue;
        setStatus(data);
        if (!data.switching) {
          setPending(false);
          if (data.switchError) {
            setFailed(true);
            setMessage(data.switchError);
          } else {
            setFailed(false);
            setMessage(null);
          }
          return;
        }
      } catch {
        /* kolejna próba */
      }
    }
    setPending(false);
    setFailed(true);
    setMessage("Legion nie potwierdził przełączenia. Odśwież pulpit.");
  }, []);

  useEffect(() => {
    if (!initial.switching) return;
    const id = window.setTimeout(() => {
      void poll();
    }, 0);
    return () => window.clearTimeout(id);
  }, [initial.switching, poll]);

  async function choose(target: EngineSwitchTarget, confirm = false) {
    if (!status.available || pending) return;
    if (target === "coder" && status.comfyOnline && status.comfyQueueRunning && !confirm) {
      setConfirming(true);
      setFailed(false);
      setMessage(null);
      return;
    }
    setConfirming(false);
    setPending(true);
    setFailed(false);
    setMessage(
      target === "coder"
        ? "Przełączam na kodera Qwen… ładowanie może potrwać kilka minut."
        : "Przełączam na ComfyUI…"
    );
    try {
      const res = await fetch("/api/engine-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, confirmActiveJob: confirm }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        needsConfirm?: boolean;
        error?: string;
        switching?: boolean;
        status?: EngineSwitchView;
      };
      if (data.needsConfirm) {
        setPending(false);
        setConfirming(true);
        setMessage(null);
        return;
      }
      if (!res.ok || !data.ok) {
        setPending(false);
        setFailed(true);
        setMessage(data.error ?? "Nie udało się przełączyć");
        return;
      }
      if (data.status) setStatus(data.status);
      if (data.switching) {
        void poll();
        return;
      }
      setPending(false);
      setFailed(false);
      setMessage(null);
    } catch {
      setPending(false);
      setFailed(true);
      setMessage("Błąd sieci przy przełączaniu");
    }
  }

  const disabled = !status.available || pending;
  const comfyPressed = status.side === "comfy";
  const coderPressed = status.side === "coder";

  return (
    <section
      className="studio-fade-in space-y-4 rounded-lg border border-studio-border bg-studio-surface/40 px-4 py-4 sm:px-5"
      data-engine-switch
      data-available={status.available ? "yes" : "no"}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl space-y-2">
          <h2 className="text-sm font-semibold text-stone-100">GPU — ComfyUI albo Qwen</h2>
          <p className="text-sm leading-relaxed text-stone-400">
            Jeden przełącznik na Legionie. Włączenie kodera zatrzymuje proces ComfyUI
            (nie tylko zwolnienie wag). Dopóki koder trzyma GPU, ComfyUI zostaje wyłączone.
            Włączenie ComfyUI zatrzymuje llama-server na porcie 8080.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <StatusPill status={status} pending={pending} />
          <div
            className="inline-flex items-stretch rounded-lg border border-studio-border-strong bg-studio-surface p-0.5"
            role="group"
            aria-label="Przełącznik GPU: ComfyUI albo koder Qwen"
          >
            <SideButton
              label="ComfyUI"
              pressed={comfyPressed}
              disabled={disabled}
              onClick={() => void choose("comfy")}
            />
            <SideButton
              label="Qwen"
              pressed={coderPressed}
              disabled={disabled}
              onClick={() => void choose("coder")}
            />
          </div>
        </div>
      </div>

      {!status.available && status.unavailableReason ? (
        <p className="text-sm text-amber-100" role="status">
          {status.unavailableReason}
        </p>
      ) : null}

      {status.side === "both" ? (
        <p className="text-sm text-amber-100" role="status">
          Oba włączone. Koder i ComfyUI nie mogą dzielić GPU — wybierz jeden.
        </p>
      ) : null}

      {confirming ? (
        <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-100">
            ComfyUI ma aktywne zadanie w kolejce. To kliknięcie go nie zatrzymuje.
            Potwierdź, żeby przerwać zadanie i włączyć kodera Qwen.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-11 rounded-lg border border-studio-border-strong px-3 text-sm font-semibold text-stone-200 hover:bg-studio-surface-hover"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={() => void choose("coder", true)}
              className="min-h-11 rounded-lg bg-teal-400 px-3 text-sm font-semibold text-studio-cta-fg hover:bg-teal-300"
            >
              Zatrzymaj i przełącz
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p
          className={failed ? "text-sm text-rose-200" : "text-sm text-teal-100/90"}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}

function SideButton({
  label,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={[
        "min-h-11 min-w-[5.5rem] rounded-md px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        pressed
          ? "bg-teal-400 text-studio-cta-fg"
          : "text-stone-400 hover:bg-studio-surface-hover hover:text-stone-100",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function StatusPill({
  status,
  pending,
}: {
  status: EngineSwitchView;
  pending: boolean;
}) {
  const label = !status.available
    ? "Niedostępny"
    : pending || status.switching
      ? "Przełączam…"
      : status.side
        ? SIDE_LABEL[status.side]
        : "Brak statusu";
  const warn = !status.available || status.side === "both" || status.side === "neither" || status.unreachable;
  return (
    <p
      className={[
        "inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-xs font-medium sm:self-end",
        warn
          ? "bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/25"
          : "bg-teal-400/10 text-teal-200 ring-1 ring-teal-400/30",
      ].join(" ")}
    >
      <span
        className={["h-2 w-2 rounded-full", warn ? "bg-amber-400" : "bg-teal-300"].join(" ")}
        aria-hidden
      />
      {label}
    </p>
  );
}
