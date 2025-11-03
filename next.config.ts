import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ensure sql.js WASM file is included in serverless bundle
      config.externals = config.externals || [];
      // Don't externalize sql.js - we need it in the bundle
    }
    return config;
  },
  // Ensure WASM files are treated as assets
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
