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
    },
    // Middleware runs on every path, and Next truncates request bodies above
    // this limit (default 10 MB) before Route Handlers read them. Helpdesk
    // enquiries carry up to 5 attachments of 10 MB each (Figma addendum §B);
    // each Route Handler still enforces its own limits.
    middlewareClientMaxBodySize: "52mb"
  }
};

export default nextConfig;
