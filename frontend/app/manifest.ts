import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME, short_name: "Cite&Slayy", description: SITE_DESCRIPTION, start_url: "/", display: "standalone",
    background_color: "#fff5e6", theme_color: "#121212",
    icons: [
      { src: "/slayy-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/slayy-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/slayy-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/slayy-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
