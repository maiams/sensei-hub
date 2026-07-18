import type { NextConfig } from 'next'
import withSerwistInit from '@serwist/next'

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

// Fase 6 (PWA + Offline). Service worker only registers in production builds
// (disable: dev !== production) — dev already has hot reload; a SW fighting
// that would be confusing. See src/app/sw.ts for the caching strategy.
const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
})

export default withSerwist(nextConfig)
