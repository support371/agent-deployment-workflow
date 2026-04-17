/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // The agent loop uses Node APIs (Vercel Sandbox SDK, Octokit).
  // Force Node runtime for API routes via route-level `export const runtime`.
};

module.exports = nextConfig;
