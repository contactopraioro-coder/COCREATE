import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5174
  },
  build: {
    outDir: "overlay-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "overlay.html")
    }
  }
});
