import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base and hash routing (src/App.tsx) let the built app open straight
// from disk, so `npm run build:single` can produce one HTML file to email.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5175 },
});
