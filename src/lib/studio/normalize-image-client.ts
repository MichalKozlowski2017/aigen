/**
 * Client-only: decode → bake EXIF orientation → JPEG, with a max edge for
 * Vercel body limits and Comfy LoadImage. No sharp / FileReader path.
 */

/** Longest side after normalize (Vercel/Comfy-friendly). */
export const UPLOAD_MAX_EDGE = 2048;
export const UPLOAD_JPEG_QUALITY = 0.9;

const ALLOWED_EXT = /\.(png|jpe?g|webp|gif)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;
const DNG_EXT = /\.dng$/i;

export class ImageNormalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageNormalizeError";
  }
}

function mimeOf(file: File): string {
  return (file.type || "").toLowerCase().trim();
}

function nameOf(file: File): string {
  return file.name || "";
}

/** ProRAW / Adobe DNG — browsers generally cannot decode these. */
export function isProRawOrDng(file: File): boolean {
  const mime = mimeOf(file);
  const name = nameOf(file).toLowerCase();
  return (
    DNG_EXT.test(name) ||
    mime === "image/dng" ||
    mime === "image/x-adobe-dng" ||
    mime.includes("dng")
  );
}

export function isHeicOrHeif(file: File): boolean {
  const mime = mimeOf(file);
  const name = nameOf(file).toLowerCase();
  return (
    HEIC_EXT.test(name) ||
    mime === "image/heic" ||
    mime === "image/heif" ||
    mime.includes("heic") ||
    mime.includes("heif")
  );
}

export function iphoneFormatHint(file: File): string | null {
  if (isProRawOrDng(file)) {
    return (
      "ProRAW / DNG nie da się wczytać w przeglądarce. " +
      "W Photos na iPhonie: Udostępnij → Zapisz jako JPEG (albo wyłącz Apple ProRAW), potem wgraj ponownie."
    );
  }
  if (isHeicOrHeif(file)) {
    return (
      "HEIC/HEIF: jeśli podgląd nie działa, w Photos zapisz zdjęcie jako JPEG, potem wgraj ponownie."
    );
  }
  return null;
}

function isAllowedRaster(file: File): boolean {
  const mime = mimeOf(file);
  if (
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/webp" ||
    mime === "image/gif"
  ) {
    return true;
  }
  if (ALLOWED_EXT.test(nameOf(file))) return true;
  // iOS sometimes sends image/* without a precise subtype
  if (mime.startsWith("image/") && !isProRawOrDng(file) && !isHeicOrHeif(file)) {
    return true;
  }
  return false;
}

async function decodeWithOrientation(file: File): Promise<ImageBitmap> {
  // Prefer createImageBitmap — `from-image` applies EXIF Orientation (Safari/Chromium).
  try {
    return await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
  } catch {
    // fall through
  }

  // Fallback: HTMLImageElement + canvas (many engines apply EXIF on draw).
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode_failed"));
      el.src = url;
    });
    return await createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new Error("toBlob_failed"));
      },
      "image/jpeg",
      quality
    );
  });
}

function safeJpegName(original: string): string {
  const base =
    original.replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") ||
    "start";
  const clipped = base.length > 160 ? base.slice(-160) : base;
  return `${clipped}.jpg`;
}

export type NormalizedUpload = {
  file: File;
  width: number;
  height: number;
  /** True when pixels were re-encoded (EXIF bake / resize). */
  reencoded: boolean;
};

/**
 * Normalize a picked/gallery image for `/api/upload` → Comfy:
 * bake EXIF orientation, JPEG encode, cap longest edge.
 */
export async function normalizeImageForUpload(
  file: File,
  options?: { maxEdge?: number; quality?: number }
): Promise<NormalizedUpload> {
  if (!file || file.size <= 0) {
    throw new ImageNormalizeError("Pusty plik obrazu");
  }

  // DNG / ProRAW: never attempt decode — fail with a clear PL tip.
  if (isProRawOrDng(file)) {
    throw new ImageNormalizeError(iphoneFormatHint(file)!);
  }

  const maxEdge = options?.maxEdge ?? UPLOAD_MAX_EDGE;
  const quality = options?.quality ?? UPLOAD_JPEG_QUALITY;

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeWithOrientation(file);
  } catch {
    if (isHeicOrHeif(file)) {
      throw new ImageNormalizeError(
        "HEIC/HEIF nie udało się zdekodować. W Photos na iPhonie zapisz zdjęcie jako JPEG, potem wgraj ponownie."
      );
    }
    if (!isAllowedRaster(file)) {
      throw new ImageNormalizeError(
        "Wybierz PNG, JPEG, WebP lub GIF. HEIC/ProRAW: zapisz jako JPEG w Photos."
      );
    }
    throw new ImageNormalizeError(
      "Nie udało się odczytać obrazu. Spróbuj zapisać jako JPEG w Photos i wgrać ponownie."
    );
  }

  try {
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    if (srcW <= 0 || srcH <= 0) {
      throw new ImageNormalizeError("Obraz ma zerowe wymiary");
    }

    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new ImageNormalizeError("Brak kontekstu canvas (WebGL/2D)");
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    let blob: Blob;
    try {
      blob = await canvasToJpegBlob(canvas, quality);
    } catch {
      throw new ImageNormalizeError(
        "Nie udało się zapisać JPEG. Spróbuj mniejszego zdjęcia lub eksportu z Photos."
      );
    }

    const out = new File([blob], safeJpegName(nameOf(file)), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    return { file: out, width, height, reencoded: true };
  } finally {
    bitmap.close();
  }
}
