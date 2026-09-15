import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Phone-first web app for farmers, buyers and haulers. In development it proxies
// /v1 to the API so a phone on the same Wi-Fi can open http://<pc-ip>:5178 and
// reach everything through one origin. In production set VITE_API_BASE.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    host: true,
    proxy: {
      '/v1': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
