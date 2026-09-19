import { validateProductionConfig } from "./lib/productionConfig";
import path from "node:path";
import type { NextConfig } from "next";

validateProductionConfig(process.env.RAILWAY_SERVICE_ID && !process.env.VERCEL ? "realtime" : "web");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
    ] }]
  },
  // A package-lock.json exists above this repo (outside git), which made
  // Turbopack guess the wrong workspace root. Pin it explicitly.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
