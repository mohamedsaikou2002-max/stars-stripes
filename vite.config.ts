import { defineConfig, loadEnv } from "vite";
import type { Plugin } from 'vite';
import { randomBytes } from "node:crypto";
import { createMonitorHandler, policyOrigins } from "./scripts/monitor-backend.mjs";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const nonce = randomBytes(24).toString('base64');
  const monitor: Plugin = { name: 'local-traffic-backend', configureServer(server) {
    server.middlewares.use(createMonitorHandler({ backendOrigins: policyOrigins(env.VITE_SUPABASE_URL), nonce }));
  } };
  return {
  html: { cspNonce: nonce },
  server: {
    host: "127.0.0.1",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [monitor, react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}; });
