import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowedDevOrigins = Array.from(
  new Set([
    "localhost",
    "127.0.0.1",
    "192.168.1.164",
    ...Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === "IPv4" && entry.internal === false)
      .map((entry) => entry.address),
  ]),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "emerstone.com",
      },
      {
        protocol: "https",
        hostname: "www.emerstone.com",
      },
      {
        protocol: "https",
        hostname: "cdn.msisurfaces.com",
      },
      {
        protocol: "https",
        hostname: "zvbrrosmkwrnudixfsbj.supabase.co",
      },
      {
        protocol: "https",
        hostname: "www.cambriausa.com",
      },
      {
        protocol: "https",
        hostname: "cambriausa.com",
      },
      {
        protocol: "https",
        hostname: "www.caesarstoneus.com",
      },
      {
        protocol: "https",
        hostname: "caesarstoneus.com",
      },
      {
        protocol: "https",
        hostname: "s7d9.scene7.com",
      },
      {
        protocol: "https",
        hostname: "digitalassets.daltile.com",
      },
      {
        protocol: "https",
        hostname: "assetstools.cosentino.com",
      },
      {
        protocol: "https",
        hostname: "bramati.com",
      },
      {
        protocol: "https",
        hostname: "hyundailncusa.com",
      },
      {
        protocol: "https",
        hostname: "reliancesurfaces.com",
      },
      {
        protocol: "https",
        hostname: "www.ewmarble.com",
      },
      {
        protocol: "https",
        hostname: "www.gramaco.com",
      },
      {
        protocol: "https",
        hostname: "www.marblesystems.com",
      },
      {
        protocol: "https",
        hostname: "raphaelstoneusa.com",
      },
      {
        protocol: "https",
        hostname: "www.raphaelstoneusa.com",
      },
      {
        protocol: "https",
        hostname: "www.vadara.com",
      },
      {
        protocol: "https",
        hostname: "www.veneziasurfaces.com",
      },
      {
        protocol: "https",
        hostname: "us.vicostone.com",
      },
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
