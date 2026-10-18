import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pośrednicy w trybie dev / preview:
//  - Overpass: serwer Vite dodaje User-Agent, a przeglądarka nie trafia na błędy CORS (502/504),
//  - GIOŚ: API jakości powietrza nie zezwala na zapytania z innych domen (CORS).
const proxy = {
  "/overpass": {
    target: "https://overpass-api.de",
    changeOrigin: true,
    rewrite: () => "/api/interpreter",
    headers: { "User-Agent": "invgeo-prototype/1.0 (hackathon)" },
    timeout: 180000,
    proxyTimeout: 180000,
  },
  "/gios": {
    target: "https://api.gios.gov.pl",
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/gios/, "/pjp-api"),
    headers: { "User-Agent": "invgeo-prototype/1.0 (hackathon)" },
    timeout: 60000,
    proxyTimeout: 60000,
  },
};

export default defineConfig({
  plugins: [react()],
  server: { open: true, proxy },
  preview: { proxy },
  build: { chunkSizeWarningLimit: 1500 },
  // wątek propozycji (src/model/propozycje.worker.js) ładuje modele dynamicznie – potrzebny format ES
  worker: { format: "es" },
});
