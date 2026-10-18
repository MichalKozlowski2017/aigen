# AIGen

**AIGen** to lokalny panel Next.js do sterowania **ComfyUI** na tej samej maszynie (np. laptop z **NVIDIA RTX 5080**, ~16 GB VRAM). Generowanie obrazów, wideo, galeria outputów i pobieranie modeli — bez wysyłania wag do gita.

Szczegółowa konfiguracja: [docs/studio-setup.md](docs/studio-setup.md).

## Wymagania

- Windows 11 (zalecane) lub Linux z GPU NVIDIA
- Sterowniki NVIDIA + PyTorch CUDA zgodne z ComfyUI
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) nasłuchujące na `127.0.0.1:8188`
- Node.js 20+

## Szybki start

```bash
git clone https://github.com/MichalKozlowski2017/aigen.git
cd aigen
cp .env.example .env.local
# Uzupełnij COMFYUI_MODELS_DIR i COMFYUI_OUTPUT_DIR (ścieżki do folderów ComfyUI)
npm ci
```

**Terminal A — ComfyUI (GPU):**

```bash
python main.py --listen 127.0.0.1 --port 8188
```

**Terminal B — AIGen:**

```bash
npm run dev
```

Otwórz [http://localhost:3000](http://localhost:3000) — pulpit pokazuje stan ComfyUI (online/offline).

## Vercel + Cloudflare Tunnel + Legion

Panel możesz hostować na **Vercel**, a **ComfyUI** trzymać na stacjonarnym PC (**Legion**, RTX) — połączenie przez **Cloudflare Tunnel** (HTTPS do `127.0.0.1:8188`, bez otwierania portu w routerze).

1. Na Legionie: ComfyUI na `127.0.0.1:8188` + tunel `cloudflared`. Autostart: [`scripts/legion/`](scripts/legion/README.md) (`start-comfy-stack.ps1`).
2. W Vercel: Import repozytorium `MichalKozlowski2017/aigen`, ustaw `COMFYUI_URL` (publiczny URL tunelu) i `STUDIO_PASSWORD`. **Nie** ustawiaj `COMFYUI_MODELS_DIR` / `COMFYUI_OUTPUT_DIR` na Vercel — panel czyta modele (`/models/…`) i galerię (indeks `aigen-gallery-index.json` + historia) przez tunel.
3. Deploy — zdalny dostęp do panelu; generacja działa, gdy Legion, tunel i ComfyUI są online.

**Quick Tunnel** (`*.trycloudflare.com`) zmienia hostname po restarcie — bez domeny użyj auto-publish: [`scripts/legion/publish-comfy-url.ps1`](scripts/legion/publish-comfy-url.ps1) → `POST /api/settings/comfy-url` (sekret `COMFY_URL_UPDATE_SECRET`). Szczegóły: [docs/named-cloudflare-tunnel.md](docs/named-cloudflare-tunnel.md#bez-domeny-auto-sync-quick-tunnel).

**Named Tunnel** (zalecane gdy jest domena): stały hostname, `COMFYUI_URL` raz — [docs/named-cloudflare-tunnel.md](docs/named-cloudflare-tunnel.md). Placeholder: `https://comfy.your-domain.com`.

Szczegóły lokalnego ComfyUI: [docs/studio-setup.md](docs/studio-setup.md).

## Zmienne środowiskowe

| Zmienna | Opis |
|---------|------|
| `COMFYUI_URL` | Adres API ComfyUI — lokalnie `http://127.0.0.1:8188`; na Vercel URL tunelu (Named = stały, Quick = override z auto-publish) |
| `COMFY_URL_UPDATE_SECRET` | Bearer dla `POST /api/settings/comfy-url` (Legion auto-publish). **Wymagany** — `REVALIDATE_SECRET` nie wystarczy |
| `COMFY_URL_ALLOW_HOSTS` | Opcjonalny allowlist poza `*.trycloudflare.com` (np. Named Tunnel host) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Opcjonalnie Vercel KV — trwały override Quick Tunnel bez redeploy |
| `COMFYUI_MODELS_DIR` | **Tylko lokalny panel** — skan dysku + przycisk Pobierz |
| `COMFYUI_OUTPUT_DIR` | **Tylko lokalny panel** — skan galerii z dysku; na Vercel: `/history` + indeks w Comfy input |
| `STUDIO_PASSWORD` | Opcjonalne hasło; chroni panel i `/api/*` |
| `PIPELINE_LEGION_WORKER` | **Zostaw wyłączone.** Eksperymentalne; nie włączać domyślnie (register bez osobnego auth). Opcjonalny `aigen-queue-worker.py` na Legionie jest osobny i nie wymaga tej flagi. |

## Skrypty

| Polecenie | Opis |
|-----------|------|
| `npm run dev` | Serwer deweloperski (port 3000) |
| `npm run build` | Produkcyjny build |
| `npm run start` | Uruchomienie po buildzie |
| `npm run lint` | ESLint |

## RTX 5080 — praktyczne limity (~16 GB VRAM)

- **Obraz (Flux.2 Dev fp8):** domyślnie; SDXL opcjonalnie w dropdownie
- **Wideo (Wan I2V):** Fast 480p (chunki preferuj 81) + lightx2v; zalecane **Fast + upscale/smooth** (RealESRGAN×2 + RIFE) vs native Quality 720p; patrz `docs/studio-setup.md`

Nie commituj plików `.safetensors` / `.ckpt`.

## Licencja

Prywatny projekt Michała Kozłowskiego — użycie na własną odpowiedzialność.
