import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The backend's URL comes from VITE_BACKEND_URL (src/api.ts, README).

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    // The msw handlers mock the default backend; a VITE_BACKEND_URL from a
    // developer's .env.local must not redirect the tests.
    env: { VITE_BACKEND_URL: 'http://localhost:8000' },
  },
})
