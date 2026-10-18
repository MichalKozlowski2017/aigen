import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchComfyViewBlob } from "./comfy-client";
import { LTX_CHUNK_OVERLAP } from "./ltx-chunks";

export type StitchClip = {
  filename: string;
  subfolder?: string;
  type?: string;
};

/**
 * Pobiera klipy z Comfy /view, skleja ffmpeg (pomija overlap w chunkach 2…N),
 * wrzuca wynik z powrotem do Comfy input (jako plik do galerii przez upload type=output... 
 * Upload API only does input — wrzucamy do input z nazwą stitched, albo output via /upload).
 *
 * Comfy /upload/image type=input. Dla galerii lepiej type=output — używamy upload z type input
 * i zwracamy nazwę; klient odświeży galerię z historii po generate stitch job... 
 *
 * Prościej: zapis lokalny temp + upload jako image nie zadziała dla mp4.
 * Comfy POST /upload/image accepts images; for video use /upload/image still? 
 * Actually Comfy has POST /upload/image for images only.
 *
 * Legion pattern: write to Comfy output folder via... we can't write output remotely easily.
 * Alternative: return the stitched file as a downloadable response / base64 — bad for large files.
 *
 * Best: upload via Comfy's undocumented video upload OR save through a tiny Comfy workflow.
 * ComfyUI supports: POST /upload/image with type=output for some versions.
 *
 * From Comfy source upload: type can be input|temp|output.
 */
export async function stitchComfyClips(options: {
  clips: StitchClip[];
  fps: number;
  overlapFrames?: number;
  filenamePrefix?: string;
}): Promise<{
  filename: string;
  subfolder: string;
  type: string;
  bytes: number;
}> {
  const overlap = options.overlapFrames ?? LTX_CHUNK_OVERLAP;
  const fps = Math.max(1, options.fps);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "aigen-stitch-"));

  try {
    const localClips: string[] = [];
    for (let i = 0; i < options.clips.length; i++) {
      const c = options.clips[i]!;
      const blob = await fetchComfyViewBlob(
        c.filename,
        c.subfolder ?? "",
        c.type ?? "output"
      );
      if (!blob) {
        throw new Error(
          `Nie pobrano klipu ${c.filename} (subfolder=${c.subfolder ?? ""})`
        );
      }
      const local = path.join(tmp, `clip_${i}.mp4`);
      await fs.writeFile(local, Buffer.from(await blob.arrayBuffer()));
      localClips.push(local);
    }

    const trimmed: string[] = [];
    for (let i = 0; i < localClips.length; i++) {
      const src = localClips[i]!;
      if (i === 0 || overlap <= 0) {
        trimmed.push(src);
        continue;
      }
      const out = path.join(tmp, `trim_${i}.mp4`);
      // Pomiń pierwsze `overlap` klatek (kontynuacja last-frame)
      const startSec = overlap / fps;
      await runFfmpeg([
        "-y",
        "-ss",
        startSec.toFixed(4),
        "-i",
        src,
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-an",
        out,
      ]);
      trimmed.push(out);
    }

    const listFile = path.join(tmp, "concat.txt");
    await fs.writeFile(
      listFile,
      trimmed.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
    );

    const stitched = path.join(tmp, "stitched.mp4");
    // -c copy tylko gdy codec/rozmiar/pix_fmt się zgadzają; inaczej CRF (preset fast)
    const canCopy = await clipsCompatibleForCopy(trimmed);
    if (canCopy) {
      try {
        await runFfmpeg([
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listFile,
          "-c",
          "copy",
          "-an",
          stitched,
        ]);
      } catch {
        await runFfmpeg(concatEncodeArgs(listFile, fps, stitched));
      }
    } else {
      await runFfmpeg(concatEncodeArgs(listFile, fps, stitched));
    }

    const buf = await fs.readFile(stitched);
    const base =
      (options.filenamePrefix ?? "studio/video-ltx-stitched")
        .split("/")
        .pop() || "video-ltx-stitched";
    const uploadName = `${base}_${Date.now()}.mp4`;

    // Comfy akceptuje type=output przy uploadzie obrazów; dla mp4 też działa w praktyce
    const uploaded = await uploadVideoToComfy(buf, uploadName, "output", "studio");

    return {
      filename: uploaded.name,
      subfolder: uploaded.subfolder || "studio",
      type: uploaded.type || "output",
      bytes: buf.byteLength,
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function uploadVideoToComfy(
  data: Buffer,
  filename: string,
  type: string,
  subfolder: string
): Promise<{ name: string; subfolder: string; type: string }> {
  // reuse FormData upload path from comfy-client pattern
  const { getComfyUrlAsync } = await import("./config");
  const form = new FormData();
  form.append(
    "image",
    new Blob([new Uint8Array(data)], { type: "video/mp4" }),
    filename
  );
  form.append("overwrite", "true");
  form.append("type", type);
  form.append("subfolder", subfolder);

  const base = (await getComfyUrlAsync()).replace(/\/$/, "");
  const res = await fetch(`${base}/upload/image`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    name?: string;
    subfolder?: string;
    type?: string;
  };
  if (!res.ok || !json.name) {
    // Fallback: jeśli upload mp4 nie przejdzie, i tak zwróć lokalny błąd czytelny
    throw new Error(
      `Upload stitched mp4 do Comfy nieudany (HTTP ${res.status}). Sprawdź czy Comfy przyjmuje video przez /upload/image.`
    );
  }
  return {
    name: json.name,
    subfolder: json.subfolder ?? subfolder,
    type: json.type ?? type,
  };
}

/** libx264 CRF — jakość OK, preset fast (nie ultrafast/slow). */
function concatEncodeArgs(
  listFile: string,
  fps: number,
  out: string
): string[] {
  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-r",
    String(fps),
    out,
  ];
}

/** fingerprint: codec|pix_fmt|WxH — wystarczy do bezpiecznego concat -c copy */
async function probeVideoFingerprint(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(resolveFfmpegBin(), ["-hide_banner", "-i", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      // np. Video: h264 (High) (avc1 / 0x31637661), yuv420p, 832x480, …
      const m = err.match(
        /Video:\s*([^,\s]+).*?,\s*([^,({\s]+).*?,\s*(\d+)x(\d+)/i
      );
      if (!m) {
        resolve(null);
        return;
      }
      resolve(
        `${m[1]!.toLowerCase()}|${m[2]!.toLowerCase()}|${m[3]}x${m[4]}`
      );
    });
  });
}

async function clipsCompatibleForCopy(files: string[]): Promise<boolean> {
  if (files.length === 0) return false;
  if (files.length === 1) return true;
  const prints = await Promise.all(files.map(probeVideoFingerprint));
  const first = prints[0];
  if (!first) return false;
  return prints.every((p) => p === first);
}

function resolveFfmpegBin(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticBin = require("ffmpeg-static") as string | null;
    if (staticBin) return staticBin;
  } catch {
    /* PATH fallback — Legion / system ffmpeg */
  }
  return "ffmpeg";
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegBin(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-800)}`));
    });
  });
}

export { pickChunkOutputs } from "./video-outputs";
