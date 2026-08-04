/* global process */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  trailingSlash: true,
  basePath: "/admin",
  assetPrefix: "/admin",
  // The shared UI package ships TypeScript source, so Next has to compile it.
  transpilePackages: ["@repo/ui"],
  // Local development without the nginx/docker stack: set DEV_API_PROXY to a
  // deployed origin and the dev server proxies browser /api calls there,
  // mirroring nginx in production. No-op when unset.
  async rewrites() {
    const proxy = process.env.DEV_API_PROXY;
    if (!proxy) return [];
    return [{ source: "/api/:path*", destination: `${proxy}/api/:path*`, basePath: false }];
  },
};

export default nextConfig;
