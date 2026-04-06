import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowedDevOrigins = Array.from(
  new Set([
    "localhost",
    "127.0.0.1",
    ...Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === "IPv4" && entry.internal === false)
      .map((entry) => entry.address),
  ]),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins,
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
