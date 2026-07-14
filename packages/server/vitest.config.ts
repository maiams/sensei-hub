import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Longer timeout for mongodb-memory-server startup on first run
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
