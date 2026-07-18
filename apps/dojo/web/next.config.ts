import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Server runs separately (Fastify). Next.js only serves UI.
  output: 'standalone',
  transpilePackages: ['@sensei-hub/core-web'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3101/api/:path*',
      },
    ]
  },
}

export default nextConfig
