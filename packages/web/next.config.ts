import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Server runs separately (Fastify). Next.js only serves UI.
  output: 'standalone',
  experimental: {
    // Allow importing from workspace packages
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ]
  },
}

export default nextConfig
