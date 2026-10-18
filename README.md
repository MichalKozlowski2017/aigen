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

1. Na Legionie: ComfyUI na `127.0.0.1:8188` + tunel `cloudflared` wskazujący na ten adres.
2. W Vercel: Import repozytorium `MichalKozlowski2017/aigen`, ustaw `COMFYUI_URL` (publiczny URL tunelu) i `STUDIO_PASSWORD`. **Nie** ustawiaj `COMFYUI_MODELS_DIR` / `COMFYUI_OUTPUT_DIR` na Vercel — panel czyta modele (`/models/…`) i galerię (indeks `aigen-gallery-index.json` + historia) przez tunel. Na Legionie: `scripts/legion/start-comfy-stack.ps1` (Comfy + tunnel + worker); Quick Tunnel URL → `logs/cloudflared-tunnel-url.txt`.
3. Deploy — zdalny dostęp do panelu; generacja działa, gdy Legion, tunel i ComfyUI są online.

Szczegóły lokalnego ComfyUI: [docs/studio-setup.md](docs/studio-setup.md).

## Zmienne środowiskowe

| Zmienna | Opis |
|---------|------|
| `COMFYUI_URL` | Adres API ComfyUI (localhost albo URL tunelu na Vercel) |
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
- **Wideo (Wan I2V):** Fast 480p + lightx2v distill LoRA (domyślnie) + opcjonalny Smooth 24 (RIFE); patrz `docs/studio-setup.md`

Nie commituj plików `.safetensors` / `.ckpt`.

## Licencja

Prywatny projekt Michała Kozłowskiego — użycie na własną odpowiedzialność.
