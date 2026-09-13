import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the console talks to the API through this proxy, so there is
// no CORS to configure locally. In production set VITE_API_BASE to the API's
// public /v1 URL and list the console's origin in the API's CORS_ORIGINS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
