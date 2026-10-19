#!/usr/bin/env python3
"""
Zasiej input/aigen-gallery-index.json z plików na dysku Comfy (output/).

Użycie na Legionie (Comfy musi działać lokalnie):

  python scripts/seed-comfy-gallery-index.py
  python scripts/seed-comfy-gallery-index.py --output-dir "C:/Users/mkozl/Sites/ComfyUI/output"
  python scripts/seed-comfy-gallery-index.py --comfy-url http://127.0.0.1:8188

Nie wymaga custom node ani restartu Comfy — tylko POST /upload/image.
Po seedzie Galeria na Vercel czyta indeks przez /view (type=input).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Wspólna lib (append) — opcjonalna; seed ma własne walk/upload.
_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv"}
MEDIA_EXT = IMAGE_EXT | VIDEO_EXT
INDEX_NAME = "aigen-gallery-index.json"
MAX_ITEMS = 200


def default_output_dir() -> Path:
    env = os.environ.get("COMFYUI_OUTPUT_DIR")
    if env:
        return Path(env)
    # Typowe lokalizacje Legion / Windows
    candidates = [
        Path.home() / "Sites" / "ComfyUI" / "output",
        Path("C:/Users/mkozl/Sites/ComfyUI/output"),
        Path.home() / "ComfyUI" / "output",
    ]
    for c in candidates:
        if c.is_dir():
            return c
    return candidates[0]


def walk_media(root: Path) -> list[dict]:
    items: list[dict] = []
    if not root.is_dir():
        raise SystemExit(f"Brak katalogu output: {root}")

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if name.startswith("."):
                continue
            ext = Path(name).suffix.lower()
            if ext not in MEDIA_EXT:
                continue
            abs_path = Path(dirpath) / name
            rel = abs_path.relative_to(root).as_posix()
            parts = rel.split("/")
            filename = parts[-1]
            subfolder = "/".join(parts[:-1]) if len(parts) > 1 else ""
            try:
                mtime_ms = int(abs_path.stat().st_mtime * 1000)
            except OSError:
                mtime_ms = int(time.time() * 1000)
            items.append(
                {
                    "filename": filename,
                    "subfolder": subfolder,
                    "type": "output",
                    "mtimeMs": mtime_ms,
                }
            )

    items.sort(key=lambda x: x["mtimeMs"], reverse=True)
    return items[:MAX_ITEMS]


def upload_index(comfy_url: str, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    boundary = f"----aigen{int(time.time() * 1000)}"
    lines = []
    lines.append(f"--{boundary}".encode())
    lines.append(
        f'Content-Disposition: form-data; name="image"; filename="{INDEX_NAME}"'.encode()
    )
    lines.append(b"Content-Type: application/octet-stream")
    lines.append(b"")
    lines.append(body)
    lines.append(f"--{boundary}".encode())
    lines.append(b'Content-Disposition: form-data; name="overwrite"')
    lines.append(b"")
    lines.append(b"true")
    lines.append(f"--{boundary}".encode())
    lines.append(b'Content-Disposition: form-data; name="type"')
    lines.append(b"")
    lines.append(b"input")
    lines.append(f"--{boundary}--".encode())
    lines.append(b"")
    data = b"\r\n".join(lines)

    req = urllib.request.Request(
        f"{comfy_url.rstrip('/')}/upload/image",
        data=data,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode("utf-8", errors="replace")
            print(f"upload HTTP {res.status}: {raw[:200]}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Upload failed HTTP {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"Comfy niedostępny ({comfy_url}): {e}") from e


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_output_dir(),
        help="Katalog Comfy output/",
    )
    parser.add_argument(
        "--comfy-url",
        default=os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188"),
        help="URL API Comfy (lokalny lub tunel)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Tylko wypisz JSON, bez uploadu",
    )
    args = parser.parse_args()

    items = walk_media(args.output_dir)
    payload = {
        "version": 1,
        "updatedAt": int(time.time() * 1000),
        "items": items,
    }
    print(
        f"Znaleziono {len(items)} mediów w {args.output_dir} "
        f"(limit {MAX_ITEMS})",
        file=sys.stderr,
    )
    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return

    upload_index(args.comfy_url, payload)
    # Weryfikacja /view
    view = (
        f"{args.comfy_url.rstrip('/')}/view?"
        f"filename={INDEX_NAME}&subfolder=&type=input"
    )
    try:
        with urllib.request.urlopen(view, timeout=15) as res:
            check = json.loads(res.read().decode("utf-8"))
            n = len(check.get("items") or [])
            print(f"OK: /view type=input → {n} wpisów w indeksie")
    except Exception as e:  # noqa: BLE001
        print(f"Uwaga: upload OK, ale weryfikacja /view: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
