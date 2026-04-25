/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  images: {
    unoptimized: true,
  },
  // Tell Next not to bundle these — they're native modules that must load from
  // node_modules at runtime. Sharp ships prebuilt binaries; onnxruntime-node
  // has .node native addons.
  serverExternalPackages: ['sharp', 'onnxruntime-node'],

  // Belt-and-suspenders: explicitly tell webpack not to attempt to resolve or
  // bundle these packages for either server or client builds. The
  // serverExternalPackages above should be enough but some Next.js versions
  // still trace through the package looking for binary modules.
  webpack: (config, { isServer }) => {
    if (isServer) {
      // On the server, mark these as commonjs externals so they're loaded at
      // runtime via require() rather than bundled.
      config.externals = config.externals || [];
      config.externals.push({
        'onnxruntime-node': 'commonjs onnxruntime-node',
        'sharp': 'commonjs sharp',
      });
    } else {
      // On the client, ensure these never end up in browser bundles. If anything
      // tries to import them client-side, webpack will produce an empty stub
      // rather than blowing up trying to load .node files.
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        'onnxruntime-node': false,
        'sharp': false,
      };
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
