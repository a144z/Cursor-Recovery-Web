import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    // For client-side, we need to exclude Node.js modules that sql.js tries to import
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }

    // For server-side (if we still need it), ensure sql.js is included
    if (isServer) {
        config.externals = (config.externals || []).filter(
            (external: any) => {
                if (typeof external === 'string') {
                    return !external.startsWith('sql.js');
                }
                if (external instanceof RegExp) {
                    return !external.test('sql.js');
                }
                return true;
            }
        );
    }
    
    return config;
  },
};

export default nextConfig;
