import path from "path";
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @deskspawn:imports

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    // @deskspawn:plugins
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @deskspawn:aliases
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});
