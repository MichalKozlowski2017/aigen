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

1. Otwórz `logs\cloudflared-tunnel-url.txt`
2. Vercel → Project → Settings → Environment Variables → `COMFYUI_URL`
3. Redeploy (env bywa cache’owane do redeploy)

### Named Tunnel (zalecane — stały URL)

Pełna instrukcja: [`docs/named-cloudflare-tunnel.md`](../../docs/named-cloudflare-tunnel.md).

Skrót:

1. `cloudflared tunnel login` → `cloudflared tunnel create comfyui-legion`
2. Config + DNS na `comfy.your-domain.com` → `http://127.0.0.1:8188`
3. Autostart: `cloudflared tunnel run comfyui-legion` (osobno) **albo** `start-comfy-stack.ps1 -SkipTunnel` + Named w Startup
4. Vercel **raz**: `COMFYUI_URL=https://comfy.your-domain.com` (bez trailing slash)

Po Named nie musisz klepać Settings po reboocie Legionu.

## Galeria po reboocie

`/history` Comfy jest puste po restarcie. Trwały indeks:

- plik Comfy: `input/aigen-gallery-index.json` (AIGen dopisuje po jobach)
- seed istniejących plików: `python scripts/seed-comfy-gallery-index.py --comfy-url http://127.0.0.1:8188`

Panel (Vercel) czyta **najpierw indeks**, potem opcjonalnie historię / `/internal/files`.
