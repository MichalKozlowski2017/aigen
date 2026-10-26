/**
 * Smoke: wybór silnika H3-Lite i ciało create (bez wywołania API).
 *
 *   npx --yes tsx scripts/smoke-h3-lite.ts
 */
import { generateBodySchema } from "../src/lib/studio/schemas";
import {
  buildH3LiteCreateBody,
  buildMinimaxCreateBody,
} from "../src/lib/studio/minimax-video";
import {
  H3_LITE_RESOLUTION,
  H3_LITE_UI_LIMITS,
  MINIMAX_API_KEY_ENV,
  MINIMAX_H3_LITE_MODEL,
  MINIMAX_VIDEO_ENGINES,
  VIDEO_ENGINE_OPTIONS,
  clampH3LiteDuration,
  clampMinimaxDuration,
  formatUsdPerSec,
  h3LiteEstimatedUsd,
  isChunkedVideoEngine,
  isMinimaxVideoEngine,
  isVideoEngine,
  videoEngineSkipsComfyHealth,
  type MinimaxVideoEngineId,
} from "../src/lib/studio/video-engines";
import {
  buildWorkflow,
  planVideo,
  resolveVideoEngine,
} from "../src/lib/studio/workflow-builder";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(isVideoEngine("h3-lite"), "h3-lite is a video engine");
assert(!isChunkedVideoEngine("h3-lite"), "h3-lite is not chunked");
assert(videoEngineSkipsComfyHealth("h3-lite"), "h3-lite skips Comfy health");
assert(!videoEngineSkipsComfyHealth("wan"), "wan still requires Comfy");
assert(!videoEngineSkipsComfyHealth("ltx"), "ltx still requires Comfy");
assert(!videoEngineSkipsComfyHealth("svd"), "svd still requires Comfy");
assert(
  VIDEO_ENGINE_OPTIONS.some((opt) => opt.id === "h3-lite"),
  "form options include h3-lite"
);
assert(MINIMAX_API_KEY_ENV === "MINIMAX_API_KEY", "single env var name");
assert(MINIMAX_H3_LITE_MODEL === "MiniMax-H3-Lite", "model id");
assert(H3_LITE_RESOLUTION === "768P", "768P");

assert(clampH3LiteDuration(undefined) === 5, "default 5s");
assert(clampH3LiteDuration(2) === 4, "floor 4s");
assert(clampH3LiteDuration(20) === 15, "cap 15s");
assert(clampH3LiteDuration(7.4) === 7, "round 7");
assert(h3LiteEstimatedUsd(5) === 0.2, "5s ≈ 0.20 USD");
assert(
  H3_LITE_UI_LIMITS.defaultDurationSec === 5 &&
    H3_LITE_UI_LIMITS.minDurationSec === 4 &&
    H3_LITE_UI_LIMITS.maxDurationSec === 15,
  "UI limits 4–15 default 5"
);

assert(resolveVideoEngine({ videoEngine: "h3-lite" }) === "h3-lite", "resolve");
assert(resolveVideoEngine({ videoEngine: "wan" }) === "wan", "wan unchanged");
assert(
  resolveVideoEngine({ model: "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors" }) ===
    "wan",
  "model name still selects wan"
);

const plan = planVideo({ videoEngine: "h3-lite", durationSec: 5 });
assert(plan.engine === "h3-lite", "plan engine");
assert(plan.effectiveDurationSec === 5, "plan 5s");
assert(plan.vramRisky === false, "no local VRAM plan");
assert(!plan.chunkPlan, "no chunks");

const clamped = planVideo({ videoEngine: "h3-lite", durationSec: 60 });
assert(clamped.durationSec === 15 && clamped.durationClamped, "plan caps 15");

const parsed = generateBodySchema.safeParse({
  kind: "video",
  prompt: "kobieta odwraca głowę",
  videoEngine: "h3-lite",
  durationSec: 5,
  startImage: "start.jpg",
  startImageDataUrl: "data:image/jpeg;base64,aaaa",
});
assert(parsed.success, "schema accepts h3-lite");
assert(
  !generateBodySchema.safeParse({
    kind: "video",
    prompt: "x",
    videoEngine: "hailuo",
  }).success,
  "schema rejects hailuo (not on v2 create)"
);
assert(
  !generateBodySchema.safeParse({
    kind: "video",
    prompt: "x",
    videoEngine: "h3-regen",
  }).success,
  "schema rejects regeneration"
);

const expected: Array<{
  id: MinimaxVideoEngineId;
  model: string;
  resolution: string;
  usdPerSec: number;
  minDurationSec: number;
}> = [
  { id: "h3-768p", model: "MiniMax-H3", resolution: "768P", usdPerSec: 0.08, minDurationSec: 4 },
  { id: "h3-2k", model: "MiniMax-H3", resolution: "2K", usdPerSec: 0.13, minDurationSec: 4 },
  { id: "h3-highspeed", model: "MiniMax-H3-Highspeed", resolution: "768P", usdPerSec: 0.06, minDurationSec: 4 },
  { id: "h3-lite", model: "MiniMax-H3-Lite", resolution: "768P", usdPerSec: 0.04, minDurationSec: 4 },
  { id: "h3-lite-480p", model: "MiniMax-H3-Lite", resolution: "480P", usdPerSec: 0.025, minDurationSec: 4 },
  { id: "h3-max", model: "MiniMax-H3-Max", resolution: "768P", usdPerSec: 0.08, minDurationSec: 5 },
  { id: "h3-max-480p", model: "MiniMax-H3-Max", resolution: "480P", usdPerSec: 0.05, minDurationSec: 5 },
];
assert(MINIMAX_VIDEO_ENGINES.length === expected.length, "seven MiniMax choices");
assert(
  MINIMAX_VIDEO_ENGINES.filter((spec) => spec.id === "h3-lite").length === 1,
  "h3-lite stays one choice"
);
const models = new Set(MINIMAX_VIDEO_ENGINES.map((spec) => spec.model));
assert(
  models.size === 4 &&
    models.has("MiniMax-H3") &&
    models.has("MiniMax-H3-Highspeed") &&
    models.has("MiniMax-H3-Lite") &&
    models.has("MiniMax-H3-Max"),
  "v2 create model enum only"
);
for (const row of expected) {
  const spec = MINIMAX_VIDEO_ENGINES.find((item) => item.id === row.id);
  assert(spec, `missing ${row.id}`);
  assert(spec.model === row.model, `${row.id} model`);
  assert(spec.resolution === row.resolution, `${row.id} resolution`);
  assert(spec.usdPerSec === row.usdPerSec, `${row.id} usd/s`);
  assert(spec.minDurationSec === row.minDurationSec, `${row.id} min duration`);
  assert(isVideoEngine(row.id) && isMinimaxVideoEngine(row.id), `${row.id} engine`);
  assert(!isChunkedVideoEngine(row.id), `${row.id} not chunked`);
  assert(videoEngineSkipsComfyHealth(row.id), `${row.id} skips Comfy`);
  const option = VIDEO_ENGINE_OPTIONS.find((opt) => opt.id === row.id);
  assert(option, `${row.id} is a form choice`);
  assert(
    option.label.includes(`${formatUsdPerSec(row.usdPerSec)} USD/s`),
    `${row.id} shows USD/s`
  );
  const created = buildMinimaxCreateBody({
    engine: row.id,
    prompt: "she turns her head",
    imageUrl: "data:image/jpeg;base64,aaaa",
    durationSec: 4,
  });
  assert(created.model === row.model, `${row.id} create model`);
  assert(created.resolution === row.resolution, `${row.id} create resolution`);
  assert(created.duration === row.minDurationSec, `${row.id} duration floor`);
  assert(!("ratio" in created), `${row.id} omits ratio`);
  const parsedEngine = generateBodySchema.safeParse({
    kind: "video",
    prompt: "x",
    videoEngine: row.id,
    durationSec: 5,
    startImage: "start.jpg",
  });
  assert(parsedEngine.success, `schema accepts ${row.id}`);
  const planned = planVideo({ videoEngine: row.id, durationSec: 4 });
  assert(planned.engine === row.id, `${row.id} plan engine`);
  assert(planned.durationSec === row.minDurationSec, `${row.id} plan floor`);
  assert(!planned.chunkPlan && planned.vramRisky === false, `${row.id} no chunks`);
}
assert(clampMinimaxDuration("h3-max", 4) === 5, "H3-Max rejects 4s");
assert(clampMinimaxDuration("h3-lite", 4) === 4, "Lite still allows 4s");
assert(!isMinimaxVideoEngine("MiniMax-Hailuo-2.3"), "hailuo model id is not an engine");
assert(
  !MINIMAX_VIDEO_ENGINES.some((spec) => spec.model.includes("Hailuo")),
  "catalog has no Hailuo"
);

const body = buildH3LiteCreateBody({
  prompt: "she turns her head",
  imageUrl: "data:image/jpeg;base64,aaaa",
  durationSec: 5,
});
assert(body.model === "MiniMax-H3-Lite", "create model");
assert(body.resolution === "768P", "create resolution");
assert(body.duration === 5, "create duration");
assert(body.content.length === 2, "text + image");
assert(body.content[0].type === "text" && body.content[0].text.length > 0, "prompt");
assert(
  body.content[1].type === "image_url" &&
    body.content[1].role === "first_frame" &&
    body.content[1].image_url.url.startsWith("data:image/jpeg;base64,"),
  "first frame field"
);
assert(!("ratio" in body), "I2V omits ratio");
assert(!("negative_prompt" in body), "no negative");
assert(!("fps" in body) && !("cfg" in body) && !("steps" in body), "no sampler knobs");

const wanBody = generateBodySchema.parse({
  kind: "video",
  prompt: "wan",
  videoEngine: "wan",
  durationSec: 2,
  postRife: true,
  postUpscale: true,
});
assert(wanBody.videoEngine === "wan", "wan schema");
assert(wanBody.postRife === true && wanBody.postUpscale === true, "rife/upscale flags stay");

async function main(): Promise<void> {
  let threw = false;
  try {
    await buildWorkflow({
      ...wanBody,
      videoEngine: "h3-lite",
      prompt: "cloud",
    });
  } catch (err) {
    threw = err instanceof Error && /ComfyUI/.test(err.message);
  }
  assert(threw, "buildWorkflow refuses h3-lite");
  let refusedMax = false;
  try {
    await buildWorkflow({
      ...wanBody,
      videoEngine: "h3-2k",
      prompt: "cloud",
    });
  } catch (err) {
    refusedMax = err instanceof Error && /ComfyUI/.test(err.message);
  }
  assert(refusedMax, "buildWorkflow refuses h3-2k");
  console.log("OK  minimax engines, h3-lite 768P, duration, create body, Comfy gate");
}

void main();
