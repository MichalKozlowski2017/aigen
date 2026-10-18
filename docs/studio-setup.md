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
# PIPELINE_LEGION_WORKER — zostaw wyłączone (patrz §6). Nie włączać domyślnie.
```

- **Modele:** status „gotowy/brak” z `GET {COMFYUI_URL}/models/{folder}` (nie z dysku Vercel).
- **Galeria (index-first):** najpierw trwały indeks `input/aigen-gallery-index.json` (przeżywa wipe `/history` po reboocie), potem opcjonalnie `/history` + stock `/internal/files/output` (tylko gdy indeks pusty/skąpy; `/internal/files` nie rekuruje `studio/`). Proxy plików: `/api/comfy-view`. Po restarcie z pustą historią: `python scripts/seed-comfy-gallery-index.py` na Legionie (skan `output/`, upload indeksu — bez restartu Comfy).
- **Autostart Legion:** jeden skrypt `scripts/legion/start-comfy-stack.ps1` (Comfy + cloudflared + queue worker). URL Quick Tunnel → `logs/cloudflared-tunnel-url.txt` → wklej do Vercel `COMFYUI_URL`. Opcjonalnie `install-startup-shortcut.ps1` (folder Startup). Szczegóły: `scripts/legion/README.md`.
- `COMFYUI_MODELS_DIR` / `COMFYUI_OUTPUT_DIR` — wyłącznie gdy panel Next.js działa na maszynie z Comfy (lokalne pobieranie wag / skan katalogu).
- **Pipeline:** patrz §6 — awaited `after()` + GET advance + durable JSON; flaga Legion opcjonalna/eksperymentalna.

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
- Preset **Fast**: **tylko 480p** (832×480, UNET 480p). Steps **4–8**, **CFG=1**, sampler `euler`, node `LoraLoaderModelOnly` gdy plik istnieje — API/UI nie nadpiszą (np. cfg=6 / 720p → coerce + warning)
- Brak LoRA na Comfy → graceful fallback (steps ~10, CFG 6, bez LoRA) + ostrzeżenie w UI
- **Quality 720p** = bez Fast LoRA / więcej steps; **Native 24** = experimental (preferuj Smooth 24 / RIFE)

### Comfy na Legionie (opcjonalnie Sage / --fast)

AIGen nie uruchamia Comfy — tylko woła API. Na Legionie możesz dodać flagi przy starcie (osobno od panelu):

```bash
python main.py --listen 127.0.0.1 --port 8188 --fast
# opcjonalnie SageAttention jeśli zainstalowane w venv Comfy (zależnie od buildu):
# python main.py --listen 127.0.0.1 --port 8188 --use-sage-attention
```

Sprawdź `python main.py --help` na swojej wersji Comfy — nazwy flag bywają różne.

## 6. Pipeline chunków (Wan/LTX)

**Domyślnie (zalecane):** Vercel `after()` **awaits** pętlę `kickPipelineBackground` (nie fire-and-forget), `GET /api/video/pipeline/[id]` robi `advancePipeline`, stan leży w Comfy `input/aigen-pipeline-*.json`. Browser poll (~2s) to UI status — **nie** jedyne źródło postępu; po cold start klient wznawia z checkpointu.

**`PIPELINE_LEGION_WORKER=1`:** zostaw **wyłączone**. Tryb eksperymentalny (panel GET bez advance; `POST …/register` bez osobnego auth poza `STUDIO_PASSWORD`). Nie mylić z niezależnym skryptem `aigen-queue-worker.py` na Legionie — ten może działać osobno i **nie** wymaga tej flagi.

| Tryb | ENV | Zachowanie |
|------|-----|------------|
| Best-effort (domyślnie) | brak / flaga wyłączona | `POST` start + **awaited** `after()` kick; `GET` advance + kick max co ~45s; durable JSON |
| Legion worker (eksperymentalne) | `PIPELINE_LEGION_WORKER=1` | Panel: `GET` tylko czyta. Worker: `POST …/register` — **nie** ustawiaj jako default |

Endpointy:

- `POST /api/video/pipeline` — start + enqueue c0
- `GET /api/video/pipeline/[id]` — status (+ advance jeśli nie Legion)
- `POST /api/video/pipeline/[id]/register` — claim / kick (opcjonalny worker)

## 7. Troubleshooting

| Objaw | Co sprawdzić |
|-------|----------------|
| Offline na pulpicie | ComfyUI uruchomione? `COMFYUI_URL`? firewall / tunel? |
| Galeria pusta | zdalnie: tunel + indeks (`seed-comfy-gallery-index.py`) / `/history`; lokalnie: `COMFYUI_OUTPUT_DIR` |
| `Galeria Comfy: … fetch failed → host` | Vercel `COMFYUI_URL` nie żyje (stary Quick Tunnel). Odczytaj `logs/cloudflared-tunnel-url.txt`, zaktualizuj ENV, redeploy. Preferuj Named Tunnel. |
| `historia`/`internal/files` fail, ale galeria działa | OK — UI idzie z indeksu; flaky endpointy są pomijane gdy indeks ma wpisy |
| Pobieranie zablokowane | tylko lokalny panel: brak `COMFYUI_MODELS_DIR` |
| Wideo pada na node | brak Wan / VHS / obrazu w `input` |
| Fast bez przyspieszenia | brak LoRA lightx2v w `loras/` — fallback klasyczny Fast |
| Fast + 720p „źle wygląda” | Fast jest zablokowany do 480p; Quality 720p = bez LoRA |
| Pipeline stoi po chunku 1 | `after()` / GET advance / durable JSON; **nie** włączaj `PIPELINE_LEGION_WORKER=1` „na zapas” |
