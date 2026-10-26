import type {
  EngineSide,
  EngineSwitchTarget,
  EngineSwitchView,
} from "./types";

const UNSET_URL =
  "Przełącznik niedostępny — brak LEGION_ENGINE_URL. Tunel Comfy (COMFYUI_URL, port 8188) nie zatrzymuje procesów.";

const UNSET_SECRET =
  "Przełącznik niedostępny — brak LEGION_ENGINE_SECRET. Panel nie wywołuje sterowania bez sekretu.";

export type LegionEngineConfig =
  | { ok: true; url: string; secret: string }
  | { ok: false; reason: string };

export function legionEngineAvailability(
  env: Record<string, string | undefined> = process.env
): LegionEngineConfig {
  const urlRaw = env.LEGION_ENGINE_URL?.trim() ?? "";
  const secret = env.LEGION_ENGINE_SECRET?.trim() ?? "";
  if (!urlRaw) return { ok: false, reason: UNSET_URL };

  let parsed: URL;
  try {
    parsed = new URL(urlRaw);
  } catch {
    return {
      ok: false,
      reason: "Przełącznik niedostępny — LEGION_ENGINE_URL jest nieprawidłowy.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: "Przełącznik niedostępny — LEGION_ENGINE_URL musi być http(s).",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reason:
        "Przełącznik niedostępny — sekret podaj w LEGION_ENGINE_SECRET, nie w adresie URL.",
    };
  }
  if (!secret) return { ok: false, reason: UNSET_SECRET };

  const path = parsed.pathname.replace(/\/$/, "");
  return { ok: true, url: `${parsed.origin}${path === "/" ? "" : path}`, secret };
}

function emptyView(partial: Partial<EngineSwitchView> & Pick<EngineSwitchView, "available">): EngineSwitchView {
  return {
    ok: true,
    unavailableReason: null,
    side: null,
    comfyOnline: false,
    coderOnline: false,
    comfyQueueRunning: false,
    switching: false,
    switchTarget: null,
    switchError: null,
    unreachable: false,
    ...partial,
  };
}

function asSide(value: unknown): EngineSide | null {
  if (value === "comfy" || value === "coder" || value === "neither" || value === "both") {
    return value;
  }
  return null;
}

function asTarget(value: unknown): EngineSwitchTarget | null {
  if (value === "comfy" || value === "coder") return value;
  return null;
}

export function mapLegionStatus(data: Record<string, unknown>): EngineSwitchView {
  return emptyView({
    available: true,
    side: asSide(data.side),
    comfyOnline: data.comfyOnline === true,
    coderOnline: data.coderOnline === true,
    comfyQueueRunning: data.comfyQueueRunning === true,
    switching: data.switching === true,
    switchTarget: asTarget(data.switchTarget ?? data.target),
    switchError: typeof data.switchError === "string" ? data.switchError : null,
  });
}

async function legionCall(
  cfg: { url: string; secret: string },
  method: "GET" | "POST",
  body: unknown,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<Response> {
  return fetchImpl(`${cfg.url}/engine`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.secret}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function getEngineSwitchView(opts?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<EngineSwitchView> {
  const avail = legionEngineAvailability(opts?.env ?? process.env);
  if (!avail.ok) {
    return emptyView({ available: false, unavailableReason: avail.reason });
  }
  const fetchImpl = opts?.fetchImpl ?? fetch;
  try {
    const res = await legionCall(avail, "GET", undefined, fetchImpl, 8_000);
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 401) {
      return emptyView({
        available: true,
        unreachable: true,
        switchError: "Legion odrzucił sekret sterowania (LEGION_ENGINE_SECRET).",
      });
    }
    if (!res.ok || !data || data.ok === false) {
      const error =
        data && typeof data.error === "string"
          ? data.error
          : `Sterowanie Legionu: HTTP ${res.status}`;
      return emptyView({ available: true, unreachable: true, switchError: error });
    }
    return mapLegionStatus(data);
  } catch {
    return emptyView({
      available: true,
      unreachable: true,
      switchError: "Nie można połączyć się ze sterowaniem Legionu.",
    });
  }
}

export type EngineSwitchResult = {
  httpStatus: number;
  body: {
    ok: boolean;
    available: boolean;
    needsConfirm: boolean;
    error?: string;
    switching?: boolean;
    status?: EngineSwitchView;
  };
};

export async function postEngineSwitch(
  input: { target: EngineSwitchTarget; confirmActiveJob: boolean },
  opts?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }
): Promise<EngineSwitchResult> {
  const avail = legionEngineAvailability(opts?.env ?? process.env);
  if (!avail.ok) {
    return {
      httpStatus: 403,
      body: {
        ok: false,
        available: false,
        needsConfirm: false,
        error: avail.reason,
      },
    };
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  try {
    const res = await legionCall(
      avail,
      "POST",
      { target: input.target, confirmActiveJob: input.confirmActiveJob },
      fetchImpl,
      20_000
    );
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 409 && data?.needsConfirm === true) {
      return {
        httpStatus: 409,
        body: {
          ok: false,
          available: true,
          needsConfirm: true,
          error:
            typeof data.error === "string"
              ? data.error
              : "ComfyUI ma aktywne zadanie w kolejce. Potwierdź, żeby je zatrzymać i włączyć kodera Qwen.",
        },
      };
    }
    if (!res.ok || !data || data.ok === false) {
      const error =
        data && typeof data.error === "string"
          ? data.error
          : res.status === 401
            ? "Legion odrzucił sekret sterowania."
            : "Nie udało się przełączyć silnika na Legionie.";
      return {
        httpStatus: res.status === 401 ? 502 : res.status || 502,
        body: { ok: false, available: true, needsConfirm: false, error },
      };
    }
    const switching = data.switching === true;
    const status = typeof data.side === "string" ? mapLegionStatus(data) : undefined;
    return {
      httpStatus: 200,
      body: {
        ok: true,
        available: true,
        needsConfirm: false,
        switching,
        status,
      },
    };
  } catch {
    return {
      httpStatus: 502,
      body: {
        ok: false,
        available: true,
        needsConfirm: false,
        error: "Nie można połączyć się ze sterowaniem Legionu.",
      },
    };
  }
}
