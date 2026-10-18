/**
 * Smoke: Wan 2.2 Fast MoE chunk0 + chunk1 workflow JSON.
 * Asserts no ImageFromBatch length<1 and both high+low KSamplerAdvanced.
 *
 *   npx --yes tsx scripts/smoke-wan22-chunks.ts
 */
import txt2videoWanTemplate from "../src/lib/studio/workflows/txt2video-wan.json";
import {
  WAN22_FAST_CFG,
  WAN22_FAST_HIGH_END_STEP,
  WAN22_FAST_LOW_END_STEP,
  WAN22_FAST_SAMPLER,
  WAN22_FAST_SCHEDULER,
  WAN22_FAST_SHIFT,
  WAN22_FAST_STEPS,
  WAN22_I2V_HIGH_NOISE_FP8,
  WAN22_I2V_LOW_NOISE_FP8,
  WAN22_LIGHTX2V_LORA_HIGH,
  WAN22_LIGHTX2V_LORA_LOW,
} from "../src/lib/studio/wan22";
import {
  applyWan22FastMoeGraph,
  imageFromBatchLengths,
  spliceSkipOverlapFrames,
} from "../src/lib/studio/workflow-builder";

type WorkflowGraph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

function cloneTemplate(): WorkflowGraph {
  const clone = JSON.parse(JSON.stringify(txt2videoWanTemplate)) as Record<
    string,
    unknown
  >;
  delete clone._meta;
  return clone as WorkflowGraph;
}

function buildMoeChunk(chunkIdx: number, chunkLength: number): WorkflowGraph {
  const graph = cloneTemplate();
  graph["50"].inputs.length = chunkLength;
  applyWan22FastMoeGraph(graph, {
    highNoise: WAN22_I2V_HIGH_NOISE_FP8,
    lowNoise: WAN22_I2V_LOW_NOISE_FP8,
    loraHigh: WAN22_LIGHTX2V_LORA_HIGH,
    loraLow: WAN22_LIGHTX2V_LORA_LOW,
    seed: 42,
    sage: false,
  });
  if (chunkIdx > 0) {
    spliceSkipOverlapFrames(graph, "21", chunkLength, 1);
  }
  return graph;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertMoeGraph(graph: WorkflowGraph, label: string): void {
  const high = graph["3"];
  const low = graph["61"];
  assert(high?.class_type === "KSamplerAdvanced", `${label}: high sampler missing`);
  assert(low?.class_type === "KSamplerAdvanced", `${label}: low sampler missing`);
  assert(graph["37"]?.class_type === "UNETLoader", `${label}: high UNET`);
  assert(graph["57"]?.class_type === "UNETLoader", `${label}: low UNET`);
  assert(graph["54"]?.class_type === "ModelSamplingSD3", `${label}: high SD3`);
  assert(graph["60"]?.class_type === "ModelSamplingSD3", `${label}: low SD3`);
  assert(graph["54"].inputs.shift === WAN22_FAST_SHIFT, `${label}: shift`);
  assert(graph["55"]?.class_type === "LoraLoaderModelOnly", `${label}: high LoRA`);
  assert(graph["58"]?.class_type === "LoraLoaderModelOnly", `${label}: low LoRA`);

  assert(high.inputs.steps === WAN22_FAST_STEPS, `${label}: high steps`);
  assert(high.inputs.cfg === WAN22_FAST_CFG, `${label}: high cfg`);
  assert(high.inputs.sampler_name === WAN22_FAST_SAMPLER, `${label}: high sampler`);
  assert(high.inputs.scheduler === WAN22_FAST_SCHEDULER, `${label}: high sched`);
  assert(high.inputs.start_at_step === 0, `${label}: high start`);
  assert(high.inputs.end_at_step === WAN22_FAST_HIGH_END_STEP, `${label}: high end`);
  assert(high.inputs.add_noise === "enable", `${label}: high add_noise`);
  assert(
    high.inputs.return_with_leftover_noise === "enable",
    `${label}: high leftover`
  );

  assert(low.inputs.steps === WAN22_FAST_STEPS, `${label}: low steps`);
  assert(low.inputs.cfg === WAN22_FAST_CFG, `${label}: low cfg`);
  assert(low.inputs.start_at_step === WAN22_FAST_HIGH_END_STEP, `${label}: low start`);
  assert(low.inputs.end_at_step === WAN22_FAST_LOW_END_STEP, `${label}: low end`);
  assert(low.inputs.add_noise === "disable", `${label}: low add_noise`);
  assert(
    (low.inputs.latent_image as [string, number])?.[0] === "3",
    `${label}: low latent from high`
  );
  assert(
    (graph["8"].inputs.samples as [string, number])?.[0] === "61",
    `${label}: VAEDecode from low`
  );

  for (const len of imageFromBatchLengths(graph)) {
    assert(len >= 1, `${label}: ImageFromBatch length ${len} < 1`);
  }
}

const CHUNK_LEN = 81;

const chunk0 = buildMoeChunk(0, CHUNK_LEN);
assertMoeGraph(chunk0, "chunk0");
assert(!chunk0["24"], "chunk0: must not have ImageFromBatch #24");

const chunk1 = buildMoeChunk(1, CHUNK_LEN);
assertMoeGraph(chunk1, "chunk1");
assert(chunk1["24"]?.class_type === "ImageFromBatch", "chunk1: node 24");
assert(chunk1["24"].inputs.batch_index === 1, "chunk1: batch_index=1");
assert(chunk1["24"].inputs.length === CHUNK_LEN - 1, "chunk1: length=frames-1");
assert(
  (chunk1["21"].inputs.images as [string, number])?.[0] === "24",
  "chunk1: VHS from #24"
);

// Single-frame edge: skip ImageFromBatch (keep would be 0)
const edge = cloneTemplate();
edge["21"].inputs.images = ["8", 0];
spliceSkipOverlapFrames(edge, "21", 1, 1);
assert(!edge["24"], "edge: skip ImageFromBatch when keep<1");
assert(
  (edge["21"].inputs.images as [string, number])?.[0] === "8",
  "edge: VHS still on decode"
);

// Never emit length=-1
const badProbe = cloneTemplate();
spliceSkipOverlapFrames(badProbe, "21", 33, 1);
assert(badProbe["24"].inputs.length === 32, "probe length");
assert(
  imageFromBatchLengths(badProbe).every((n) => n >= 1),
  "no length<1"
);

console.log(
  JSON.stringify({
    ok: true,
    chunk0_samplers: ["3", "61"],
    chunk1_imageFromBatch: {
      batch_index: chunk1["24"].inputs.batch_index,
      length: chunk1["24"].inputs.length,
    },
    moe: {
      steps: WAN22_FAST_STEPS,
      cfg: WAN22_FAST_CFG,
      high: `0→${WAN22_FAST_HIGH_END_STEP}`,
      low: `${WAN22_FAST_HIGH_END_STEP}→${WAN22_FAST_LOW_END_STEP}`,
      shift: WAN22_FAST_SHIFT,
    },
  })
);
