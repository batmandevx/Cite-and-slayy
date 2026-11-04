import type { NextConfig } from "next";

// Content Security Policy for every page. Next.js inlines its hydration data and our theme / JSON-LD scripts, so scripts
// need 'unsafe-inline'; what the policy enforces is *where* code, frames and connections may come from.
const apiOrigin = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").origin; } catch { return ""; }
})();
const dev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src 'self' ${apiOrigin} https://*.razorpay.com${dev ? " ws: http://localhost:*" : ""}`,
  `frame-src 'self' blob: ${apiOrigin} https://*.razorpay.com`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://www.overleaf.com https://*.razorpay.com",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        // Same set Caddy adds in production (deploy/Caddyfile.template), so the app is covered behind any proxy.
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), usb=(), microphone=(self), payment=(self)" },
        { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
        ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
      ],
    }];
  },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
