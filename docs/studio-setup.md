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

Na Vercel ustaw:

```env
COMFYUI_URL=https://twoj-tunnel.example
STUDIO_PASSWORD=...
# Gdy Legion queue worker orkiestruje chunki (zalecane na dłuższe klipy):
# PIPELINE_LEGION_WORKER=1
```

- **Modele:** status „gotowy/brak” z `GET {COMFYUI_URL}/models/{folder}` (nie z dysku Vercel).
- **Galeria:** outputy z historii Comfy (`/history`) + `/api/comfy-view`.
- `COMFYUI_MODELS_DIR` / `COMFYUI_OUTPUT_DIR` — wyłącznie gdy panel Next.js działa na maszynie z Comfy (lokalne pobieranie wag / skan katalogu).
- **Pipeline:** patrz §6 — Legion worker SoT; Vercel GET = status + best-effort.

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

| Tryb   | Rekomendacja                                      |
|--------|----------------------------------------------------|
| Obraz  | Flux.2 Dev fp8 (domyślnie); SDXL 1024² opcjonalnie |
| Wideo  | Wan Fast 480p + lightx2v distill LoRA; Smooth 24 (RIFE); SVD legacy |

### Wan Fast (distill LoRA)

- Plik: `models/loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`
- Preset **Fast**: steps 4–6, CFG≈1, sampler `euler`, node `LoraLoaderModelOnly` gdy plik istnieje
- Brak LoRA na Comfy → graceful fallback (steps ~10, CFG 6, bez LoRA) + ostrzeżenie w UI
- **Quality** = bez LoRA / więcej steps; **Native 24** = experimental (preferuj Smooth 24 / RIFE)

## 6. Pipeline chunków (Wan/LTX)

**Legion worker jest source of truth** dla kolejnych chunków (c1…stitch). Browser poll i Vercel GET służą do **statusu**; advance na GET to tylko best-effort gdy nie ma workera.

| Tryb | ENV | Zachowanie |
|------|-----|------------|
| Best-effort (domyślnie) | brak / `PIPELINE_LEGION_WORKER` wyłączone | `POST` start + jedna pętla `after()`; `GET` advance + kick max co ~45s (bez multiplikacji na każde poll) |
| Legion worker | `PIPELINE_LEGION_WORKER=1` | Panel: `GET` tylko czyta stan (bez advance). Worker: `POST /api/video/pipeline/[id]/register` kickuje orkiestrację |

Endpointy:

- `POST /api/video/pipeline` — start + enqueue c0
- `GET /api/video/pipeline/[id]` — status (+ best-effort advance jeśli nie Legion)
- `POST /api/video/pipeline/[id]/register` — claim / kick dla Legion workera

## 7. Troubleshooting

| Objaw | Co sprawdzić |
|-------|----------------|
| Offline na pulpicie | ComfyUI uruchomione? `COMFYUI_URL`? firewall / tunel? |
| Galeria pusta | zdalnie: tunel + historia Comfy; lokalnie: `COMFYUI_OUTPUT_DIR` |
| Pobieranie zablokowane | tylko lokalny panel: brak `COMFYUI_MODELS_DIR` |
| Wideo pada na node | brak Wan / VHS / obrazu w `input` |
| Fast bez przyspieszenia | brak LoRA lightx2v w `loras/` — fallback klasyczny Fast |
