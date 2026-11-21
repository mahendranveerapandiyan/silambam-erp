/** @type {import('next').NextConfig} */
export default {
  // dev server uses its own folder so it never wipes the production build
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  // self-contained server bundle: small Docker image, low memory use
  output: 'standalone',
  serverExternalPackages: ['postgres', 'sharp'],
  // GitHub Codespaces / Gitpod serve the app from a forwarded domain;
  // allow it for dev assets and for form submissions (server actions).
  allowedDevOrigins: ['*.app.github.dev', '*.githubpreview.dev', '*.gitpod.io'],
  experimental: {
    serverActions: {
      bodySizeLimit: '26mb',
      // Codespaces forwards requests with Origin "localhost:<port>"; allow the usual local ports
      allowedOrigins: [
        ...Array.from({ length: 11 }, (_, i) => `localhost:${3000 + i}`),
        ...Array.from({ length: 11 }, (_, i) => `127.0.0.1:${3000 + i}`),
        '*.app.github.dev', '*.githubpreview.dev', '*.gitpod.io',
      ],
    },
  },
};
