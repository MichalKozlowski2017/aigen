"use client";

import { useEffect, useState } from "react";
import type { GalleryItem } from "@/lib/studio/types";

export function GalleryClient({
  initialItems,
  configured,
  message,
  source = "none",
}: {
  initialItems: GalleryItem[];
  configured: boolean;
  message: string | null;
  source?: "local" | "comfy" | "none";
}) {
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(message);
  const [src, setSrc] = useState(source);
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/gallery?kind=${kind}&limit=80`);
      const data = await res.json();
      if (cancelled) return;
      if (!data.ok) {
        setError(data.error ?? "Błąd galerii");
        return;
      }
      setItems(data.items ?? []);
      setError(data.error);
      setSrc(data.source ?? "none");
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  async function downloadItem(item: GalleryItem) {
    setDownloadBusy(item.id);
    setError(null);
    try {
      const res = await fetch(item.url);
      if (!res.ok) {
        throw new Error(`Pobieranie HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = item.name || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udało się pobrać pliku"
      );
    } finally {
      setDownloadBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["all", "image", "video"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={[
                "rounded-md px-3 py-1.5 text-sm transition",
                kind === k
                  ? "bg-teal-400/15 text-teal-100"
                  : "text-stone-400 hover:bg-white/[0.04]",
              ].join(" ")}
            >
              {k === "all" ? "Wszystko" : k === "image" ? "Obrazy" : "Wideo"}
            </button>
          ))}
        </div>
        {src !== "none" ? (
          <p className="text-xs text-stone-500">
            Źródło:{" "}
            {src === "comfy" ? "Comfy (indeks / historia)" : "dysk lokalny"}
          </p>
        ) : null}
      </div>

      {!configured || error ? (
        <p className="text-sm text-amber-200/80">
          {error ?? "Brak konfiguracji output."}
        </p>
      ) : null}

      {items.length === 0 && configured && !error ? (
        <p className="text-sm text-stone-500">
          Brak plików — wygeneruj obraz na zakładce Generuj (trafia do output /
          historii Comfy).
        </p>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const subHint =
            item.comfy?.subfolder != null && item.comfy.subfolder !== ""
              ? item.comfy.subfolder
              : null;
          return (
            <li
              key={item.id}
              className="studio-fade-in overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]"
            >
              {item.kind === "video" ? (
                <video
                  key={item.url}
                  src={item.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-video w-full bg-black/50"
                >
                  <a href={item.url}>Otwórz wideo</a>
                </video>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt={item.name}
                  className="aspect-square w-full object-cover"
                />
              )}
              <div className="space-y-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-stone-200">{item.name}</p>
                  <p className="text-xs text-stone-500">
                    {subHint ? (
                      <span className="text-stone-400">{subHint}/ · </span>
                    ) : null}
                    {item.sizeBytes > 0
                      ? `${(item.sizeBytes / 1024).toFixed(0)} KB · `
                      : null}
                    {new Date(item.mtimeMs).toLocaleString("pl-PL")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void downloadItem(item)}
                    disabled={downloadBusy === item.id}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-stone-200 transition hover:border-teal-400/40 hover:text-teal-100 disabled:opacity-50"
                  >
                    {downloadBusy === item.id ? "Pobieram…" : "Pobierz"}
                  </button>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-stone-400 transition hover:border-white/20 hover:text-stone-200"
                  >
                    Otwórz
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
