/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile internal workspace packages (they ship CJS dist builds).
  transpilePackages: ['@medicore/shared-types', '@medicore/validation'],
};

export default nextConfig;
