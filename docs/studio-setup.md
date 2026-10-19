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
- **iPhone:** panel client-side normalizuje JPEG/PNG (bake EXIF Orientation + cap ~2048px) przed uploadem. HEIC — próba dekodowania w Safari; przy błędzie zapisz jako JPEG w Photos. **ProRAW/DNG** nie są obsługiwane — w Photos: Udostępnij → Zapisz jako JPEG (albo wyłącz Apple ProRAW).

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
# Named Tunnel (gdy jest domena) — stały hostname
COMFYUI_URL=https://comfy.your-domain.com
STUDIO_PASSWORD=...
# Bez domeny (Quick Tunnel auto-sync):
# COMFY_URL_UPDATE_SECRET=...   # wymagany dla auto-publish (nie REVALIDATE_SECRET)
# COMFY_URL_ALLOW_HOSTS=...          # opcjonalnie poza *.trycloudflare.com
# KV_REST_API_URL=...   # opcjonalnie, trwały override
# KV_REST_API_TOKEN=...
# PIPELINE_LEGION_WORKER — zostaw wyłączone (patrz §6). Nie włączać domyślnie.
```

- **Modele:** status „gotowy/brak” z `GET {COMFYUI_URL}/models/{folder}` (nie z dysku Vercel).
- **Galeria (index-first):** najpierw trwały indeks `input/aigen-gallery-index.json` (przeżywa wipe `/history` po reboocie; krótki cache ~15 s), potem opcjonalnie `/history` + stock `/internal/files/output` (tylko gdy indeks pusty/skąpy; `/internal/files` nie rekuruje `studio/`). Proxy plików: `/api/comfy-view`. Filtry Obrazy/Wideo są lokalne (bez ponownego fetch). **Odśwież indeks** w UI = cache bust + `/view`. Pełny skan dysku: `python scripts/seed-comfy-gallery-index.py` na Legionie. Queue worker dopisuje indeks przez `scripts/legion/aigen-gallery-index-watcher.py` (start z `start-queue-worker.ps1`).
- **Autostart Legion:** `scripts/legion/start-comfy-stack.ps1` (Comfy + Quick Tunnel + queue worker). Bez domeny: `AIGEN_PANEL_URL` + `COMFY_URL_UPDATE_SECRET` → auto `publish-comfy-url.ps1`. Opcjonalnie `install-startup-shortcut.ps1`. Szczegóły: `scripts/legion/README.md`.
- **Named Tunnel / Quick auto-sync:** [docs/named-cloudflare-tunnel.md](named-cloudflare-tunnel.md).
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

**Motyw panelu:** domyślnie **jasny** (czytelny na iPhonie w słońcu) — przełącznik Jasny/Ciemny w nagłówku; wybór w `localStorage` (`aigen-theme`).

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
| Wideo  | Wan Fast 480p + lightx2v; **Fast + upscale/smooth** (RealESRGAN×2 + RIFE); SVD legacy |

### Wan Fast (distill LoRA)

- Plik: `models/loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`
- Preset **Fast**: **tylko 480p** — landscape **832×480** / portrait **480×832** (orientacja ze start image). Steps **4–8**, **CFG=1**, sampler `euler`, node `LoraLoaderModelOnly` gdy plik istnieje — API/UI nie nadpiszą (np. cfg=6 / 720p → coerce + warning)
- Brak LoRA na Comfy → graceful fallback (steps ~10, CFG 6, bez LoRA) + ostrzeżenie w UI
- **Fast + upscale/smooth** = zalecane vs Quality 720p (480p + RealESRGAN×2 + RIFE)
- **Quality 720p** = **wolne** (~40+ min/chunk @16GB) · bez Fast LoRA; **Native 24** = experimental
- Chunki (4n+1): **preferuj 81** Fast 480p (mniej reloadów / mniej driftu); Quality 720p **≤65** (Legion A/B: L81 interrupted); UI opcja **33** = smoke. Short 2s @16fps i tak ≈33 — nie psuje smoke.

### Tip: 480p + RealESRGAN + RIFE vs native 720p

Na ~16 GB VRAM zwykle **szybciej i stabilniej**: preset **Fast + upscale/smooth** (RealESRGAN×2 + RIFE 16→24) niż native Quality 720p. Quality 720p zostaw gdy potrzebujesz natywnej ostrości bez upscale.

### RAM: soft unload przy zmianie Flux ↔ Wan

Flux + Wan łącznie ~**73 GB** wag vs ~**64 GB** RAM Legion. Panel woła Comfy `POST /free` (`unload_models` + `free_memory`) przy zmianie Obraz↔Wideo oraz z przycisku **Zwolnij modele** (nagłówek / Ustawienia) — soft unload, bez restartu procesu. Seria samych obrazów albo samych wideo — bez unloadu.

### Wan 2.2 Fast MoE (preferowane gdy pliki na Legionie)

Studio **preferuje Wan 2.2 Fast MoE** gdy wykryje high+low UNET **i** lightx2v LoRA pair (albo fused distill UNETs). Inaczej → Wan 2.1 Fast + LoRA 480p. **Nie pobieraj multi-GB na cloud VM.**

Graph: 2× `UNETLoader` → `LoraLoaderModelOnly` (high/low) → opcjonalnie `PathchSageAttentionKJ` → `ModelSamplingSD3` (shift **5**) → `KSamplerAdvanced` high (0→2) → low (2→4) → decode. **Steps 4 · CFG=1 · euler/simple.** Geometria Fast: 832×480 / 480×832 (portrait z #24). Chunk continue: `ImageFromBatch` z `length = frames - overlap` (≥1; nigdy `-1`).

Filenames (Legion SoT → `diffusion_models/` / `loras/`):

| Rola | Plik |
|------|------|
| I2V FP8 high | `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` |
| I2V FP8 low | `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` |
| LoRA 4-step high | `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` |
| LoRA 4-step low | `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors` |

Opcjonalnie fused distill (bez LoRA): `wan2.2_i2v_A14b_{high,low}_noise_scaled_fp8_e4m3_lightx2v_4step_comfyui.safetensors`.

HF: [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged), [lightx2v/Wan2.2-Distill-Models](https://huggingface.co/lightx2v/Wan2.2-Distill-Models). VAE/CLIP: te same co 2.1 (`wan_2.1_vae`, `umt5_xxl_fp8`, `clip_vision_h`).

**Fast default = Wan 2.1** (+ lightx2v), **bez** `PathchSageAttentionKJ`. Opt-in: `WAN22_MOE_ENABLE=1`, `WAN_SAGE_ENABLE=1`. Na RTX 5080 (sm_120) Sage/MoE+Sage padają `cudaErrorNoKernelImageForDevice`; Wan 2.1 bez Sage = OK.

### Comfy na Legionie (`--fast` + Sage via KJNodes)

AIGen nie uruchamia Comfy — tylko woła API. Na Legionie:

```bash
# Zalecane: --fast TAK; --use-sage-attention NIE (ryzyko black frames na Wan)
python main.py --listen 127.0.0.1 --port 8188 --fast
```

SageAttention: zainstaluj `ComfyUI-KJNodes` + pakiet `sageattention` w venv. Panel Wan Fast wstawia node **`PathchSageAttentionKJ`** (Patch Sage Attention KJ) z trybem `sageattn_qk_int8_pv_fp16_cuda` gdy `/object_info` go widzi — graceful skip gdy brak. **Nie** włączaj globalnego `--use-sage-attention`.

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
| Fast bez przyspieszenia | brak Wan 2.2 MoE / brak LoRA lightx2v 2.1 — fallback klasyczny Fast |
| Fast idzie 2.1 mimo Wan 2.2 na dysku | brak pary LoRA high+low (albo fused distill) — dołóż LoRAs |
| Fast + 720p „źle wygląda” | Fast jest zablokowany do 480p; Quality 720p = bez LoRA |
| Pipeline stoi po chunku 1 | `after()` / GET advance / durable JSON; **nie** włączaj `PIPELINE_LEGION_WORKER=1` „na zapas” |
