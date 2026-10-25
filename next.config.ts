import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  images: {
    localPatterns: [{ pathname: "/portraits/**" }],
  },
  // The full claim list moved off the person page (025): old filter links land on /p/[id]/claims, query kept.
  async redirects() {
    return ["domain", "show", "year", "month"].map((key) => ({
      source: "/p/:id",
      has: [{ type: "query" as const, key }],
      destination: "/p/:id/claims",
      permanent: false,
    }));
  },
};

export default nextConfig;
