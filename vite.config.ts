import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

function manualChunks(id: string) {
  if (!id.includes('node_modules')) return undefined

  const normalized = id.split(path.sep).join('/')

  if (
    normalized.includes('/node_modules/react/') ||
    normalized.includes('/node_modules/react-dom/') ||
    normalized.includes('/node_modules/scheduler/')
  ) {
    return 'vendor-react'
  }

  if (
    normalized.includes('/node_modules/@supabase/') ||
    normalized.includes('/node_modules/@realtime-js/') ||
    normalized.includes('/node_modules/@storage-js/') ||
    normalized.includes('/node_modules/@supabase-js/')
  ) {
    return 'vendor-supabase'
  }

  if (
    normalized.includes('/node_modules/@dnd-kit/') ||
    normalized.includes('/node_modules/react-grid-layout/') ||
    normalized.includes('/node_modules/react-draggable/') ||
    normalized.includes('/node_modules/react-resizable/')
  ) {
    return 'vendor-dashboard-layout'
  }

  if (
    normalized.includes('/node_modules/music-metadata/') ||
    normalized.includes('/node_modules/strtok3/') ||
    normalized.includes('/node_modules/token-types/') ||
    normalized.includes('/node_modules/file-type/') ||
    normalized.includes('/node_modules/uint8array-extras/') ||
    normalized.includes('/node_modules/media-typer/')
  ) {
    return 'vendor-music-metadata'
  }

  if (
    normalized.includes('/node_modules/lucide-react/') ||
    normalized.includes('/node_modules/sonner/') ||
    normalized.includes('/node_modules/zustand/')
  ) {
    return 'vendor-ui'
  }

  return undefined
}

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
      output: {
        manualChunks,
      },
    },
  },
  server: {
    strictPort: true,
    port: 5173,
  },
  envPrefix: ['VITE_'],
})
