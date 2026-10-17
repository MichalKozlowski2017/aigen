/**
 * Live progress z ComfyUI WebSocket (outbound z Next → tunel).
 * Cache w pamięci procesu — na warm instance między pollami; cold start
 * i tak złapie kolejny event progress przy ensureLiveProgressFeed().
 */

import { getComfyUrl } from "./config";

export type LiveComfyProgress = {
  promptId: string;
  value: number;
  max: number;
  nodeId: string | null;
  updatedAt: number;
};

type ExecutingCache = {
  nodeId: string | null;
  updatedAt: number;
};

const STALE_MS = 180_000;
const progressByPrompt = new Map<string, LiveComfyProgress>();
const executingByPrompt = new Map<string, ExecutingCache>();

let ws: WebSocket | null = null;
let connectPromise: Promise<void> | null = null;
let lastMessageAt = 0;
const CLIENT_ID = `aigen-progress-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

function wsUrl(): string {
  const base = getComfyUrl().replace(/\/$/, "");
  const u = new URL(base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  // Zachowaj ścieżkę bazową jeśli tunel ma prefix; typowo root.
  const path = u.pathname.replace(/\/$/, "");
  u.pathname = `${path}/ws` || "/ws";
  u.search = `clientId=${encodeURIComponent(CLIENT_ID)}`;
  return u.toString();
}

function handlePayload(raw: string): void {
  let msg: { type?: string; data?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    return;
  }
  const type = msg.type;
  const data = msg.data ?? {};
  lastMessageAt = Date.now();

  if (type === "progress") {
    const promptId = data.prompt_id != null ? String(data.prompt_id) : "";
    if (!promptId) return;
    const value = Number(data.value ?? 0);
    const max = Number(data.max ?? 0);
    progressByPrompt.set(promptId, {
      promptId,
      value,
      max,
      nodeId: data.node != null ? String(data.node) : null,
      updatedAt: Date.now(),
    });
    return;
  }

  if (type === "executing") {
    const promptId = data.prompt_id != null ? String(data.prompt_id) : "";
    if (!promptId) return;
    // node=null = execution finished for this prompt on this client view
    const nodeId = data.node != null ? String(data.node) : null;
    executingByPrompt.set(promptId, { nodeId, updatedAt: Date.now() });
    return;
  }
}

function attachHandlers(socket: WebSocket): void {
  socket.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? ev.data : null;
    if (data) handlePayload(data);
  });
  socket.addEventListener("close", () => {
    if (ws === socket) ws = null;
  });
  socket.addEventListener("error", () => {
    try {
      socket.close();
    } catch {
      // ignore
    }
    if (ws === socket) ws = null;
  });
}

function openSocket(): Promise<void> {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = ws!;
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("Comfy WS connect failed"));
      };
      const cleanup = () => {
        s.removeEventListener("open", onOpen);
        s.removeEventListener("error", onErr);
      };
      s.addEventListener("open", onOpen);
      s.addEventListener("error", onErr);
    });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      const socket = new WebSocket(wsUrl());
      ws = socket;
      attachHandlers(socket);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Po timeout i tak zostaw socket — może dojść open w tle
        resolve();
      }, 2_500);
      socket.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("Comfy WS error"));
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Upewnij się, że feed WS żyje; opcjonalnie poczekaj na event (sampling tick).
 */
export async function ensureLiveProgressFeed(waitMs = 0): Promise<void> {
  try {
    if (!connectPromise) {
      connectPromise = openSocket().finally(() => {
        connectPromise = null;
      });
    }
    await connectPromise;
  } catch {
    // Tunel/WS niedostępny — poll HTTP i tak działa bez live stepów
    return;
  }

  if (waitMs <= 0) return;
  const start = Date.now();
  const before = lastMessageAt;
  while (Date.now() - start < waitMs) {
    if (lastMessageAt > before) return;
    await new Promise((r) => setTimeout(r, 80));
  }
}

export function getCachedLiveProgress(
  promptId: string
): LiveComfyProgress | null {
  const p = progressByPrompt.get(promptId);
  if (!p) return null;
  if (Date.now() - p.updatedAt > STALE_MS) {
    progressByPrompt.delete(promptId);
    return null;
  }
  return p;
}

export function getCachedExecutingNode(promptId: string): string | null {
  const e = executingByPrompt.get(promptId);
  if (!e) return null;
  if (Date.now() - e.updatedAt > STALE_MS) {
    executingByPrompt.delete(promptId);
    return null;
  }
  return e.nodeId;
}

/** Test / cleanup helper */
export function _resetLiveProgressForTests(): void {
  progressByPrompt.clear();
  executingByPrompt.clear();
  try {
    ws?.close();
  } catch {
    // ignore
  }
  ws = null;
  connectPromise = null;
}
