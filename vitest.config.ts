import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      exclude: [
        'dist/**',
        'tests/**',
        '**/*.config.*',
        'scripts/**',
        'node_modules/**',
        // Type-only contracts and re-export barrels: no runtime logic to cover.
        'src/index.ts',
        'src/**/types.ts',
        'src/connectors/index.ts',
      ],
    },
  },
})
