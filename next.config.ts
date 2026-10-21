import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  images: {
    localPatterns: [{ pathname: "/portraits/**" }],
  },
};

export default nextConfig;
