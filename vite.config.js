import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // `npm run dev` + `npm run server`: the game's same-origin /api goes to
  // the Online server (server/index.js, port 4188).
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4188', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react/') || id.includes('react-dom/') || id.includes('react-router')) {
            return 'vendor-react';
          }
          if (id.includes('monaco-editor/')) {
            return 'vendor-monaco';
          }
        },
      },
    },
    chunkSizeWarningLimit: 6144,
  },
})
