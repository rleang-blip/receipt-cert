const staticExport = process.env.NEXT_STATIC_EXPORT === '1';

export default {
  ...(staticExport ? { output: 'export' } : {}),
  ...(!staticExport ? {
    async rewrites() {
      return [
        { source: '/api/:path*', destination: 'http://127.0.0.1:8787/api/:path*' },
        { source: '/test_baht', destination: '/test_baht.html' },
      ];
    },
  } : {}),
};
