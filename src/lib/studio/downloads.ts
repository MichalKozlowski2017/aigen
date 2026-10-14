import { createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { randomUUID } from "node:crypto";
import catalog from "./models-catalog.json";
import { modelsRoot, resolveModelPath } from "./paths";
import type { DownloadJob, ModelCatalogEntry } from "./types";

function catalogEntries(): ModelCatalogEntry[] {
  return catalog as ModelCatalogEntry[];
}

const jobs = new Map<string, DownloadJob>();
const modelToJob = new Map<string, string>();

export function getDownloadJob(id: string): DownloadJob | undefined {
  return jobs.get(id);
}

export function getDownloadJobForModel(modelId: string): DownloadJob | undefined {
  const id = modelToJob.get(modelId);
  return id ? jobs.get(id) : undefined;
}

export function listDownloadJobs(): DownloadJob[] {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export async function startModelDownload(
  modelId: string
): Promise<{ job: DownloadJob } | { error: string; status: number }> {
  const root = modelsRoot();
  if (!root) {
    return {
      error:
        "COMFYUI_MODELS_DIR nie jest ustawione — nie można pobierać modeli.",
      status: 400,
    };
  }

  const entry = catalogEntries().find((m) => m.id === modelId);
  if (!entry) {
    return { error: "Nieznany model w katalogu.", status: 404 };
  }

  const existing = getDownloadJobForModel(modelId);
  if (existing && (existing.status === "queued" || existing.status === "downloading")) {
    return { job: existing };
  }

  const targetPath = resolveModelPath(entry.targetSubdir, entry.filename);
  if (!targetPath) {
    return { error: "Nieprawidłowa ścieżka docelowa.", status: 400 };
  }

  try {
    await fs.access(targetPath);
    const done: DownloadJob = {
      id: randomUUID(),
      modelId: entry.id,
      filename: entry.filename,
      targetPath,
      status: "done",
      bytesReceived: 0,
      bytesTotal: null,
      percent: 100,
      error: null,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
    jobs.set(done.id, done);
    modelToJob.set(modelId, done.id);
    return { job: done };
  } catch {
    // not installed — continue
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const job: DownloadJob = {
    id: randomUUID(),
    modelId: entry.id,
    filename: entry.filename,
    targetPath,
    status: "queued",
    bytesReceived: 0,
    bytesTotal: null,
    percent: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  modelToJob.set(modelId, job.id);

  void runDownload(job, entry.downloadUrl);

  return { job };
}

async function runDownload(job: DownloadJob, url: string): Promise<void> {
  const partial = `${job.targetPath}.partial`;
  job.status = "downloading";

  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) {
      throw new Error(`Download HTTP ${res.status}`);
    }
    const totalHeader = res.headers.get("content-length");
    job.bytesTotal = totalHeader ? Number(totalHeader) : null;

    const nodeStream = Readable.fromWeb(
      res.body as import("stream/web").ReadableStream
    );
    let received = 0;
    nodeStream.on("data", (chunk: Buffer | string) => {
      const n = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      received += n;
      job.bytesReceived = received;
      if (job.bytesTotal && job.bytesTotal > 0) {
        job.percent = Math.min(99, Math.round((received / job.bytesTotal) * 100));
      }
    });

    await pipeline(nodeStream, createWriteStream(partial));
    await fs.rename(partial, job.targetPath);
    job.status = "done";
    job.percent = 100;
    job.finishedAt = Date.now();
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : "Błąd pobierania";
    job.finishedAt = Date.now();
    try {
      await fs.unlink(partial);
    } catch {
      // ignore
    }
  }
}
