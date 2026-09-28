import type { NextConfig } from "next";

// Security headers (see docs/PROJE_DENETIM_VE_YOL_HARITASI.md §S6).
// CSP is intentionally NOT set yet — it must enumerate map tile / font hosts
// and be added as part of the pre-launch checklist.
const securityHeaders = [
  // Prevent MIME-type sniffing of responses.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Disallow embedding the app in iframes (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  // Send only the origin on cross-origin navigation.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app does not use camera/mic/geolocation browser APIs.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Enforce HTTPS once deployed; ignored by browsers over plain HTTP in dev.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Emit .next/standalone: a self-contained server.js plus only the traced
  // node_modules. Required by infra/Dockerfile's `web` target — without it the
  // production image would have to carry the full dependency tree.
  // Note: Next does not copy public/ or .next/static into standalone; the
  // Dockerfile copies both explicitly.
  output: "standalone",
  // The prototype is opened through the in-app Browser on the loopback IP.
  // Allow its development client/HMR resources to hydrate normally.
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
