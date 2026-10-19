#!/usr/bin/env python3
"""
Jednorazowy patch: wstrzyknij append gallery-index do aigen-queue-worker.py.

Jeśli worker ma funkcję kończącą pipeline (np. mark_completed / finish / stitch),
dodaje import + wywołanie append_entries. Bezpieczny do ponownego odpalenia
(marker AIGEN_GALLERY_INDEX_HOOK).

Preferowany runtime fix: aigen-gallery-index-watcher.py (bez edycji workera).
Ten skrypt zostaje na wypadek gdy chcesz in-process hook.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

MARKER = "AIGEN_GALLERY_INDEX_HOOK"

HOOK_SNIPPET = '''
# --- {marker} (begin) ---
def _aigen_record_gallery_outputs(state):
    """Best-effort: dopisz final outputs do aigen-gallery-index.json."""
    try:
        import sys as _sys
        from pathlib import Path as _Path
        _roots = [
            _Path(__file__).resolve().parent,
            _Path(__file__).resolve().parent.parent / "scripts",
            _Path(__file__).resolve().parent / "legion",
            _Path(r"C:/Users/mkozl/Sites/ComfyUI/scripts"),
        ]
        for _r in _roots:
            if (_r / "aigen_gallery_index.py").is_file():
                if str(_r) not in _sys.path:
                    _sys.path.insert(0, str(_r))
                break
        from aigen_gallery_index import append_entries, refs_from_pipeline_state
        refs = refs_from_pipeline_state(state if isinstance(state, dict) else {{}})
        if refs:
            append_entries(refs, prefer_local=True)
    except Exception as _err:  # noqa: BLE001
        try:
            print(f"[gallery-index] skip: {{_err}}", flush=True)
        except Exception:
            pass
# --- {marker} (end) ---
'''.format(marker=MARKER)


def find_worker(comfy_root: Path) -> Path | None:
    candidates = [
        comfy_root / "scripts" / "aigen-queue-worker.py",
        comfy_root / "aigen-queue-worker.py",
        comfy_root / "user" / "aigen-queue-worker" / "aigen-queue-worker.py",
        comfy_root / "custom_nodes" / "aigen-queue-worker" / "aigen-queue-worker.py",
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None


def inject(src: str) -> tuple[str, bool]:
    if MARKER in src:
        return src, False

    # Wstaw helper po importach
    lines = src.splitlines(keepends=True)
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("import ") or line.startswith("from "):
            insert_at = i + 1
        elif insert_at and line.strip() and not line.startswith("#"):
            break
    hook_lines = [ln + "\n" for ln in HOOK_SNIPPET.strip("\n").splitlines()]
    lines[insert_at:insert_at] = ["\n"] + hook_lines + ["\n"]

    text = "".join(lines)

    # Wywołaj przy status completed — kilka typowych wzorców
    patterns = [
        (
            re.compile(
                r'(["\']status["\']\s*:\s*["\']completed["\'])',
                re.MULTILINE,
            ),
            r'\1  # gallery\n            _aigen_record_gallery_outputs(state)',
        ),
        (
            re.compile(
                r'(state\[[\'"]status[\'"]\]\s*=\s*[\'"]completed[\'"])',
                re.MULTILINE,
            ),
            r"\1\n        _aigen_record_gallery_outputs(state)",
        ),
        (
            re.compile(
                r'(state\.status\s*=\s*[\'"]completed[\'"])',
                re.MULTILINE,
            ),
            r"\1\n        _aigen_record_gallery_outputs(state)",
        ),
    ]
    replaced = False
    for pat, repl in patterns:
        new_text, n = pat.subn(repl, text, count=3)
        if n:
            text = new_text
            replaced = True

    if not replaced:
        # Fallback: na końcu pliku dodaj notatkę — watcher i tak złapie completed
        text += (
            f"\n# {MARKER}: helper zainstalowany; "
            "brak auto-call — użyj aigen-gallery-index-watcher.py\n"
        )

    return text, True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--comfy-root",
        default=r"C:\Users\mkozl\Sites\ComfyUI",
        type=Path,
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    worker = find_worker(args.comfy_root)
    if not worker:
        print(f"Brak aigen-queue-worker.py pod {args.comfy_root}", file=sys.stderr)
        print("Użyj aigen-gallery-index-watcher.py (bez patcha).", file=sys.stderr)
        raise SystemExit(2)

    original = worker.read_text(encoding="utf-8")
    patched, changed = inject(original)
    if not changed:
        print(f"Już spatchowany: {worker}")
        return
    if args.dry_run:
        print(f"DRY-RUN: patch {worker} (+{len(patched) - len(original)} B)")
        return
    backup = worker.with_suffix(worker.suffix + ".bak-gallery")
    if not backup.exists():
        backup.write_text(original, encoding="utf-8")
        print(f"Backup: {backup}")
    worker.write_text(patched, encoding="utf-8")
    print(f"OK: spatchowano {worker}")
    print("Zrestartuj queue worker. Albo polegaj na aigen-gallery-index-watcher.py.")


if __name__ == "__main__":
    main()
