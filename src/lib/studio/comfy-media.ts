/**
 * Normalizacja ścieżek Comfy /view.
 * VHS z prefixem `studio/video` zapisuje plik jako
 * output/studio/video_00001.mp4 → filename=video_00001.mp4, subfolder=studio.
 * Bez subfolder Comfy zwraca 404.
 */

export type ComfyMediaRef = {
  filename: string;
  subfolder: string;
  type: string;
};

/** Rozdziel filename z ewentualną ścieżką + heurystyka studio dla VHS. */
export function normalizeComfyMediaRef(
  filename: string,
  subfolder = "",
  type = "output"
): ComfyMediaRef {
  let file = (filename || "").trim().replace(/\\/g, "/");
  let sub = (subfolder || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  if (file.includes("/")) {
    const parts = file.split("/").filter(Boolean);
    file = parts.pop() || file;
    const fromName = parts.join("/");
    sub = sub ? [sub, fromName].filter(Boolean).join("/") : fromName;
  }

  // Nasze workflow: filename_prefix "studio/video" → video_XXXXX.mp4 w studio/
  if (
    !sub &&
    /\.(mp4|webm|mov|mkv)$/i.test(file) &&
    /^video_\d+/i.test(file)
  ) {
    sub = "studio";
  }

  // Flux/SDXL SaveImage: studio/txt2img… — gdy ktoś poda sam basename bez sub
  if (
    !sub &&
    /\.(png|jpe?g|webp|gif)$/i.test(file) &&
    /^(txt2img|video)_/i.test(file)
  ) {
    sub = "studio";
  }

  return {
    filename: file,
    subfolder: sub,
    type: type || "output",
  };
}

/** Kandydaci subfolder przy 404 (kolejność: znany → studio → root). */
export function comfyViewSubfolderFallbacks(subfolder: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  push(subfolder);
  push("studio");
  push("");
  return out;
}

export function mimeFromFilename(filename: string): string {
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
    : "";
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    default:
      return "application/octet-stream";
  }
}

export function isVideoFilename(filename: string): boolean {
  return /\.(mp4|webm|mov|mkv)$/i.test(filename);
}
