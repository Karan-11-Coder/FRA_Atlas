/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type and lint errors fail the build (both were previously ignored).
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  // Self-contained server bundle for the Docker image (see Dockerfile).
  output: "standalone",
}

export default nextConfig
