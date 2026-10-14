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

## Zmienne środowiskowe

| Zmienna | Opis |
|---------|------|
| `COMFYUI_URL` | Adres API ComfyUI (domyślnie `http://127.0.0.1:8188`) |
| `COMFYUI_MODELS_DIR` | Katalog `models` ComfyUI (checkpoints, itd.) |
| `COMFYUI_OUTPUT_DIR` | Katalog `output` ComfyUI (galeria) |
| `STUDIO_PASSWORD` | Opcjonalne hasło; chroni panel i `/api/*` |

## Skrypty

| Polecenie | Opis |
|-----------|------|
| `npm run dev` | Serwer deweloperski (port 3000) |
| `npm run build` | Produkcyjny build |
| `npm run start` | Uruchomienie po buildzie |
| `npm run lint` | ESLint |

## RTX 5080 — praktyczne limity (~16 GB VRAM)

- **Obraz (SDXL):** 1024², batch 1–2
- **Wideo (SVD):** krótkie klipy, rozdzielczość ≤ 576 px, niski FPS — patrz `docs/studio-setup.md`

Nie commituj plików `.safetensors` / `.ckpt`.

## Licencja

Prywatny projekt Michała Kozłowskiego — użycie na własną odpowiedzialność.
