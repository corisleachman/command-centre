const isPages = process.env.GITHUB_ACTIONS === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: isPages ? "/command-centre" : "",
  assetPrefix: isPages ? "/command-centre/" : ""
};

export default nextConfig;
