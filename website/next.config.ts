import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // Reel video uploads (/api/reel-upload) pass through the proxy; raise the body cap above the
  // 120 MB backend limit so large videos aren't truncated to the 10 MB default.
  experimental: { proxyClientMaxBodySize: "150mb" },
  // Place photos are served by the backend; expose them on this site's own origin.
  async rewrites() {
    return [{ source: "/media/:path*", destination: `${backend}/media/:path*` }];
  },
};

export default nextConfig;
