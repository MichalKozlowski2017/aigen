"use client";

import { useEffect, useState } from "react";
import type { JobProgress } from "@/lib/studio/comfy-client";
import {
  classifyNodeType,
  formatPolishPhase,
  percentForStage,
} from "@/lib/studio/comfy-progress";

export type LiveWsOverlay = {
  promptId: string;
  step: number | null;
  stepMax: number | null;
  nodeId: string | null;
  percent: number | null;
  phase: string;
  stage: JobProgress["stage"];
  updatedAt: number;
};

function toWsUrl(comfyHttpUrl: string, clientId: string): string {
  const u = new URL(comfyHttpUrl.replace(/\/$/, ""));
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  const path = u.pathname.replace(/\/$/, "");
  u.pathname = `${path}/ws` || "/ws";
  u.search = `clientId=${encodeURIComponent(clientId)}`;
  return u.toString();
}

/**
 * Bezpośredni WS do Comfy (tunel) — sampling step i/N między pollami API.
 * Gdy WS niedostępny (CORS/offline), overlay = null; poll HTTP i tak działa.
 */
export function useComfyWsProgress(
  comfyUrl: string | null | undefined,
  promptId: string | null | undefined,
  enabled: boolean
): LiveWsOverlay | null {
  const [overlay, setOverlay] = useState<LiveWsOverlay | null>(null);
  const [clientId] = useState(
    () => `aigen-ui-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`
  );

  useEffect(() => {
    if (!enabled || !comfyUrl || !promptId) {
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      try {
        socket = new WebSocket(toWsUrl(comfyUrl, clientId));
      } catch {
        scheduleRetry();
        return;
      }

      socket.addEventListener("open", () => {
        attempt = 0;
      });

      socket.addEventListener("message", (ev) => {
        if (cancelled || typeof ev.data !== "string") return;
        let msg: { type?: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(ev.data) as typeof msg;
        } catch {
          return;
        }
        const data = msg.data ?? {};
        const msgPrompt =
          data.prompt_id != null ? String(data.prompt_id) : "";
        if (msgPrompt && msgPrompt !== promptId) return;

        if (msg.type === "progress") {
          const step = Number(data.value ?? 0);
          const stepMax = Number(data.max ?? 0);
          if (!(stepMax > 0)) return;
          const stage = "sampling" as const;
          setOverlay({
            promptId,
            step,
            stepMax,
            nodeId: data.node != null ? String(data.node) : null,
            percent: percentForStage({ stage, step, stepMax }),
            phase: formatPolishPhase({ stage, step, stepMax }),
            stage,
            updatedAt: Date.now(),
          });
          return;
        }

        if (msg.type === "executing") {
          const nodeId = data.node != null ? String(data.node) : null;
          if (nodeId == null) return;
          const stage = classifyNodeType(null);
          setOverlay((prev) => ({
            promptId,
            step: prev?.promptId === promptId ? (prev.step ?? null) : null,
            stepMax:
              prev?.promptId === promptId ? (prev.stepMax ?? null) : null,
            nodeId,
            percent:
              prev?.promptId === promptId
                ? (prev.percent ??
                  percentForStage({ stage, preferIndeterminate: true }))
                : percentForStage({ stage, preferIndeterminate: true }),
            phase:
              prev?.promptId === promptId &&
              prev.stage === "sampling" &&
              prev.step != null &&
              prev.stepMax
                ? prev.phase
                : formatPolishPhase({ stage }),
            stage:
              prev?.promptId === promptId && prev.stage === "sampling"
                ? prev.stage
                : stage,
            updatedAt: Date.now(),
          }));
        }
      });

      socket.addEventListener("close", () => {
        if (!cancelled) scheduleRetry();
      });
      socket.addEventListener("error", () => {
        try {
          socket?.close();
        } catch {
          // ignore
        }
      });
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      attempt += 1;
      const delay = Math.min(15_000, 1_000 * attempt);
      retryTimer = window.setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      try {
        socket?.close();
      } catch {
        // ignore
      }
    };
  }, [comfyUrl, promptId, enabled, clientId]);

  if (!enabled || !comfyUrl || !promptId) return null;
  if (!overlay || overlay.promptId !== promptId) return null;
  return overlay;
}

/** Scal poll HTTP + live WS (WS wygrywa gdy świeższy sampling). */
export function mergeJobProgressWithWs(
  base: JobProgress | null,
  ws: LiveWsOverlay | null
): JobProgress | null {
  if (!base && !ws) return null;
  if (!ws) return base;
  if (!base) {
    return {
      percent: ws.percent,
      phase: ws.phase,
      stage: ws.stage,
      step: ws.step,
      stepMax: ws.stepMax,
      queuePending: 0,
      queueRunning: true,
      currentNodeId: ws.nodeId,
      currentNodeType: null,
      nodesDone: null,
      nodesTotal: null,
      executionStartMs: null,
      errorMessage: null,
      errorHint: null,
      errorLinkHref: null,
      errorLinkLabel: null,
    };
  }

  const wsFresh = Date.now() - ws.updatedAt < 8_000;
  if (!wsFresh) return base;

  if (ws.stage === "sampling" && ws.step != null && ws.stepMax) {
    const samplingPct =
      ws.percent ??
      percentForStage({
        stage: "sampling",
        step: ws.step,
        stepMax: ws.stepMax,
      });
    // Pipeline: „Wan chunk 1/2 — …” — przelicz % w paśmie chunka (nie nadpisuj 0–100 joba)
    const chunkMatch = base.phase.match(/chunk\s+(\d+)\s*\/\s*(\d+)/i);
    let percent = samplingPct ?? base.percent;
    if (chunkMatch && samplingPct != null) {
      const idx = Number(chunkMatch[1]) - 1;
      const n = Number(chunkMatch[2]);
      if (n > 0) {
        const bandBase = (idx / n) * 90;
        const span = 90 / n;
        percent = Math.min(
          94,
          Math.round(bandBase + (samplingPct / 100) * span)
        );
      }
    }
    const phase = ws.phase.includes("chunk")
      ? ws.phase
      : /chunk\s+\d+/i.test(base.phase)
        ? base.phase.replace(/\s*—\s*.*$/, ` — ${ws.phase}`)
        : ws.phase;
    return {
      ...base,
      percent,
      phase,
      stage: "sampling",
      step: ws.step,
      stepMax: ws.stepMax,
      currentNodeId: ws.nodeId ?? base.currentNodeId,
    };
  }

  return {
    ...base,
    currentNodeId: ws.nodeId ?? base.currentNodeId,
  };
}
