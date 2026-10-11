/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/watchlist", destination: "/", permanent: true },
      { source: "/companies/:id", destination: "/company/:id", permanent: true },
    ];
  },
};

export default nextConfig;
