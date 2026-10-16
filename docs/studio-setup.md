# AIGen + ComfyUI (laptop RTX 5080)

Repozytorium: [github.com/MichalKozlowski2017/aigen](https://github.com/MichalKozlowski2017/aigen)

Panel Next.js (AIGen) steruje lokalnym **ComfyUI** na tej samej maszynie. Wagi modeli **nie** trafiają do gita.

## Wymagania

- Windows 11 (zalecane) z GPU **NVIDIA RTX 5080** (~16 GB VRAM)
- Sterowniki NVIDIA + **CUDA** zgodne z PyTorch / ComfyUI (sprawdź aktualną tabelę na stronie ComfyUI / PyTorch)
- Python 3.11+ (albo portable pack ComfyUI)
- Node.js 20+ do panelu Next.js

## 1. ComfyUI z CUDA

1. Pobierz [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (git clone albo oficjalny Windows package).
2. Zainstaluj zależności z **wersją PyTorch CUDA** (nie CPU-only).
3. Uruchom:

```bash
python main.py --listen 127.0.0.1 --port 8188
```

4. Smoke test: otwórz `http://127.0.0.1:8188`, załaduj prosty workflow i wygeneruj jeden obraz.

### Wideo

- Checkpoint **SVD XT** (`svd_xt.safetensors`) w `models/checkpoints`
- Custom node **Video Helper Suite** (VHS) — node `VHS_VideoCombine`
- Obraz startowy: upload z panelu **Wideo** (nad promptem → `/api/upload` → Comfy `input`) albo ręcznie plik do `ComfyUI/input`

## 2. Zmienne ENV panelu

Skopiuj `.env.example` → `.env.local`:

```env
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_MODELS_DIR=C:\ścieżka\do\ComfyUI\models
COMFYUI_OUTPUT_DIR=C:\ścieżka\do\ComfyUI\output
# STUDIO_PASSWORD=opcjonalne-haslo
```

- Bez `STUDIO_PASSWORD` panel jest otwarty lokalnie.
- Z hasłem chronione są wszystkie strony oraz `/api/*` (sesja cookie).

### Vercel (panel) + Legion (Comfy)

Na Vercel ustaw tylko:

```env
COMFYUI_URL=https://twoj-tunnel.example
STUDIO_PASSWORD=...
```

- **Modele:** status „gotowy/brak” z `GET {COMFYUI_URL}/models/{folder}` (nie z dysku Vercel).
- **Galeria:** outputy z historii Comfy (`/history`) + `/api/comfy-view`.
- `COMFYUI_MODELS_DIR` / `COMFYUI_OUTPUT_DIR` — wyłącznie gdy panel Next.js działa na maszynie z Comfy (lokalne pobieranie wag / skan katalogu).

## 3. Uruchomienie razem

Terminal A — ComfyUI (GPU):

```bash
python main.py --listen 127.0.0.1 --port 8188
```

Terminal B — AIGen:

```bash
npm ci
npm run dev
```

Otwórz `http://localhost:3000`.

Jeśli ComfyUI nie działa, pulpit pokazuje **offline** — API zwraca 503 przy generacji, reszta UI działa.

## 4. Modele

- Katalog polecanych: `src/lib/studio/models-catalog.json`
- Strona `/models`: lokalnie skanuje `COMFYUI_MODELS_DIR` (+ Pobierz z HF); zdalnie (Vercel) odpytuje Comfy `/models/checkpoints`, `/models/diffusion_models`, `/models/text_encoders`, `/models/vae`, …
- Domyślny workflow obrazu: Flux.2 (`txt2img-flux.json`); SDXL w dropdownie.
- Workflow wideo: `src/lib/studio/workflows/txt2video-svd.json` — start frame: upload, galeria albo nazwa w `input`.

Nie commituj plików `.safetensors` / `.ckpt`.

## 5. Limity VRAM (~16 GB)

| Tryb   | Rekomendacja                          |
|--------|----------------------------------------|
| Obraz  | SDXL 1024², batch 1–2                 |
| Wideo  | ≤ 4 s, ≤ 512–576 px, ≤ 12 FPS (SVD)   |

## 6. Troubleshooting

| Objaw | Co sprawdzić |
|-------|----------------|
| Offline na pulpicie | ComfyUI uruchomione? `COMFYUI_URL`? firewall? |
| Galeria pusta | `COMFYUI_OUTPUT_DIR` wskazuje na folder `output` |
| Pobieranie zablokowane | brak `COMFYUI_MODELS_DIR` |
| Wideo pada na node | brak VHS / SVD / obrazu w `input` |
