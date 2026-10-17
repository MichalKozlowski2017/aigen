/** Domyślny negatyw SDXL — mniej „plastiku” / kreskówki przy bazowym checkpointcie. */
export const DEFAULT_SDXL_NEGATIVE =
  "blurry, low quality, watermark, text, deformed, cartoon, anime, plastic skin, oversaturated, 3d render, cgi";

/** Domyślny negatyw Wan/LTX — ręce, zoom, shake kamery. */
export const DEFAULT_WAN_NEGATIVE =
  "low quality, worst quality, deformed, static, blurry, subtitles, watermark, bad anatomy, motionless, morphing hands, deformed hands, extra fingers, zoom-in, camera zoom, approach zoom, camera shake, shaky camera, abrupt zoom, dutch angle";

/** Guard do promptu wideo — stabilna kamera / kadr. */
export const VIDEO_CAMERA_GUARD = "static camera, medium shot";

export const VIDEO_CAMERA_GUARD_NEG_HINT =
  "morphing hands, zoom-in, camera shake";
