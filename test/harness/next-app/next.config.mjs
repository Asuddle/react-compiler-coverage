import path from 'node:path';

/** @type {import('next').NextConfig} */
const unminified = process.env.RCC_UNMINIFIED === '1';

const nextConfig = {
  experimental: {
    reactCompiler: true,
  },
  outputFileTracingRoot: path.join(import.meta.dirname, '../../..'),
  webpack: (config, { dev }) => {
    if (unminified && !dev) {
      config.optimization = { ...config.optimization, minimize: false };
    }
    return config;
  },
};

export default nextConfig;
