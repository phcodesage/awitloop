import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";

// Smart-TV browsers (LG webOS 4-6, Samsung Tizen 4-6) run Chromium 53-79.
// The legacy plugin ships a polyfilled SystemJS bundle so those screens still boot.
export default defineConfig({
  plugins: [legacy({ targets: ["chrome >= 53", "safari >= 12", "defaults"] })],
  build: { target: "es2019", cssTarget: "chrome61" },
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
});
