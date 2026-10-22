import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt": a new version waits until the user taps "Update", so a rider is never reloaded mid-delivery.
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Deep Water Refilling Station",
        short_name: "Deep Water",
        description: "Order water refills, track deliveries and run the station.",
        lang: "en-PH",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        theme_color: "#1b76f0",
        background_color: "#f8fafc",
        categories: ["business", "shopping"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Cache only the app itself (code, styles, fonts, icons) so it opens instantly and works offline.
        // API calls, uploaded images and map tiles are deliberately NOT cached: orders, payments and cash
        // must always come from the server, never from an old copy.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//, /\.[a-z0-9]+$/i],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173 },
});
