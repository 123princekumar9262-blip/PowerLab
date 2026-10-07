import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // The simulation engine is framework-free, so tests run in plain Node.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
