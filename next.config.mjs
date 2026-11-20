const cabecalhosDoFormularioPublico = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'no-store, max-age=0' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
];

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

export default {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['postgres'],
  experimental: {
    proxyClientMaxBodySize: '26mb',
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/contexto/:path*', headers: cabecalhosDoFormularioPublico },
      { source: '/convite/:path*', headers: cabecalhosDoFormularioPublico },
      { source: '/api/contexto/:path*', headers: cabecalhosDoFormularioPublico },
    ];
  },
};
