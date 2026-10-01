import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],

  base: '/macau-trip-planner/',

  server: {
    port: 5173,
    strictPort: true,
  },
})