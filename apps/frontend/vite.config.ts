import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const backendUrl = `http://localhost:${process.env.BACKEND_PORT || 8000}`;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true
      },
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
})
