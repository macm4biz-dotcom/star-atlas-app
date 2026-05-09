import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: "buffer/",
    },
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [".trycloudflare.com", ".up.railway.app"],
    proxy: {
      "/api": "http://127.0.0.1:4100",
      "/health": "http://127.0.0.1:4100",
    },
  },
});
