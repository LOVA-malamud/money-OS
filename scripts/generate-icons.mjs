import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WalletMinimal } from 'lucide-react';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

// Use the same maintained Lucide icon as the application, inside the maskable safe area.
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['icon-maskable', 512], ['apple-touch-icon', 180]]) {
  const markSize = Math.round(size * 0.48);
  const mark = renderToStaticMarkup(createElement(WalletMinimal, { size: markSize, color: '#bae6ca', strokeWidth: 1.45 }));
  await sharp({ create: { width: size, height: size, channels: 4, background: '#111615' } })
    .composite([{ input: await sharp(Buffer.from(mark)).png().toBuffer(), gravity: 'center' }])
    .png().toFile(new URL(`../public/icons/${name}.png`, import.meta.url).pathname);
}
