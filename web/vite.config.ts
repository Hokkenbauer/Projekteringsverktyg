import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Bygget läggs i serverns wwwroot, så att servern levererar webbappen.
// Under utveckling skickas /api, /hubs och /health vidare till servern på port 5080.
const server = "http://localhost:5080";

export default defineConfig({
  plugins: [react()],
  // Byggets tidpunkt, används för att webbläsaren ska hämta ny version av ritverktyget.
  define: { __BYGGE__: JSON.stringify(Date.now().toString(36)) },
  build: {
    outDir: "../server/src/Projekteringsverktyg.Server/wwwroot",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": server,
      "/health": server,
      "/hubs": { target: server, ws: true },
    },
  },
});
