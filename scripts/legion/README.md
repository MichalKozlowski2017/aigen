# Legion — autostart Comfy + tunnel + worker

Skrypty PowerShell pod Windows (RTX Legion). Skopiuj folder `scripts/legion/` do ComfyUI albo wołaj z repo z `-ComfyRoot`.

## Szybki start (jeden skrypt)

```powershell
cd C:\Users\mkozl\Sites\ComfyUI
# albo z repo aigen:
powershell -ExecutionPolicy Bypass -File scripts\legion\start-comfy-stack.ps1 -ComfyRoot "C:\Users\mkozl\Sites\ComfyUI"
```

Robi:

1. ComfyUI na `127.0.0.1:8188` (jeśli nie działa)
2. `cloudflared tunnel --url …` + zapis URL → `logs\cloudflared-tunnel-url.txt`
3. `aigen-queue-worker.py` (jeśli plik istnieje; czyści **stale PID** po reboocie)

## Autostart po reboocie

```powershell
powershell -ExecutionPolicy Bypass -File scripts\legion\install-startup-shortcut.ps1 -ComfyRoot "C:\Users\mkozl\Sites\ComfyUI"
```

Albo ręcznie: Task Scheduler → At log on → ta sama komenda `start-comfy-stack.ps1`.

## COMFYUI_URL — Quick vs Named

### Quick Tunnel (domyślnie w `start-comfy-stack.ps1`)

`*.trycloudflare.com` **zmienia hostname** po restarcie `cloudflared`.

**Bez domeny — auto-publish (zalecane):**

1. Vercel: `COMFY_URL_UPDATE_SECRET` (+ opcjonalnie Vercel KV)
2. Legion ENV: `AIGEN_PANEL_URL` + ten sam sekret
3. `start-comfy-stack.ps1` → `publish-comfy-url.ps1` → `POST /api/settings/comfy-url`

Ręcznie:

```powershell
powershell -File scripts\legion\publish-comfy-url.ps1 -ComfyRoot "C:\Users\mkozl\Sites\ComfyUI"
```

Szczegóły: [`docs/named-cloudflare-tunnel.md`](../../docs/named-cloudflare-tunnel.md#bez-domeny-auto-sync-quick-tunnel).

### Named Tunnel (zalecane gdy jest domena — stały URL)

Pełna instrukcja: [`docs/named-cloudflare-tunnel.md`](../../docs/named-cloudflare-tunnel.md).

Skrót:

1. `cloudflared tunnel login` → `cloudflared tunnel create comfyui-legion`
2. Config + DNS na `comfy.your-domain.com` → `http://127.0.0.1:8188`
3. Autostart: `cloudflared tunnel run comfyui-legion` (osobno) **albo** `start-comfy-stack.ps1 -SkipTunnel` + Named w Startup
4. Vercel **raz**: `COMFYUI_URL=https://comfy.your-domain.com` (bez trailing slash)

Po Named nie musisz klepać Settings po reboocie Legionu.

## Galeria po reboocie

`/history` Comfy jest puste po restarcie. Trwały indeks:

- plik Comfy: `input/aigen-gallery-index.json`
- **Panel** dopisuje po jobach obrazów (`/api/jobs`) i po `finishStitch` na Vercel
- **Queue worker** (Legion) **nie** dopisywał indeksu — `start-queue-worker.ps1` odpala też
  `aigen-gallery-index-watcher.py`, który przy `status=completed` dopisuje outputs lokalnie
- Pełny re-scan dysku: `python scripts/seed-comfy-gallery-index.py --comfy-url http://127.0.0.1:8188`

Panel (Vercel) czyta **najpierw indeks** (krótki cache), potem opcjonalnie historię / `/internal/files` tylko gdy indeks pusty/skąpy.

### Odśwież indeks (ops)

1. W UI Galeria → **Odśwież indeks** (cache bust + ponowny odczyt `/view`)
2. Pełny skan `output/` (gdy brakuje starych plików): seed na Legionie jak wyżej
3. Opcjonalny in-process patch workera: `python scripts/legion/patch-queue-worker-gallery.py --comfy-root …`
   (preferuj watcher — nie wymaga edycji workera)
