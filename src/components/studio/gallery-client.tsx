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
            Źródło: {src === "comfy" ? "Comfy (historia)" : "dysk lokalny"}
          </p>
        ) : null}
      </div>

      {!configured || error ? (
        <p className="text-sm text-amber-200/80">{error ?? "Brak konfiguracji output."}</p>
      ) : null}

      {items.length === 0 && configured && !error ? (
        <p className="text-sm text-stone-500">
          Brak plików — wygeneruj obraz na zakładce Generuj (trafia do output / historii Comfy).
        </p>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="studio-fade-in overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]"
          >
            {item.kind === "video" ? (
              <video src={item.url} controls className="aspect-video w-full bg-black/50" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt={item.name}
                className="aspect-square w-full object-cover"
              />
            )}
            <div className="space-y-1 px-3 py-2.5">
              <p className="truncate text-sm text-stone-200">{item.name}</p>
              <p className="text-xs text-stone-500">
                {item.sizeBytes > 0
                  ? `${(item.sizeBytes / 1024).toFixed(0)} KB · `
                  : null}
                {new Date(item.mtimeMs).toLocaleString("pl-PL")}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
