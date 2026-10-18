"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Logowanie nieudane");
        return;
      }
      const safe =
        next.startsWith("/") && !next.startsWith("/login") ? next : "/";
      router.replace(safe);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-sm space-y-4">
      <label className="block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
          Hasło AIGen
        </span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          className="w-full rounded-lg border border-studio-border bg-studio-surface px-3 py-2.5 text-sm outline-none focus:border-teal-400/40 focus:ring-2 focus:ring-teal-400/20"
        />
      </label>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-teal-400 py-2.5 text-sm font-semibold text-studio-cta-fg disabled:opacity-60"
      >
        {pending ? "Sprawdzam…" : "Wejdź"}
      </button>
    </form>
  );
}
