/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  trailingSlash: true,
  basePath: "/seller",
  assetPrefix: "/seller",
  transpilePackages: ["@repo/ui"],
  images: {
    // Listing photos come from many different seller/marketplace CDNs
    // (eBay, gridXconnect, etc.), so we allow any HTTPS host rather than
    // maintaining an allowlist.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // Local development without the nginx/docker stack: set DEV_API_PROXY to a
  // deployed origin and the dev server proxies browser /api and /img-proxy
  // calls there, mirroring nginx in production. No-op when unset.
  async rewrites() {
    const proxy = process.env.DEV_API_PROXY;
    if (!proxy) return [];
    return [
      { source: "/api/:path*", destination: `${proxy}/api/:path*`, basePath: false },
      { source: "/img-proxy/", destination: `${proxy}/img-proxy/`, basePath: false },
    ];
  },
};

export default nextConfig;
