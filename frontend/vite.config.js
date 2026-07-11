import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // base must match your GitHub repo name exactly — assets won't load without this
  base: '/ripfit-app/',
  plugins: [react()],
  server: {
    port: 8080,
    // Proxy only applies in local dev (npm run dev).
    // In production the frontend calls VITE_API_URL directly.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
