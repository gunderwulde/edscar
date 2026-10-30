// Configuración de Vite para apps/web (ADR-006). Sin plugins de terceros: el JSX lo transforma
// esbuild (integrado en Vite) con el runtime automático de React; sin Fast Refresh por ahora.
import { defineConfig } from "vite";

export default defineConfig({
  // Ruta relativa: la app funciona tanto en la raíz como en un subdirectorio (GitHub Pages: /edscar/).
  base: "./",
  esbuild: { jsx: "automatic" },
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
});
