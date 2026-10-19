import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  devIndicators: false,
  async redirects() {
    return [
      { source: "/:locale(en-GB|zh-CN)/pricing", destination: "/:locale/subscription", permanent: true },
      { source: "/pricing", destination: "/en-GB/subscription", permanent: true }
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb"
    }
  }
};

export default nextConfig;
