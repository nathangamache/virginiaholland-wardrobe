/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  images: {
    // We serve images through our authenticated /api/images route,
    // so we don't need Next's image optimization pipeline for them.
    unoptimized: true,
  },
  // @imgly/background-removal and its ONNX Runtime backend run ONLY in the
  // browser. Telling webpack to skip them for server bundles prevents their
  // native modules from being traced into serverless output where they'd
  // never run anyway (and could crash on CPUs lacking modern SIMD extensions).
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(config.externals || []),
        '@imgly/background-removal',
        'onnxruntime-web',
        'onnxruntime-node',
      ];
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Content-Type', value: 'application/manifest+json' }],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
