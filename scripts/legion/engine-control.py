#!/usr/bin/env python3
"""
Sterowanie GPU na Legionie: ComfyUI albo lokalny koder Qwen (llama-server).

Nasłuch tylko dla panelu AIGen (Vercel albo inna maszyna). To NIE jest Comfy
i NIE wolno wystawiać tego procesu przez ingress tunelu na port 8188.
Tunel Comfy (COMFYUI_URL → 127.0.0.1:8188) to HTTP API Comfy, bez hasła panelu.
llama-server (:8080) zostaje w LAN.

Auth: Authorization: Bearer <LEGION_ENGINE_SECRET>
Bez sekretu proces w ogóle nie nasłuchuje.

  GET  /engine
  POST /engine  {"target":"comfy"|"coder","confirmActiveJob":false}

Aktywne zadanie Comfy (queue_running) nie jest zabijane bez confirmActiveJob.
Stop: PID nasłuchujący na porcie (stop-port-listener.ps1), nie nazwa python.
Start Comfy: scripts/legion/start-comfy-stack.ps1
Start kodera: QWEN_CODER_START_SCRIPT albo
  C:\\Users\\mkozl\\Models\\start-qwen-coder.ps1

Domyślny bind: 127.0.0.1:8199 (cloudflared na tej samej maszynie).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

_HERE = Path(__file__).resolve().parent
DEFAULT_QWEN_SCRIPT = r"C:\Users\mkozl\Models\start-qwen-coder.ps1"
DEFAULT_COMFY_PORT = 8188
DEFAULT_CODER_URL = "http://127.0.0.1:8080"
DEFAULT_BIND = "127.0.0.1"
DEFAULT_PORT = 8199
CONFIRM_ERROR = (
    "ComfyUI ma aktywne zadanie w kolejce. "
    "Potwierdź, żeby je zatrzymać i włączyć kodera Qwen."
)
_BEARER = re.compile(r"^Bearer\s+(\S+)\s*$", re.IGNORECASE)


def engine_side(comfy_online: bool, coder_online: bool) -> str:
    if comfy_online and coder_online:
        return "both"
    if comfy_online:
        return "comfy"
    if coder_online:
        return "coder"
    return "neither"


def secret_matches(provided: str, expected: str) -> bool:
    if not provided or not expected:
        return False
    return hmac.compare_digest(
        hashlib.sha256(provided.encode("utf-8")).digest(),
        hashlib.sha256(expected.encode("utf-8")).digest(),
    )


def _clip(text: str) -> str:
    flat = " ".join((text or "").split())
    if len(flat) > 280:
        return flat[-280:]
    return flat


class Runner:
    """Operacje na procesach i lokalnych portach. Testy podmieniają całą klasę."""

    comfy_port = DEFAULT_COMFY_PORT
    coder_port = 8080
    coder_url = DEFAULT_CODER_URL
    coder_wait_s = 180.0
    comfy_wait_s = 120.0

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)

    def comfy_online(self) -> bool:
        return _http_ok(f"http://127.0.0.1:{self.comfy_port}/system_stats", 3)

    def coder_online(self) -> bool:
        return _http_ok(self.coder_url.rstrip("/") + "/v1/models", 3)

    def comfy_queue_running(self) -> bool | None:
        """True = jest job, False = pusto, None = nie wiadomo (traktuj jak job)."""
        try:
            raw = _http_json(f"http://127.0.0.1:{self.comfy_port}/queue", 4)
        except Exception:
            return None
        running = raw.get("queue_running") if isinstance(raw, dict) else None
        return isinstance(running, list) and len(running) > 0

    def stop_port(self, port: int) -> str | None:
        if port not in (self.comfy_port, self.coder_port):
            return "Niedozwolony port."
        if sys.platform != "win32":
            return (
                "Start i stop procesów działa tylko na Windows (Legion). "
                "Na tym hoście nic nie zostało uruchomione."
            )
        script = _HERE / "stop-port-listener.ps1"
        if not script.is_file():
            return "Brak stop-port-listener.ps1."
        return _powershell([str(script), "-Port", str(port)], timeout=30, cwd=str(_HERE))

    def start_coder(self) -> str | None:
        if sys.platform != "win32":
            return "Start kodera działa tylko na Windows (Legion)."
        script = os.environ.get("QWEN_CODER_START_SCRIPT", DEFAULT_QWEN_SCRIPT).strip()
        problem = qwen_script_problem(script)
        if problem:
            return problem
        if not os.path.isfile(script):
            return (
                f"Brak skryptu startu kodera: {script}. "
                f"Ustaw QWEN_CODER_START_SCRIPT (domyślnie {DEFAULT_QWEN_SCRIPT})."
            )
        return _powershell([script], timeout=60, cwd=os.path.dirname(script) or None)

    def start_comfy(self) -> str | None:
        if sys.platform != "win32":
            return "Start ComfyUI działa tylko na Windows (Legion)."
        stack = _HERE / "start-comfy-stack.ps1"
        if not stack.is_file():
            return "Brak start-comfy-stack.ps1."
        args = [str(stack)]
        root = os.environ.get("COMFYUI_ROOT", "").strip()
        if root:
            if any(ch in root for ch in "\r\n\0"):
                return "COMFYUI_ROOT zawiera niedozwolone znaki."
            args += ["-ComfyRoot", root]
        err = _powershell(args, timeout=200, cwd=str(_HERE))
        # Tunel w stacku może krzyknąć, a Comfy i tak już odpowiada.
        if err and self.comfy_online():
            return None
        return err


def qwen_script_problem(script: str) -> str | None:
    if not script or any(ch in script for ch in "\r\n\0"):
        return "QWEN_CODER_START_SCRIPT jest puste albo zawiera niedozwolone znaki."
    if not script.lower().endswith(".ps1"):
        return "QWEN_CODER_START_SCRIPT musi wskazywać plik .ps1."
    return None


def _http_ok(url: str, timeout: float) -> bool:
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return 200 <= int(res.status) < 300
    except Exception:
        return False


def _http_json(url: str, timeout: float) -> Any:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8", errors="replace") or "{}")


def _powershell(file_and_args: list[str], timeout: float, cwd: str | None) -> str | None:
    cmd = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        *file_and_args,
    ]
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            timeout=timeout,
            text=True,
        )
    except subprocess.TimeoutExpired:
        return "PowerShell przekroczył czas oczekiwania."
    except FileNotFoundError:
        return "Brak powershell.exe — to nie jest Legion (Windows)."
    except OSError as exc:
        return f"Nie uruchomiono PowerShell: {exc}"
    if proc.returncode != 0:
        detail = _clip(f"{proc.stderr or ''} {proc.stdout or ''}")
        base = f"Polecenie zakończyło się kodem {proc.returncode}."
        return f"{base} {detail}".strip()
    return None


class EngineController:
    def __init__(self, secret: str, runner: Runner | None = None, *, background: bool = True):
        self.secret = secret.strip()
        self.runner = runner or Runner()
        self._background = background
        self._lock = threading.Lock()
        self.switching = False
        self.switch_error: str | None = None
        self.switch_target: str | None = None

    def status(self) -> dict[str, Any]:
        try:
            comfy = bool(self.runner.comfy_online())
        except Exception:
            comfy = False
        try:
            coder = bool(self.runner.coder_online())
        except Exception:
            coder = False
        queue = False
        if comfy:
            try:
                probed = self.runner.comfy_queue_running()
            except Exception:
                probed = None
            queue = True if probed is None else bool(probed)
        return {
            "ok": True,
            "side": engine_side(comfy, coder),
            "comfyOnline": comfy,
            "coderOnline": coder,
            "comfyQueueRunning": queue,
            "switching": self.switching,
            "switchError": self.switch_error,
            "switchTarget": self.switch_target,
        }

    def handle(self, method: str, path: str, headers: dict[str, str], body: bytes) -> tuple[int, dict[str, Any]]:
        if not self.secret:
            return 503, {
                "ok": False,
                "error": "Sterowanie wyłączone — brak LEGION_ENGINE_SECRET.",
            }
        if not self._authorized(headers):
            return 401, {"ok": False, "error": "Unauthorized"}

        clean = path.split("?", 1)[0].rstrip("/") or "/"
        if method == "GET" and clean == "/engine":
            return 200, self.status()
        if method == "POST" and clean == "/engine":
            return self._post(body)
        return 404, {"ok": False, "error": "Nie znaleziono"}

    def _authorized(self, headers: dict[str, str]) -> bool:
        raw = ""
        for key, value in headers.items():
            if key.lower() == "authorization":
                raw = value.strip()
                break
        match = _BEARER.match(raw)
        if not match:
            return False
        return secret_matches(match.group(1), self.secret)

    def _post(self, body: bytes) -> tuple[int, dict[str, Any]]:
        if len(body) > 4096:
            return 413, {"ok": False, "error": "Za duży body"}
        try:
            data = json.loads(body.decode("utf-8") or "{}")
        except Exception:
            return 400, {"ok": False, "error": "Nieprawidłowy JSON"}
        if not isinstance(data, dict):
            return 400, {"ok": False, "error": "Nieprawidłowy JSON"}
        target = data.get("target")
        confirm = data.get("confirmActiveJob") is True
        if target not in ("comfy", "coder"):
            return 400, {"ok": False, "error": "Pole target: comfy albo coder."}
        return self.request_switch(str(target), confirm)

    def request_switch(self, target: str, confirm: bool) -> tuple[int, dict[str, Any]]:
        with self._lock:
            if self.switching:
                return 409, {
                    "ok": False,
                    "needsConfirm": False,
                    "switching": True,
                    "error": "Przełączanie już trwa.",
                }
            snap = self.status()
            if snap["side"] == target:
                return 200, {**snap, "needsConfirm": False}
            if (
                target == "coder"
                and snap["comfyOnline"]
                and snap["comfyQueueRunning"]
                and not confirm
            ):
                return 409, {
                    "ok": False,
                    "needsConfirm": True,
                    "switching": False,
                    "comfyQueueRunning": True,
                    "error": CONFIRM_ERROR,
                }
            self.switching = True
            self.switch_error = None
            self.switch_target = target

        if self._background:
            threading.Thread(
                target=self._run_switch,
                args=(target, confirm),
                daemon=True,
                name="engine-switch",
            ).start()
            return 202, {
                "ok": True,
                "switching": True,
                "needsConfirm": False,
                "target": target,
            }

        self._run_switch(target, confirm)
        snap = self.status()
        if self.switch_error:
            return 502, {
                "ok": False,
                "needsConfirm": False,
                "error": self.switch_error,
                **snap,
            }
        return 200, {"needsConfirm": False, **snap}

    def _run_switch(self, target: str, confirm: bool) -> None:
        try:
            self.switch_error = self._switch_body(target, confirm)
        except Exception as exc:
            self.switch_error = str(exc) or "Przełączenie nieudane."
        finally:
            with self._lock:
                self.switching = False

    def _switch_body(self, target: str, confirm: bool) -> str | None:
        runner = self.runner
        if target == "coder":
            if runner.comfy_online():
                probed = runner.comfy_queue_running()
                active = True if probed is None else bool(probed)
                if active and not confirm:
                    return CONFIRM_ERROR
            err = self._stop_and_wait(
                runner.comfy_port, runner.comfy_online, "ComfyUI"
            )
            if err:
                return err
            if not runner.coder_online():
                err = runner.start_coder()
                if err:
                    return err
            if not self._wait(runner.coder_online, runner.coder_wait_s):
                return (
                    "Koder Qwen nie odpowiedział na GET /v1/models. "
                    "Panel nie pobiera modelu — sprawdź skrypt startu na Legionie."
                )
            return None

        err = self._stop_and_wait(runner.coder_port, runner.coder_online, "Koder Qwen")
        if err:
            return err
        if not runner.comfy_online():
            err = runner.start_comfy()
            if err:
                return err
        if not self._wait(runner.comfy_online, runner.comfy_wait_s):
            return "ComfyUI nie odpowiedział na /system_stats."
        return None

    def _stop_and_wait(self, port: int, online: Callable[[], bool], label: str) -> str | None:
        was = False
        try:
            was = bool(online())
        except Exception:
            was = False
        err = self.runner.stop_port(port)
        if err:
            return err
        timeout = 20.0 if was else 2.0
        if not self._wait(lambda: not online(), timeout):
            return f"{label} nadal odpowiada — drugi proces nie został uruchomiony."
        if was:
            self.runner.sleep(1.5)
        return None

    def _wait(self, pred: Callable[[], bool], timeout: float) -> bool:
        deadline = time.monotonic() + max(0.0, timeout)
        while True:
            try:
                if pred():
                    return True
            except Exception:
                pass
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.05)


def _header_map(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in handler.headers.items():
        out[key] = value
    return out


def make_handler(controller: EngineController) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:  # noqa: N802
            self._dispatch(b"")

        def do_POST(self) -> None:  # noqa: N802
            try:
                length = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                length = 0
            if length > 4096:
                self._send(413, {"ok": False, "error": "Za duży body"})
                return
            body = self.rfile.read(length) if length > 0 else b""
            self._dispatch(body)

        def _dispatch(self, body: bytes) -> None:
            code, payload = controller.handle(
                self.command, self.path, _header_map(self), body
            )
            self._send(code, payload)

        def _send(self, code: int, payload: dict[str, Any]) -> None:
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, fmt: str, *args: Any) -> None:
            # Linia żądania, bez nagłówka Authorization.
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    return Handler


def serve(controller: EngineController, host: str, port: int) -> None:
    if port in (8080, 8188):
        raise SystemExit(
            "LEGION_ENGINE_PORT nie może być 8080 (llama-server) ani 8188 (Comfy)."
        )
    httpd = ThreadingHTTPServer((host, port), make_handler(controller))
    httpd.daemon_threads = True
    print(f"engine-control http://{host}:{port}/engine", flush=True)
    httpd.serve_forever()


def main() -> None:
    secret = os.environ.get("LEGION_ENGINE_SECRET", "").strip()
    if not secret:
        print(
            "Brak LEGION_ENGINE_SECRET — nie nasluchuje "
            "(bez sekretu sterowanie procesami jest wylaczone).",
            file=sys.stderr,
        )
        raise SystemExit(1)
    host = os.environ.get("LEGION_ENGINE_LISTEN", DEFAULT_BIND).strip() or DEFAULT_BIND
    try:
        port = int(os.environ.get("LEGION_ENGINE_PORT", str(DEFAULT_PORT)))
    except ValueError:
        print("LEGION_ENGINE_PORT musi byc liczba.", file=sys.stderr)
        raise SystemExit(1)
    if port < 1 or port > 65535:
        print("LEGION_ENGINE_PORT poza zakresem.", file=sys.stderr)
        raise SystemExit(1)
    serve(EngineController(secret, Runner(), background=True), host, port)


if __name__ == "__main__":
    main()
