#!/usr/bin/env python3
"""
Dopisuje aigen-gallery-index.json gdy aigen-queue-worker kończy pipeline.

Root cause (2026-10-19): worker zapisuje output/ + aigen-pipeline-*.json, ale
NIGDY nie aktualizuje indeksu galerii. Panel Vercel też nie — finishStitch
nie biegnie gdy worker robi stitch lokalnie. Efekt: nowe wideo niewidoczne
aż do ręcznego seed-comfy-gallery-index.py.

Ten watcher:
  - polluje Comfy input/aigen-pipeline-*.json
  - gdy status → completed i są outputs → append do indeksu (lokalny plik)
  - idempotentny (klucz type/subfolder/filename)

Start (obok queue workera):
  python scripts/legion/aigen-gallery-index-watcher.py --comfy-root C:/Users/mkozl/Sites/ComfyUI
  # albo przez start-queue-worker.ps1 (uruchamia automatycznie)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Pozwól importować scripts/aigen_gallery_index.py z repo lub ComfyUI/scripts/
_HERE = Path(__file__).resolve().parent
_CANDIDATES = [
    _HERE.parent,  # aigen/scripts
    _HERE,  # legion/ (gdy skopiowano lib obok)
    Path.cwd() / "scripts",
    Path("C:/Users/mkozl/Sites/ComfyUI/scripts"),
]
for _p in _CANDIDATES:
    if (_p / "aigen_gallery_index.py").is_file():
        sys.path.insert(0, str(_p))
        break

from aigen_gallery_index import (  # noqa: E402
    INDEX_NAME,
    append_entries,
    default_comfy_root,
    default_input_dir,
    refs_from_pipeline_state,
)


def log(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] {msg}", flush=True)


def resolve_comfy_root(hint: str | None) -> Path:
    if hint:
        p = Path(hint)
        if (p / "main.py").is_file():
            return p
    return default_comfy_root()


def pipeline_files(input_dir: Path) -> list[Path]:
    return sorted(input_dir.glob("aigen-pipeline-*.json")) + sorted(
        input_dir.glob("aigen-pipeline-*.txt")
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--comfy-root",
        default=os.environ.get("COMFYUI_ROOT", ""),
        help="Katalog ComfyUI (main.py + input/)",
    )
    parser.add_argument(
        "--poll",
        type=float,
        default=float(os.environ.get("AIGEN_GALLERY_WATCH_POLL", "5")),
        help="Interwał poll (s)",
    )
    parser.add_argument(
        "--comfy-url",
        default=os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188"),
        help="Fallback HTTP gdy brak lokalnego input/",
    )
    args = parser.parse_args()

    root = resolve_comfy_root(args.comfy_root or None)
    input_dir = default_input_dir(root)
    if not input_dir.is_dir():
        raise SystemExit(f"Brak input/: {input_dir}")

    # state: pipeline_id → (status, mtime, recorded_outputs_key)
    seen: dict[str, tuple[str, float, str]] = {}
    log(
        f"START gallery-index watcher poll={args.poll}s "
        f"input={input_dir} index={INDEX_NAME}"
    )

    while True:
        try:
            for path in pipeline_files(input_dir):
                try:
                    st = path.stat()
                    raw = path.read_text(encoding="utf-8")
                    state = json.loads(raw)
                except (OSError, json.JSONDecodeError, UnicodeError):
                    continue
                if not isinstance(state, dict):
                    continue
                pid = str(state.get("id") or path.stem)
                status = str(state.get("status") or "")
                prev = seen.get(pid)
                if prev and prev[0] == status and prev[1] == st.st_mtime:
                    continue

                refs = refs_from_pipeline_state(state) if status == "completed" else []
                ref_key = "|".join(
                    f"{r.get('type')}/{r.get('subfolder')}/{r.get('filename')}"
                    for r in refs
                )
                # Już zapisane te same outputy dla completed
                if (
                    status == "completed"
                    and prev
                    and prev[0] == "completed"
                    and prev[2] == ref_key
                    and ref_key
                ):
                    seen[pid] = (status, st.st_mtime, ref_key)
                    continue

                seen[pid] = (status, st.st_mtime, ref_key if status == "completed" else "")

                if status != "completed" or not refs:
                    continue

                result = append_entries(
                    refs,
                    input_dir=input_dir,
                    comfy_url=args.comfy_url,
                    prefer_local=True,
                )
                if result.get("ok"):
                    names = ", ".join(str(r.get("filename")) for r in refs[:3])
                    log(
                        f"INDEX ok pipeline={pid[:8]}… mode={result.get('mode')} "
                        f"count={result.get('count')} +{result.get('added')} ({names})"
                    )
                else:
                    log(f"INDEX FAIL pipeline={pid[:8]}… {result.get('error')}")
        except Exception as e:  # noqa: BLE001
            log(f"loop error: {e}")

        time.sleep(max(1.0, args.poll))


if __name__ == "__main__":
    main()
