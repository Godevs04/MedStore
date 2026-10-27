/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a production build run alongside `next dev` without sharing `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Transpile internal workspace packages (they ship CJS dist builds).
  transpilePackages: ['@medicore/shared-types', '@medicore/validation'],
};

export default nextConfig;
