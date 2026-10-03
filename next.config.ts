import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * PGlite ships a WASM build plus a Node filesystem adapter and must be loaded
   * from node_modules at runtime. Bundling it makes Next pick the browser entry
   * point, which then hands a URL to a node:path helper and throws on first query.
   */
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;