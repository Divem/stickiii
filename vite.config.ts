import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    target: ["es2021", "chrome105", "safari14"],
    sourcemap: false,
  },
});
