import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { devApi } from "./server/dev/vitePlugin";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devApi()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: { port: 8080 },
  // Each server test boots a fresh in-memory PGlite; under a full parallel run that alone can pass 5 s.
  test: { testTimeout: 30_000 },
});
