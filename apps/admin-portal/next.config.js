/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  trailingSlash: true,
  basePath: "/admin",
  assetPrefix: "/admin",
  // The shared UI package ships TypeScript source, so Next has to compile it.
  transpilePackages: ["@repo/ui"],
};

export default nextConfig;
