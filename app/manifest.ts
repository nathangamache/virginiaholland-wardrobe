import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wardrobe',
    short_name: 'Wardrobe',
    description: 'A curated closet.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fdfbf7',
    theme_color: '#fdfbf7',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
