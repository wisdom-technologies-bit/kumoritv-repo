/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      {
        source: '/media',
        destination: '/',
        permanent: true,
      },
      {
        source: '/watch',
        destination: '/',
        permanent: true,
      },
      {
        source: '/read',
        destination: '/',
        permanent: true,
      },
      {
        source: '/news/:path',
        destination: '/news',
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            // YouTube replaced the old "no Referer" behaviour with a hard
            // error 153 ("Video player configuration error"). This policy still
            // sends only the origin cross-site, which is exactly what the
            // trailer iframes declare, so nothing else is exposed.
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
      {
        // Prompt 39B: /sw.js is now a self-removing stub that replaces the
        // retired ad provider's worker (see docs/ads-adcash.md). A browser
        // re-checks a worker on its own schedule, so this file must never be
        // cached: no-cache makes every update check re-read it and every
        // returning visitor drops the old worker. Scope stays at "/".
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        // OneSignal's worker lives under its own scope, so the root-scope worker
        // at /sw.js is never involved. `Service-Worker-Allowed` is what lets a
        // worker served from /push/onesignal/ claim that scope, and the
        // revalidate header stops Cloudflare/Railway serving a stale copy.
        source: '/push/onesignal/:path*',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/push/onesignal/' },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ]
  },
  images: {
    unoptimized: true, // set to TRUE due to vercel limit of image optimization
    remotePatterns: [
      {
        protocol: "https",
        hostname: "s4.anilist.co",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "img1.ak.crunchyroll.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "gogocdn.net",
        port: "",
        pathname: "/**",
      }, {
        protocol: "https",
        hostname: "animenewsnetwork.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        port: "",
        pathname: "/**",
      },
      {
        // TMDB title logos (`https://image.tmdb.org/t/p/w500/<file>`)
        protocol: "https",
        hostname: "image.tmdb.org",
        port: "",
        pathname: "/t/p/**",
      },
      {
        protocol: "https",
        hostname: "**", // so many new SOURCES that i had to just allow any 
        port: "",
        pathname: "/**",
      }
    ],
  },
  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.(".svg")
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...fileLoaderRule.resourceQuery.not, /url/] }, // exclude if *.svg?url
        use: ["@svgr/webpack"],
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    return config;
  },
};

export default nextConfig;
