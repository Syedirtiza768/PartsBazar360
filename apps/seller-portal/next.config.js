/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  trailingSlash: true,
  basePath: "/seller",
  assetPrefix: "/seller",
  images: {
    // Listing photos come from many different seller/marketplace CDNs
    // (eBay, gridXconnect, etc.), so we allow any HTTPS host rather than
    // maintaining an allowlist.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
