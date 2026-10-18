/**
 * Smoke: friendlyComfyError must NOT map Wan CLIPLoader dumps to SVD.
 *
 *   npx --yes tsx scripts/smoke-comfy-errors.ts
 */
import { friendlyComfyError } from "../src/lib/studio/comfy-errors";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertNotSvd(label: string, raw: unknown, engine?: string) {
  const f = friendlyComfyError(raw, engine ? { engine } : undefined);
  assert(
    f.code !== "svd_loader_mismatch",
    `${label}: got svd_loader_mismatch — ${f.message}`
  );
  assert(
    !/ImageOnlyCheckpointLoader|SVD wymaga/i.test(f.message),
    `${label}: SVD copy in message — ${f.message}`
  );
  assert(
    !/ImageOnlyCheckpointLoader|hard refresh/i.test(f.hint ?? ""),
    `${label}: SVD copy in hint — ${f.hint}`
  );
  console.log(`OK  ${label} → [${f.code}] ${f.message.slice(0, 100)}`);
}

function assertIsSvd(label: string, raw: unknown) {
  const f = friendlyComfyError(raw, { engine: "svd" });
  assert(f.code === "svd_loader_mismatch", `${label}: expected svd, got ${f.code}`);
  console.log(`OK  ${label} → [${f.code}]`);
}

// Wan CLIPLoader value_not_in_list — previously false-positive SVD
assertNotSvd("wan_clip_value_not_in_list", {
  error: {
    type: "prompt_outputs_failed_validation",
    message: "Prompt outputs failed validation",
  },
  node_errors: {
    "38": {
      class_type: "CLIPLoader",
      errors: [
        {
          type: "value_not_in_list",
          message: "Value not in list",
          details: "clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'",
        },
      ],
    },
  },
}, "wan");

// Wan dump with both CLIP + CLIPVision class types + real other error
assertNotSvd("wan_both_clip_nodes_plus_ksampler", {
  error: { message: "Prompt outputs failed validation" },
  node_errors: {
    "3": {
      class_type: "KSamplerAdvanced",
      errors: [
        {
          type: "exception",
          message: "CUDA OOM",
          details: "out of memory",
        },
      ],
    },
    "38": { class_type: "CLIPLoader", errors: [] },
    "49": { class_type: "CLIPVisionLoader", errors: [] },
  },
}, "wan");

// ImageFromBatch — must surface real node error
{
  const f = friendlyComfyError({
    error: { message: "Prompt outputs failed validation" },
    node_errors: {
      "24": {
        class_type: "ImageFromBatch",
        errors: [
          {
            type: "value_smaller_than_min",
            message: "Value -1 smaller than min of 1",
            details: "length",
          },
        ],
      },
    },
  });
  assert(f.code === "prompt_validation", `imagefrombatch code=${f.code}`);
  assert(/ImageFromBatch/i.test(f.message + (f.details ?? "")), "imagefrombatch dump");
  console.log(`OK  imagefrombatch → [${f.code}] ${f.message.slice(0, 100)}`);
}

// Real SVD mismatch — still SVD when context/engine says so
assertIsSvd("svd_real_mismatch", {
  error: { message: "Prompt outputs failed validation" },
  node_errors: {
    "3": {
      class_type: "SVD_img2vid_Conditioning",
      errors: [
        {
          type: "return_type_mismatch",
          message:
            "Return type mismatch between linked nodes: CLIP, CLIP_VISION",
          details: "clip_vision, CLIP != CLIP_VISION",
        },
      ],
    },
  },
});

// Same mismatch on Wan engine — type_mismatch, NOT svd copy
{
  const f = friendlyComfyError(
    {
      error: { message: "Prompt outputs failed validation" },
      node_errors: {
        "51": {
          class_type: "CLIPVisionEncode",
          errors: [
            {
              type: "return_type_mismatch",
              message:
                "Return type mismatch between linked nodes: CLIP, CLIP_VISION",
              details: "clip_vision, CLIP != CLIP_VISION",
            },
          ],
        },
      },
    },
    { engine: "wan" }
  );
  assert(f.code === "type_mismatch", `wan mismatch code=${f.code}`);
  assert(!/ImageOnlyCheckpointLoader/i.test(f.message), "wan mismatch no SVD");
  console.log(`OK  wan_clip_mismatch → [${f.code}] ${f.message.slice(0, 100)}`);
}

// CUDA no-kernel (real Wan 2.2 MoE failure on Legion history) — not SVD
{
  const f = friendlyComfyError(
    {
      exception_type: "torch.AcceleratorError",
      exception_message:
        "CUDA error: no kernel image is available for execution on the device\nSearch for `cudaErrorNoKernelImageForDevice'",
      node_id: "61",
      node_type: "KSamplerAdvanced",
    },
    { engine: "wan" }
  );
  assert(f.code === "cuda_no_kernel_image", `cuda code=${f.code}`);
  assert(!/ImageOnlyCheckpointLoader|SVD wymaga/i.test(f.message), "cuda no SVD");
  console.log(`OK  cuda_no_kernel → [${f.code}] ${f.message.slice(0, 100)}`);
}

console.log("\nsmoke-comfy-errors: all passed");
