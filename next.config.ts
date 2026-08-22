import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: a stray package-lock.json in the parent
  // directory (unrelated to this project) otherwise gets picked up by
  // Turbopack's root-detection walk-up.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
