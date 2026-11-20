/** @type {import('next').NextConfig} */
export default {
  // dev server uses its own folder so it never wipes the production build
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  // self-contained server bundle: small Docker image, low memory use
  output: 'standalone',
  serverExternalPackages: ['postgres'],
  // GitHub Codespaces / Gitpod serve the app from a forwarded domain;
  // allow it for dev assets and for form submissions (server actions).
  allowedDevOrigins: ['*.app.github.dev', '*.githubpreview.dev', '*.gitpod.io'],
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
      allowedOrigins: ['localhost:3000', '*.app.github.dev', '*.githubpreview.dev', '*.gitpod.io'],
    },
  },
};
