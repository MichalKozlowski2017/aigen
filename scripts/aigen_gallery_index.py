#!/usr/bin/env python3
"""
Wspólna biblioteka: dopisz media do input/aigen-gallery-index.json.

Używana przez:
  - seed-comfy-gallery-index.py
  - scripts/legion/aigen-gallery-index-watcher.py (queue-worker completions)
  - ręcznie: python -c "from aigen_gallery_index import …"

Na Legionie preferuj zapis lokalny (Comfy input/), bez HTTP — szybciej i bez race z tunellem.
HTTP /upload/image zostaje jako fallback gdy brak lokalnego input/.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

INDEX_NAME = "aigen-gallery-index.json"
INDEX_VERSION = 1
MAX_ITEMS = 200
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv"}
MEDIA_EXT = IMAGE_EXT | VIDEO_EXT


def entry_key(e: dict[str, Any]) -> str:
    return f"{e.get('type', 'output')}/{e.get('subfolder', '')}/{e.get('filename', '')}"


def normalize_entry(raw: dict[str, Any] | None, *, now_ms: int | None = None) -> dict[str, Any] | None:
    if not raw or not isinstance(raw.get("filename"), str) or not raw["filename"]:
        return None
    filename = raw["filename"].replace("\\", "/").lstrip("/")
    subfolder = str(raw.get("subfolder") or "").replace("\\", "/").strip("/")
    # Jeśli filename zawiera ścieżkę, przenieś do subfolder
    if "/" in filename:
        parts = filename.split("/")
        filename = parts[-1]
        prefix = "/".join(parts[:-1])
        subfolder = f"{subfolder}/{prefix}".strip("/") if subfolder else prefix
    typ = str(raw.get("type") or "output")
    mtime = raw.get("mtimeMs")
    if not isinstance(mtime, (int, float)):
        mtime = now_ms if now_ms is not None else int(time.time() * 1000)
    return {
        "filename": filename,
        "subfolder": subfolder,
        "type": typ,
        "mtimeMs": int(mtime),
    }


def default_comfy_root() -> Path:
    env = os.environ.get("COMFYUI_ROOT") or os.environ.get("COMFY_ROOT")
    if env:
        return Path(env)
    candidates = [
        Path.home() / "Sites" / "ComfyUI",
        Path("C:/Users/mkozl/Sites/ComfyUI"),
        Path.home() / "ComfyUI",
        Path(__file__).resolve().parent.parent,  # repo aigen → nie; fallback
    ]
    for c in candidates:
        if (c / "main.py").is_file() and (c / "input").is_dir():
            return c
    return candidates[0]


def default_input_dir(comfy_root: Path | None = None) -> Path:
    env = os.environ.get("COMFYUI_INPUT_DIR")
    if env:
        return Path(env)
    root = comfy_root or default_comfy_root()
    return root / "input"


def load_index_file(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        n = normalize_entry(item if isinstance(item, dict) else None)
        if not n:
            continue
        key = entry_key(n)
        if key in seen:
            continue
        seen.add(key)
        out.append(n)
    return out


def merge_items(
    existing: Iterable[dict[str, Any]],
    incoming: Iterable[dict[str, Any]],
    *,
    max_items: int = MAX_ITEMS,
) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for e in existing:
        n = normalize_entry(e)
        if n:
            by_key[entry_key(n)] = n
    now = int(time.time() * 1000)
    for e in incoming:
        n = normalize_entry(e, now_ms=now)
        if n:
            by_key[entry_key(n)] = n
    items = sorted(by_key.values(), key=lambda x: x.get("mtimeMs") or 0, reverse=True)
    return items[:max_items]


def write_index_file(path: Path, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": INDEX_VERSION,
        "updatedAt": int(time.time() * 1000),
        "items": items,
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def append_entries_local(
    refs: list[dict[str, Any]],
    *,
    input_dir: Path | None = None,
    max_items: int = MAX_ITEMS,
) -> dict[str, Any]:
    """Dopisz wpisy do lokalnego input/aigen-gallery-index.json."""
    if not refs:
        return {"ok": True, "count": 0, "path": None}
    inp = input_dir or default_input_dir()
    path = inp / INDEX_NAME
    existing = load_index_file(path)
    items = merge_items(existing, refs, max_items=max_items)
    write_index_file(path, items)
    return {"ok": True, "count": len(items), "path": str(path), "added": len(refs)}


def fetch_index_http(comfy_url: str, *, timeout: float = 15.0) -> list[dict[str, Any]]:
    q = urllib.parse.urlencode(
        {"filename": INDEX_NAME, "subfolder": "", "type": "input"}
    )
    url = f"{comfy_url.rstrip('/')}/view?{q}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as res:
            raw = res.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []
        raise
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    for item in items:
        n = normalize_entry(item if isinstance(item, dict) else None)
        if n:
            out.append(n)
    return out


def upload_index_http(
    comfy_url: str,
    items: list[dict[str, Any]],
    *,
    timeout: float = 60.0,
) -> None:
    payload = {
        "version": INDEX_VERSION,
        "updatedAt": int(time.time() * 1000),
        "items": items,
    }
    body = json.dumps(payload).encode("utf-8")
    boundary = f"----aigen{int(time.time() * 1000)}"
    parts = [
        f"--{boundary}".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{INDEX_NAME}"'.encode(),
        b"Content-Type: application/octet-stream",
        b"",
        body,
        f"--{boundary}".encode(),
        b'Content-Disposition: form-data; name="overwrite"',
        b"",
        b"true",
        f"--{boundary}".encode(),
        b'Content-Disposition: form-data; name="type"',
        b"",
        b"input",
        f"--{boundary}--".encode(),
        b"",
    ]
    data = b"\r\n".join(parts)
    req = urllib.request.Request(
        f"{comfy_url.rstrip('/')}/upload/image",
        data=data,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        res.read()


def append_entries_http(
    refs: list[dict[str, Any]],
    *,
    comfy_url: str,
    max_items: int = MAX_ITEMS,
) -> dict[str, Any]:
    if not refs:
        return {"ok": True, "count": 0}
    existing = fetch_index_http(comfy_url)
    items = merge_items(existing, refs, max_items=max_items)
    upload_index_http(comfy_url, items)
    return {"ok": True, "count": len(items), "added": len(refs)}


def append_entries(
    refs: list[dict[str, Any]],
    *,
    input_dir: Path | None = None,
    comfy_url: str | None = None,
    prefer_local: bool = True,
) -> dict[str, Any]:
    """
    Best-effort append. Na Legionie: lokalny plik.
    Fallback: HTTP upload do Comfy.
    """
    cleaned = [n for n in (normalize_entry(r) for r in refs) if n]
    if not cleaned:
        return {"ok": True, "count": 0, "mode": "noop"}

    if prefer_local:
        try:
            inp = input_dir or default_input_dir()
            if inp.is_dir():
                result = append_entries_local(cleaned, input_dir=inp)
                result["mode"] = "local"
                return result
        except OSError as e:
            local_err = str(e)
        else:
            local_err = "input dir missing"
    else:
        local_err = "skipped"

    if not comfy_url:
        comfy_url = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188")
    try:
        result = append_entries_http(cleaned, comfy_url=comfy_url)
        result["mode"] = "http"
        result["localError"] = local_err
        return result
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "count": 0,
            "error": str(e),
            "localError": local_err,
            "mode": "failed",
        }


def refs_from_pipeline_state(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Wyciągnij final outputs (+ opcjonalnie ostatni clip) z aigen-pipeline-*.json."""
    refs: list[dict[str, Any]] = []
    outputs = state.get("outputs")
    if isinstance(outputs, list):
        for o in outputs:
            if isinstance(o, dict):
                refs.append(o)
    # Gdy completed bez outputs — weź ostatni clip (częściowy sukces)
    if not refs and state.get("status") == "completed":
        clips = state.get("clips")
        if isinstance(clips, list) and clips:
            last = clips[-1]
            if isinstance(last, dict):
                refs.append(last)
    return refs
