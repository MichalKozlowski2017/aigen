"use client";

import { useCallback, useEffect, useState } from "react";
import type { DownloadJob, ModelLibraryItem } from "@/lib/studio/types";

export function ModelsClient({
  initialItems,
  configured,
  message,
  modelsDir,
  source = "none",
  downloadsEnabled = false,
}: {
  initialItems: ModelLibraryItem[];
  configured: boolean;
  message: string | null;
  modelsDir: string | null;
  source?: "local" | "comfy" | "none";
  downloadsEnabled?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, DownloadJob>>({});
  const [banner, setBanner] = useState(message);
  const [src, setSrc] = useState(source);
  const [canDownload, setCanDownload] = useState(downloadsEnabled);
  const [dir, setDir] = useState(modelsDir);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/models");
    const data = await res.json();
    if (data.ok) {
      setItems(data.items ?? []);
      setBanner(data.message ?? null);
      setSrc(data.source ?? "none");
      setCanDownload(Boolean(data.downloadsEnabled));
      setDir(data.modelsDir ?? null);
    }
  }, []);

  useEffect(() => {
    const downloading = items.filter((i) => i.status === "downloading" && i.downloadJobId);
    if (downloading.length === 0) return;
    const timer = window.setInterval(async () => {
      for (const item of downloading) {
        if (!item.downloadJobId) continue;
        const res = await fetch(
          `/api/models/download/${encodeURIComponent(item.downloadJobId)}`
        );
        const data = await res.json();
        if (data.ok && data.job) {
          setJobs((prev) => ({ ...prev, [data.job.id]: data.job }));
          if (data.job.status === "done" || data.job.status === "error") {
            await refresh();
          }
        }
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [items, refresh]);

  async function startDownload(modelId: string) {
    setBusyId(modelId);
    try {
      const res = await fetch("/api/models/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json();
      if (data.ok && data.job) {
        setJobs((prev) => ({ ...prev, [data.job.id]: data.job }));
        await refresh();
      } else {
        alert(data.error ?? "Nie udało się rozpocząć pobierania");
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {banner ? (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {banner}
        </p>
      ) : null}

      {src === "local" && dir ? (
        <p className="text-sm text-stone-500">
          Katalog modeli: <code className="text-stone-300">{dir}</code>
        </p>
      ) : null}

      {src === "comfy" ? (
        <p className="text-sm text-stone-500">
          Źródło: ComfyUI API (<code className="text-stone-300">/models/…</code> przez{" "}
          <code className="text-stone-300">COMFYUI_URL</code>). Pobieranie na dysk tylko przy
          lokalnym <code className="text-stone-300">COMFYUI_MODELS_DIR</code>.
        </p>
      ) : null}

      {!configured ? (
        <p className="text-sm text-stone-500">
          Brak połączenia z modelami — sprawdź Comfy / tunel albo ustaw lokalny katalog.
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg border border-studio-border px-3 py-1.5 text-sm text-stone-300 hover:border-teal-400/40 hover:text-teal-100"
        >
          Odśwież listę
        </button>
      </div>

      <ul className="divide-y divide-studio-border border-y border-studio-border">
        {items.map((item) => {
          const job =
            (item.downloadJobId && jobs[item.downloadJobId]) ||
            undefined;
          const percent = job?.percent;
          return (
            <li
              key={item.id}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p
                  className="text-lg font-semibold text-stone-100"
                  style={{ fontFamily: "var(--font-studio-display), system-ui" }}
                >
                  {item.name}
                </p>
                <p className="text-sm text-stone-400">
                  {item.type} · {item.filename} · {item.sizeHint}
                </p>
                <p className="text-sm text-stone-500">{item.notes}</p>
                {item.status === "downloading" && percent != null ? (
                  <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-studio-track">
                    <div
                      className="h-full bg-teal-400 transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                ) : null}
                {item.status === "error" && item.error ? (
                  <p className="text-sm text-rose-300">{item.error}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <StatusPill status={item.status} />
                {item.status !== "ready" && canDownload ? (
                  <button
                    type="button"
                    disabled={busyId === item.id || item.status === "downloading"}
                    onClick={() => void startDownload(item.id)}
                    className="rounded-lg bg-teal-400/90 px-3 py-1.5 text-sm font-semibold text-studio-cta-fg disabled:opacity-50"
                  >
                    Pobierz
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusPill({ status }: { status: ModelLibraryItem["status"] }) {
  const map = {
    ready: "gotowy",
    missing: "brak",
    downloading: "pobieranie",
    error: "błąd",
  } as const;
  const colors = {
    ready: "text-teal-200 bg-teal-400/10",
    missing: "text-stone-300 bg-studio-surface",
    downloading: "text-amber-100 bg-amber-500/10",
    error: "text-rose-200 bg-rose-500/10",
  } as const;
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${colors[status]}`}>
      {map[status]}
    </span>
  );
}
