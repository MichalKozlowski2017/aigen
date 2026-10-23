#!/usr/bin/env python3
"""Sterowanie GPU na Legionie — bez startu Comfy, llama-server i PowerShell."""

from __future__ import annotations

import importlib.util
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "engine_control", ROOT / "scripts" / "legion" / "engine-control.py"
)
assert SPEC and SPEC.loader
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


class FakeRunner:
    def __init__(self) -> None:
        self.comfy = False
        self.coder = False
        self.queue = False
        self.queue_unknown = False
        self.calls: list[tuple] = []
        self.comfy_port = 8188
        self.coder_port = 8080
        self.coder_wait_s = 1.0
        self.comfy_wait_s = 1.0
        self.stop_error: str | None = None
        self.start_error: str | None = None

    def sleep(self, _seconds: float) -> None:
        return None

    def comfy_online(self) -> bool:
        return self.comfy

    def coder_online(self) -> bool:
        return self.coder

    def comfy_queue_running(self):
        if self.queue_unknown:
            return None
        return self.queue

    def stop_port(self, port: int):
        self.calls.append(("stop", port))
        if self.stop_error:
            return self.stop_error
        if port == self.comfy_port:
            self.comfy = False
            self.queue = False
        if port == self.coder_port:
            self.coder = False
        return None

    def start_coder(self):
        self.calls.append(("start_coder",))
        if self.start_error:
            return self.start_error
        self.coder = True
        return None

    def start_comfy(self):
        self.calls.append(("start_comfy",))
        if self.start_error:
            return self.start_error
        self.comfy = True
        return None


def expect(cond: bool, msg: str) -> None:
    if not cond:
        raise SystemExit(msg)


def test_paths_and_platform_guard() -> None:
    expect(mod.DEFAULT_QWEN_SCRIPT.endswith("start-qwen-coder.ps1"), "default script")
    expect(r"mkozl\Models" in mod.DEFAULT_QWEN_SCRIPT, "legion default dir")
    expect(mod.qwen_script_problem(mod.DEFAULT_QWEN_SCRIPT) is None, "default path ok")
    expect(mod.qwen_script_problem("C:\\x\\evil\n.ps1") is not None, "newline rejected")
    expect(mod.qwen_script_problem("C:\\x\\not-a-script.txt") is not None, "suffix")
    runner = mod.Runner()
    stopped = runner.stop_port(8188)
    expect(stopped is not None and "Windows" in stopped, stopped or "missing windows msg")
    denied = runner.stop_port(9999)
    expect(denied is not None and "Niedozwolony" in denied, denied or "port")
    coder = runner.start_coder()
    expect(coder is not None and "Windows" in coder, coder or "coder")
    comfy = runner.start_comfy()
    expect(comfy is not None and "Windows" in comfy, comfy or "comfy")
    expect(mod.engine_side(True, False) == "comfy", "side comfy")
    expect(mod.engine_side(False, True) == "coder", "side coder")
    expect(mod.engine_side(False, False) == "neither", "side neither")
    expect(mod.engine_side(True, True) == "both", "side both")


def test_auth_and_confirm() -> None:
    runner = FakeRunner()
    ctl = mod.EngineController("sekret", runner, background=False)
    code, _ = ctl.handle("GET", "/engine", {}, b"")
    expect(code == 401, f"no auth {code}")
    expect(runner.calls == [], "unauth must not touch processes")

    code, _ = ctl.handle(
        "POST",
        "/engine",
        {"Authorization": "Bearer zly"},
        b'{"target":"coder","confirmActiveJob":true}',
    )
    expect(code == 401, f"bad secret {code}")
    expect(runner.calls == [], "bad secret must not stop anything")

    open_ctl = mod.EngineController("", runner, background=False)
    code, body = open_ctl.handle("POST", "/engine", {"Authorization": "Bearer x"}, b"{}")
    expect(code == 503, f"empty secret {code} {body}")

    runner.comfy = True
    runner.queue = True
    code, body = ctl.handle(
        "POST",
        "/engine",
        {"Authorization": "Bearer sekret"},
        b'{"target":"coder"}',
    )
    expect(code == 409 and body.get("needsConfirm") is True, f"confirm {code} {body}")
    expect(runner.calls == [], "first click must not kill the job")
    expect(runner.comfy is True, "comfy still up")

    runner.queue_unknown = True
    runner.queue = False
    code, body = ctl.request_switch("coder", False)
    expect(code == 409 and body.get("needsConfirm") is True, "unknown queue confirms")
    expect(runner.calls == [], "unknown queue did not stop")
    runner.queue_unknown = False


def test_switch_sequences() -> None:
    runner = FakeRunner()
    runner.comfy = True
    ctl = mod.EngineController("sekret", runner, background=False)
    code, body = ctl.request_switch("coder", True)
    expect(code == 200, f"coder {code} {body}")
    expect(runner.calls == [("stop", 8188), ("start_coder",)], f"calls {runner.calls}")
    expect(runner.coder is True and runner.comfy is False, "sides")
    expect("python" not in str(runner.calls), "not killed by name")

    runner.calls.clear()
    code, body = ctl.request_switch("coder", False)
    expect(code == 200 and runner.calls == [], f"idempotent {code} {runner.calls}")

    code, body = ctl.request_switch("comfy", False)
    expect(code == 200, f"comfy {code} {body}")
    expect(runner.calls == [("stop", 8080), ("start_comfy",)], f"comfy calls {runner.calls}")
    expect(runner.comfy is True and runner.coder is False, "comfy side")

    runner.calls.clear()
    runner.comfy = True
    runner.coder = False
    runner.stop_error = "port zajety"
    code, body = ctl.request_switch("coder", True)
    expect(code == 502, f"stop fail {code} {body}")
    expect(runner.calls == [("stop", 8188)], f"no start after failed stop {runner.calls}")
    expect(runner.coder is False, "coder not started")


def test_http_server() -> None:
    runner = FakeRunner()
    runner.comfy = True
    runner.queue = True
    ctl = mod.EngineController("sekret", runner, background=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), mod.make_handler(ctl))
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}/engine"

    def call(method: str, auth: str | None, payload: dict | None = None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(base, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if auth:
            req.add_header("Authorization", auth)
        try:
            with urllib.request.urlopen(req, timeout=3) as res:
                return res.status, json.loads(res.read().decode())
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode()
            return exc.code, json.loads(raw or "{}")

    try:
        code, _ = call("GET", None)
        expect(code == 401, f"http no auth {code}")
        code, _ = call("POST", None, {"target": "coder", "confirmActiveJob": True})
        expect(code == 401, f"http post no auth {code}")
        expect(runner.calls == [], f"http unauth calls {runner.calls}")

        code, body = call("POST", "Bearer sekret", {"target": "coder"})
        expect(code == 409 and body.get("needsConfirm") is True, f"http confirm {code} {body}")
        expect(runner.calls == [], "http confirm did not stop")

        code, body = call(
            "POST", "Bearer sekret", {"target": "coder", "confirmActiveJob": True}
        )
        expect(code == 202 and body.get("switching") is True, f"http accept {code} {body}")
        for _ in range(50):
            code, body = call("GET", "Bearer sekret")
            if not body.get("switching"):
                break
            time_sleep_short()
        expect(body.get("switching") is False, f"still switching {body}")
        expect(runner.calls == [("stop", 8188), ("start_coder",)], f"http calls {runner.calls}")
        expect(body.get("side") == "coder", f"side {body}")
    finally:
        httpd.shutdown()
        httpd.server_close()


def time_sleep_short() -> None:
    import time

    time.sleep(0.02)


def main() -> None:
    test_paths_and_platform_guard()
    test_auth_and_confirm()
    test_switch_sequences()
    test_http_server()
    print("smoke-engine-control ok")


if __name__ == "__main__":
    main()
