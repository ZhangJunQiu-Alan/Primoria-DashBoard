import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        popout: path.resolve(__dirname, 'popout.html'),
      },
    },
  },
  // Tauri dev server config
  server: {
    strictPort: true,
    port: 5173,
  },
  envPrefix: ['VITE_', 'TAURI_'],
})
