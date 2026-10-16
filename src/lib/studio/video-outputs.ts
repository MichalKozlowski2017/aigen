/** Wspólne (client + server) wybieranie outputów chunka LTX. */

export type MediaRef = {
  filename: string;
  subfolder: string;
  type: string;
};

export function pickChunkOutputs(outputs: MediaRef[]): {
  video: MediaRef | null;
  tail: MediaRef | null;
} {
  const videos = outputs.filter((o) => /\.(mp4|webm|mov)$/i.test(o.filename));
  const tails = outputs.filter(
    (o) =>
      /\.(png|jpe?g|webp)$/i.test(o.filename) && /ltx-tail/i.test(o.filename)
  );
  const video =
    [...videos].reverse().find((v) => /video-ltx/i.test(v.filename)) ??
    videos[videos.length - 1] ??
    null;
  const tail = tails[tails.length - 1] ?? null;
  return { video, tail };
}
