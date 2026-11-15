import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: { host: '0.0.0.0', port: 1420, strictPort: true, allowedHosts: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // Pre-bundle the on-demand worker dependency at server startup. Otherwise
  // Vite may reload an in-progress editor when preview is opened for the first time.
  // Scan only the app entry. benchmarks/engines/index.html imports packages that are not installed;
  // scanning it fails the whole scan, so Vite reloads the page during startup and the editor can stall.
  optimizeDeps: { entries: ['index.html'], include: ['markdown-it'] },
  build: { target: ['es2022', 'chrome105'], sourcemap: false },
});
