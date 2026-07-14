/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  trailingSlash: true,
  basePath: "/buyer",
  assetPrefix: "/buyer",
  images: {
    // Real listing photos come from many different seller/marketplace CDNs
    // (eBay, gridXconnect, etc.), so we allow any HTTPS host rather than
    // maintaining an allowlist.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
