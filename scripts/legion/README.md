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

## COMFYUI_URL po Quick Tunnel

Quick Tunnel (`*.trycloudflare.com`) **zmienia hostname** po restarcie `cloudflared`.

1. Otwórz `logs\cloudflared-tunnel-url.txt`
2. Vercel → Project → Settings → Environment Variables → `COMFYUI_URL`
3. Redeploy (lub wait — env bywa cache’owane do redeploy)

**Trwały URL:** Named Tunnel (Cloudflare Zero Trust) — wtedy Settings ustawiasz raz. Zobacz `docs/studio-setup.md` / plan Legion.

## Galeria po reboocie

`/history` Comfy jest puste po restarcie. Trwały indeks:

- plik Comfy: `input/aigen-gallery-index.json` (AIGen dopisuje po jobach)
- seed istniejących plików: `python scripts/seed-comfy-gallery-index.py --comfy-url http://127.0.0.1:8188`

Panel (Vercel) czyta **najpierw indeks**, potem opcjonalnie historię / `/internal/files`.
