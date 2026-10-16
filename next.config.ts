import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static ships a native binary — keep it external for API stitch route
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
