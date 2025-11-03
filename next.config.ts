import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  output: 'standalone',
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    // This is key for Vercel. By default, Next.js may externalize dependencies
    // for server-side bundles. We need sql.js and its wasm file to be included.
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
