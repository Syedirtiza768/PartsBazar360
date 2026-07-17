/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  trailingSlash: true,
  basePath: "/buyer",
  assetPrefix: "/buyer",
  transpilePackages: ["@repo/ui"],
  images: {
    // Real listing photos come from many different seller/marketplace CDNs
    // (eBay, gridXconnect, etc.), so we allow any HTTPS host rather than
    // maintaining an allowlist.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // Local development without the nginx/docker stack: set DEV_API_PROXY to a
  // deployed origin (e.g. https://partsbazar360.realtrackapp.com) and the dev
  // server proxies browser /api and /img-proxy calls there, mirroring what
  // nginx does in production. Unset in production, so this emits no rewrites.
  async rewrites() {
    const proxy = process.env.DEV_API_PROXY;
    if (!proxy) return [];
    return [
      { source: "/api/:path*", destination: `${proxy}/api/:path*`, basePath: false },
    ];
  },
};

export default nextConfig;
