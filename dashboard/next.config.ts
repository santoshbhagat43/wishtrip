import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  // The dev route indicator floats over the sidebar's footer; we don't need it.
  devIndicators: false,
  // Uploaded media is served by the backend; expose it on the dashboard's origin.
  async rewrites() {
    return [{ source: "/media/:path*", destination: `${backend}/media/:path*` }];
  },
};

export default nextConfig;
