import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base and hash routing (src/App.tsx) let the built app open straight
// from disk, so `npm run build:single` can produce one HTML file to email.
// In dev, /api goes to the detection service in backend/ (see backend/run.sh); QAVACH_BACKEND points it elsewhere.
// The config runs in Node, but the project has no Node types; read the one variable we need without them.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const backend = env.QAVACH_BACKEND ?? 'http://127.0.0.1:8830';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5175, proxy: { '/api': backend } },
});
