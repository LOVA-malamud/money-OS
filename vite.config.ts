import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  let privileged = key.startsWith('sb_secret_');
  try { privileged ||= JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64').toString()).role === 'service_role'; } catch { /* A publishable key need not be a JWT. */ }
  if (privileged) throw new Error('A privileged Supabase key cannot be bundled. Use only the publishable or anon key.');
  return {
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
    manifest: {
      id: '/', name: 'Lova Money OS', short_name: 'Lova', lang: 'he', dir: 'rtl',
      description: 'התמונה הכלכלית שלך, במקום אחד', start_url: '/', scope: '/',
      display: 'standalone', background_color: '#111615', theme_color: '#111615',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: { globPatterns: ['**/*.{js,css,html,png,woff2}'], navigateFallback: '/index.html', cleanupOutdatedCaches: true },
    devOptions: { enabled: false },
  })],
  server: { host: '0.0.0.0', port: 5173 },
  test: { include: ['src/**/*.test.ts', 'tests/database/**/*.test.ts'], testTimeout: 30000, hookTimeout: 60000 },
  };
});
