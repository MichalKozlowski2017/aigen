/**
 * Smoke: default Fast path = Wan 2.1 (no MoE nodes).
 * Asserts single UNET + KSampler (not dual KSamplerAdvanced).
 *
 *   npx --yes tsx scripts/smoke-wan21-fast.ts
 */
import {
  isWan22FastMoeEnabled,
  WAN22_MOE_UNSTABLE_NOTE,
} from "../src/lib/studio/wan22";
import { applyWan22FastMoeGraph } from "../src/lib/studio/workflow-builder";
import txt2videoWanTemplate from "../src/lib/studio/workflows/txt2video-wan.json";

type Node = { class_type: string; inputs: Record<string, unknown> };
type Graph = Record<string, Node>;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function cloneTemplate(): Graph {
  const clone = JSON.parse(JSON.stringify(txt2videoWanTemplate)) as Record<
    string,
    unknown
  >;
  delete clone._meta;
  return clone as Graph;
}

/** Wan 2.1 Fast shape after distill LoRA splice (no MoE). */
function assertWan21FastGraph(graph: Graph, label: string): void {
  assert(graph["37"]?.class_type === "UNETLoader", `${label}: single high UNET`);
  assert(!graph["57"], `${label}: must NOT have MoE low UNET 57`);
  assert(!graph["61"], `${label}: must NOT have MoE low sampler 61`);
  assert(
    graph["3"]?.class_type === "KSampler",
    `${label}: sampler must be KSampler (got ${graph["3"]?.class_type})`
  );
  assert(
    graph["3"]?.class_type !== "KSamplerAdvanced",
    `${label}: no KSamplerAdvanced on 2.1 Fast`
  );
  assert(graph["38"]?.class_type === "CLIPLoader", `${label}: CLIPLoader`);
  assert(graph["49"]?.class_type === "CLIPVisionLoader", `${label}: CLIPVision`);
  assert(graph["50"]?.class_type === "WanImageToVideo", `${label}: WanImageToVideo`);
  assert(graph["54"]?.class_type === "ModelSamplingSD3", `${label}: SD3`);
  for (const [id, n] of Object.entries(graph)) {
    assert(
      n.class_type !== "CheckpointLoaderSimple",
      `${label}: unexpected CheckpointLoaderSimple at ${id}`
    );
  }
}

delete process.env.WAN22_MOE_ENABLE;
assert(isWan22FastMoeEnabled() === false, "default MoE off");
assert(/RTX 5080/i.test(WAN22_MOE_UNSTABLE_NOTE), "UI note mentions RTX 5080");

const g21 = cloneTemplate();
g21["55"] = {
  class_type: "LoraLoaderModelOnly",
  inputs: {
    model: ["37", 0],
    lora_name: "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors",
    strength_model: 1,
  },
};
g21["54"].inputs.model = ["55", 0];
assertWan21FastGraph(g21, "wan21-distill");

// MoE apply produces dual path — contrast only (opt-in in production)
const gMoe = cloneTemplate();
applyWan22FastMoeGraph(gMoe, {
  highNoise: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
  lowNoise: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
  loraHigh: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
  loraLow: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
  seed: 1,
  sage: false,
});
assert(gMoe["61"]?.class_type === "KSamplerAdvanced", "moe contrast: has 61");
assert(gMoe["57"]?.class_type === "UNETLoader", "moe contrast: has 57");

console.log(
  JSON.stringify({
    ok: true,
    defaultMoeEnabled: false,
    wan21: {
      sampler: g21["3"].class_type,
      unets: ["37"],
      hasMoE: false,
    },
    note: WAN22_MOE_UNSTABLE_NOTE.slice(0, 80),
  })
);
