import type { NextConfig } from 'next';

// The browser talks only to this app. /api/* is forwarded to instructor-api,
// so the session cookie stays first-party and no CORS is needed.
const API = process.env.INSTRUCTOR_API_URL ?? 'http://localhost:8020';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
