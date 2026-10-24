/**
 * Presety formatu w panelu Obraz (Flux.2 i SDXL).
 *
 * Szerokość i wysokość w formularzu idą krokiem 64. To wielokrotność kroku
 * EmptyFlux2LatentImage (16) i EmptyLatentImage SDXL (8), w zakresie schematu
 * 256–2048, więc graf tych rozmiarów nie odrzuca.
 *
 * 1344×768 i 768×1344 to bucket ~1 MP dla 16:9 i 9:16 przy tym kroku
 * (ten sam, co SDXL i Comfy ResolutionSelector przy multiple=64).
 * Osobnego Story/Reel nie ma: w tym panelu to ten sam pion 9:16.
 * 1080×1920 nie wchodzi — 1080 nie dzieli się przez 16 ani przez 64.
 */

export const IMAGE_DIMENSION_MIN = 256;
export const IMAGE_DIMENSION_MAX = 2048;
/** Krok inputów Szerokość/Wysokość w panelu Obraz. */
export const IMAGE_DIMENSION_STEP = 64;

export type ImageFormatPresetId = "square" | "landscape-16x9" | "portrait-9x16";

export type ImageFormatSelection = ImageFormatPresetId | "custom";

export type ImageFormatPreset = {
  id: ImageFormatPresetId;
  label: string;
  blurb: string;
  width: number;
  height: number;
};

export const IMAGE_FORMAT_PRESETS: readonly ImageFormatPreset[] = [
  {
    id: "square",
    label: "Kwadrat",
    blurb: "1:1 · 1024×1024",
    width: 1024,
    height: 1024,
  },
  {
    id: "landscape-16x9",
    label: "Poziom",
    blurb: "16:9 · 1344×768",
    width: 1344,
    height: 768,
  },
  {
    id: "portrait-9x16",
    label: "Pion",
    blurb: "9:16 · 768×1344",
    width: 768,
    height: 1344,
  },
];

export const IMAGE_FORMAT_CUSTOM: {
  id: "custom";
  label: string;
  blurb: string;
} = {
  id: "custom",
  label: "Własny",
  blurb: "ręcznie",
};

export function getImageFormatPreset(
  id: ImageFormatPresetId
): ImageFormatPreset {
  const preset = IMAGE_FORMAT_PRESETS.find((item) => item.id === id);
  if (!preset) {
    throw new Error(`Nieznany format obrazu: ${id}`);
  }
  return preset;
}

/** Czy wymiar przejdzie input (krok 64) oraz latent Flux.2 i SDXL. */
export function isAcceptedImageDimension(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= IMAGE_DIMENSION_MIN &&
    value <= IMAGE_DIMENSION_MAX &&
    value % IMAGE_DIMENSION_STEP === 0
  );
}

for (const preset of IMAGE_FORMAT_PRESETS) {
  if (
    !isAcceptedImageDimension(preset.width) ||
    !isAcceptedImageDimension(preset.height)
  ) {
    throw new Error(
      `Preset ${preset.id} (${preset.width}×${preset.height}) nie jest wielokrotnością ${IMAGE_DIMENSION_STEP} w zakresie ${IMAGE_DIMENSION_MIN}–${IMAGE_DIMENSION_MAX}`
    );
  }
}
