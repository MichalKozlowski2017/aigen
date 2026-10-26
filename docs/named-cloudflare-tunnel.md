# Named Cloudflare Tunnel — stały `COMFYUI_URL`

**Cel:** jeden HTTPS hostname do ComfyUI na Legionie. Po reboocie PC **nie** trzeba aktualizować Vercel.

Quick Tunnel (`*.trycloudflare.com`) zmienia hostname przy każdym restarcie `cloudflared` — stąd martwy `COMFYUI_URL` i błędy galerii / modeli. Named Tunnel (Cloudflare Zero Trust, darmowy tier) trzyma stały URL.

## Wymagania

- Konto Cloudflare + **własna strefa DNS** (domena na Cloudflare)
- `cloudflared` na Legionie (`winget install Cloudflare.cloudflared`)
- ComfyUI na `127.0.0.1:8188` (bez port-forward w routerze)

## 1. Utwórz tunel (raz, na Legionie)

W PowerShell:

```powershell
cloudflared tunnel login
cloudflared tunnel create comfyui-legion
```

Zapisz **UUID** z outputu (albo z `%USERPROFILE%\.cloudflared\`).

## 2. Config

Plik `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: C:\Users\<YOU>\.cloudflared\<TUNNEL_UUID>.json

ingress:
  - hostname: comfy.your-domain.com
    service: http://127.0.0.1:8188
  - service: http_status:404
```

Zamień `comfy.your-domain.com` na subdomenę w Twojej strefie Cloudflare.

## 3. DNS

```powershell
cloudflared tunnel route dns comfyui-legion comfy.your-domain.com
```

Albo ręcznie w Cloudflare Dashboard: CNAME `comfy` → `<TUNNEL_UUID>.cfargotunnel.com` (Proxied).

## 4. Uruchom Named Tunnel

```powershell
cloudflared tunnel run comfyui-legion
```

Smoke (z dowolnej maszyny):

```powershell
Invoke-WebRequest -Uri "https://comfy.your-domain.com/system_stats" -UseBasicParsing
```

Oczekiwane: HTTP 200 + JSON Comfy.

## 4b. Sterowanie GPU (osobny hostname)

Przełącznik ComfyUI ↔ Qwen **nie** idzie tym samym ingressem. Port 8188 to API Comfy; `STUDIO_PASSWORD` go nie chroni, a po zatrzymaniu Comfy tunel na 8188 i tak nic nie przeniesie.

Endpoint: `scripts/legion/engine-control.py` na `127.0.0.1:8199` (zostaje, gdy Comfy jest wyłączone). Auth: `Authorization: Bearer <LEGION_ENGINE_SECRET>` — bez sekretu proces nie nasłuchuje.

Nad regułą `http_status:404` dopisz:

```yaml
  - hostname: engine.your-domain.com
    service: http://127.0.0.1:8199
```

DNS: `cloudflared tunnel route dns comfyui-legion engine.your-domain.com`.

Na Vercel (raz):

| Zmienna | Wartość |
|---------|---------|
| `LEGION_ENGINE_URL` | `https://engine.your-domain.com` |
| `LEGION_ENGINE_SECRET` | ten sam sekret co na Legionie |

Bez `LEGION_ENGINE_URL` panel pokazuje przełącznik jako niedostępny i **nie** woła Legionu. Sekretu nie wkładaj do URL.

Na Legionie: `LEGION_ENGINE_SECRET` oraz opcjonalnie `QWEN_CODER_START_SCRIPT` (domyślnie `C:\Users\mkozl\Models\start-qwen-coder.ps1`). Start: `start-engine-control.ps1` (także z `start-comfy-stack.ps1`, gdy sekret jest ustawiony).

## 5. Autostart stack (Legion)

Skrypty w repo: [`scripts/legion/`](../scripts/legion/README.md).

1. Zatrzymaj Quick Tunnel (`Stop-Process -Name cloudflared -Force` jeśli trzeba).
2. W Task Scheduler / Startup uruchamiaj **Named** zamiast `cloudflared tunnel --url …`:
   - albo osobne zadanie: `cloudflared tunnel run comfyui-legion`
   - albo `start-comfy-stack.ps1 -SkipTunnel` + Named w osobnym procesie / skrócie
3. Opcjonalnie: `install-startup-shortcut.ps1` nadal odpala Comfy + worker; tunel Named trzymaj jako osobny autostart.

Quick Tunnel URL w `logs\cloudflared-tunnel-url.txt` **nie** jest potrzebny przy Named.

## 6. Vercel — ustaw raz

| Zmienna | Wartość |
|---------|---------|
| `COMFYUI_URL` | `https://comfy.your-domain.com` (bez trailing slash) |
| `STUDIO_PASSWORD` | silne hasło |

**Nie** ustawiaj `COMFYUI_MODELS_DIR` / `COMFYUI_OUTPUT_DIR` na Vercel.

Po zmianie ENV → Redeploy.

## Quick vs Named

| | Quick Tunnel | Named Tunnel |
|---|--------------|--------------|
| Hostname | `*.trycloudflare.com`, **nowy po restarcie** | Twój DNS, **stały** |
| Setup | `start-comfy-stack.ps1` (domyślnie) | login + create + DNS (raz) |
| Vercel | Auto-publish (poniżej) albo ręcznie + redeploy | Ustaw raz |
| Plik URL | `logs\cloudflared-tunnel-url.txt` | nie dotyczy |

## Bez domeny: auto-sync Quick Tunnel

Gdy **nie ma** strefy DNS na Cloudflare, Named Tunnel hostname nie zadziała. Zamiast klepać Settings po każdym reboocie Legionu:

### 1) Vercel (raz)

| Zmienna | Wartość |
|---------|---------|
| `COMFYUI_URL` | ostatni znany Quick URL (bootstrap; może być stary) |
| `COMFY_URL_UPDATE_SECRET` | długi losowy sekret (**wymagany**; `REVALIDATE_SECRET` nie wystarczy) |
| `COMFY_URL_ALLOW_HOSTS` | opcjonalnie Named Tunnel host (poza `*.trycloudflare.com`) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | **zalecane** — Storage → KV w Vercel (trwały override między cold startami) |
| `STUDIO_PASSWORD` | jak zwykle |

Redeploy po dodaniu sekretu.

### 2) Legion (ENV użytkownika / system)

```text
AIGEN_PANEL_URL=https://TWOJ-PROJEKT.vercel.app
COMFY_URL_UPDATE_SECRET=<ten sam sekret co na Vercel>
# opcjonalnie Named Tunnel:
# COMFY_URL_ALLOW_HOSTS=comfy.twoja-domena.com
```

### 3) Publish

Po starcie tunelu (albo ręcznie):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\legion\publish-comfy-url.ps1 `
  -ComfyRoot "C:\Users\mkozl\Sites\ComfyUI"
```

`start-comfy-stack.ps1` woła to automatycznie, gdy `AIGEN_PANEL_URL` + sekret są ustawione.

Endpoint: `POST /api/settings/comfy-url`  
Auth: `Authorization: Bearer <sekret>`  
Body: `{ "url": "https://….trycloudflare.com" }`

Panel czyta URL w kolejności: **pamięć → KV → `COMFYUI_URL` env**. Bez KV override żyje na warm instance; z KV — bez redeploy na wszystkich instancjach.

### Option B (bez API panelu)

```powershell
powershell -File scripts\legion\publish-comfy-url.ps1 -UpdateVercelEnv `
  -Url "https://….trycloudflare.com"
```

Wymaga `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` (+ opcjonalnie `VERCEL_TEAM_ID`). Aktualizuje env i próbuje redeploy — wolniejsze niż Option A.

## Troubleshooting

| Objaw | Co sprawdzić |
|-------|----------------|
| Panel offline / `fetch failed` | Legion online? `cloudflared tunnel run` działa? DNS Proxied? |
| 502 / 1033 | Ingress wskazuje `http://127.0.0.1:8188`? Comfy słucha? |
| Stary Quick host w Vercel | `publish-comfy-url.ps1` albo Named URL + redeploy |
| Auto-publish 401 | Ten sam `COMFY_URL_UPDATE_SECRET` na Legionie i Vercel? |
| Przełącznik GPU niedostępny | Brak `LEGION_ENGINE_URL` na Vercel. To nie jest `COMFYUI_URL`. |
| Przełącznik 401 | Ten sam `LEGION_ENGINE_SECRET` na Legionie i w panelu? Endpoint nie używa `STUDIO_PASSWORD`. |
| Auto-publish 503 | Sekret nieustawiony na Vercel — dodaj i redeploy |
| Override ginie po cold start | Włącz Vercel KV (`KV_REST_API_*`) albo `-UpdateVercelEnv` |
| Galeria pusta po reboocie Comfy | Indeks `input/aigen-gallery-index.json` — patrz `scripts/legion/README.md` |

## Powiązane

- [`scripts/legion/README.md`](../scripts/legion/README.md) — autostart Comfy + Quick Tunnel + worker
- [`docs/studio-setup.md`](studio-setup.md) — ENV panelu
- README — sekcja Vercel + Cloudflare Tunnel + Legion
