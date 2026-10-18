/**
 * Runtime override for COMFYUI_URL (Quick Tunnel URL changes without redeploy).
 *
 * Resolution order for resolveComfyUrl():
 * 1) in-memory cache (this instance)
 * 2) Vercel KV / Upstash REST (KV_REST_API_URL + KV_REST_API_TOKEN) — durable across instances
 * 3) process.env.COMFYUI_URL
 * 4) default localhost
 *
 * Without KV, override survives only on warm instances that received POST /api/settings/comfy-url.
 */

const KV_KEY = "aigen:comfyui_url";
const MEMORY_TTL_MS = 30_000;

type MemorySlot = {
  url: string;
  expiresAt: number;
};

declare global {
  var __aigenComfyUrlOverride: MemorySlot | undefined;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

function kvConfigured(): boolean {
  return Boolean(
    trimOrUndefined(process.env.KV_REST_API_URL) &&
      trimOrUndefined(process.env.KV_REST_API_TOKEN)
  );
}

function readMemory(): string | undefined {
  const slot = globalThis.__aigenComfyUrlOverride;
  if (!slot) return undefined;
  if (Date.now() > slot.expiresAt) return undefined;
  return slot.url;
}

function writeMemory(url: string, ttlMs = MEMORY_TTL_MS): void {
  globalThis.__aigenComfyUrlOverride = {
    url,
    expiresAt: Date.now() + ttlMs,
  };
}

/** Keep override sticky on the publishing instance (longer than read cache). */
function writeMemorySticky(url: string): void {
  writeMemory(url, 24 * 60 * 60 * 1000);
}

async function kvCommand(command: unknown[]): Promise<unknown> {
  const base = trimOrUndefined(process.env.KV_REST_API_URL);
  const token = trimOrUndefined(process.env.KV_REST_API_TOKEN);
  if (!base || !token) return null;

  const res = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KV ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { result?: unknown };
  return data.result ?? null;
}

async function readFromKv(): Promise<string | undefined> {
  if (!kvConfigured()) return undefined;
  try {
    const result = await kvCommand(["GET", KV_KEY]);
    if (typeof result === "string" && result.trim()) return result.trim();
    return undefined;
  } catch {
    return undefined;
  }
}

async function writeToKv(url: string): Promise<boolean> {
  if (!kvConfigured()) return false;
  await kvCommand(["SET", KV_KEY, url]);
  return true;
}

export function normalizeComfyPublishUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return trimmed;
}

export function getEnvComfyUrl(fallback: string): string {
  return trimOrUndefined(process.env.COMFYUI_URL) ?? fallback;
}

/** Sync read — memory then env. May be stale until resolveComfyUrl() hydrates KV. */
export function peekComfyUrl(fallback: string): string {
  return readMemory() ?? getEnvComfyUrl(fallback);
}

/** Async resolve with KV hydrate (preferred for API / RSC). */
export async function resolveComfyUrl(fallback: string): Promise<string> {
  const cached = readMemory();
  if (cached) return cached;

  const fromKv = await readFromKv();
  if (fromKv) {
    writeMemory(fromKv);
    return fromKv;
  }

  return getEnvComfyUrl(fallback);
}

export type SetComfyUrlResult = {
  url: string;
  durable: boolean;
  kvConfigured: boolean;
};

export async function setComfyUrlOverride(
  url: string
): Promise<SetComfyUrlResult> {
  const normalized = normalizeComfyPublishUrl(url);
  if (!normalized) {
    throw new Error("Invalid COMFYUI_URL");
  }

  writeMemorySticky(normalized);
  let durable = false;
  try {
    durable = await writeToKv(normalized);
  } catch {
    durable = false;
  }

  return {
    url: normalized,
    durable,
    kvConfigured: kvConfigured(),
  };
}

export function getComfyUrlUpdateSecret(): string | undefined {
  return (
    trimOrUndefined(process.env.COMFY_URL_UPDATE_SECRET) ??
    trimOrUndefined(process.env.REVALIDATE_SECRET)
  );
}
